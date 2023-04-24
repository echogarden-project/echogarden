import { spawn } from 'child_process'
import path from 'path'

import { RawAudio, encodeWaveBuffer, fadeAudioInOut, getRawAudioDuration, sliceRawAudioByTime } from "./AudioUtilities.js"
import * as AudioBufferConversion from './AudioBufferConversion.js'
import * as FFMpegTranscoder from "../codecs/FFMpegTranscoder.js"

import { Timer } from "../utilities/Timer.js"
import { commandExists, getRandomHexString, waitTimeout, writeToStderr } from '../utilities/Utilities.js'
import { encodeToAudioBuffer } from './AudioBufferConversion.js'
import { OpenPromise } from '../utilities/OpenPromise.js'
import { isWord } from '../nlp/Segmentation.js'
import { Timeline } from '../utilities/Timeline.js'
import { getAppTempDir, readAndParseJsonFile, readFile, remove, writeFile } from '../utilities/FileSystem.js'
import { tryResolvingSoxPath } from './SoxPath.js'
import { appName } from '../api/Globals.js'

export async function playAudioFileWithTimelineFile(audioFilename: string, timelineFileName: string, transcriptFileName?: string) {
	const rawAudio = await FFMpegTranscoder.decodeToChannels(audioFilename, 48000, 1)

	const timeline = await readAndParseJsonFile(timelineFileName)

	let transcript: string | undefined
	if (transcriptFileName) {
		transcript = await readFile(transcriptFileName, "utf8")
	}

	await playAudioWithTimeline(rawAudio, timeline, transcript)
}

export async function playAudioWithTimeline(rawAudio: RawAudio, timeline: Timeline, transcript?: string) {
	const lowerCaseTranscript = transcript?.toLocaleLowerCase()

	timeline = timeline.filter(entry => isWord(entry.text))

	let timelineEntryIndex = 0
	let transcriptOffset = 0

	function onTimePosition(timePosition: number) {
		for (; timelineEntryIndex < timeline.length; timelineEntryIndex++) {
			const entry = timeline[timelineEntryIndex]

			if (entry.startTime > timePosition) {
				return
			}

			if (transcript == null) {
				writeToStderr(`${entry.text} `)
				return
			}

			const wordStartOffset = lowerCaseTranscript!.indexOf(entry.text.toLocaleLowerCase(), transcriptOffset)

			if (wordStartOffset == -1) {
				continue
				//throw new Error(`Couldn't find substring "${entry.text}" in remaining text.`)
			}

			let wordEndOffset = wordStartOffset + entry.text.length

			while (wordEndOffset < transcript.length &&
				charactersToWriteAhead.includes(transcript[wordEndOffset]) &&
				transcript[wordEndOffset] != timeline[timelineEntryIndex + 2]?.text) {
				wordEndOffset += 1
			}

			writeToStderr(`${transcript.substring(transcriptOffset, wordEndOffset)}`)

			transcriptOffset = wordEndOffset
		}
	}

	writeToStderr("\n")

	await playAudioSamples(rawAudio, onTimePosition)

	writeToStderr("\n")
}

export async function playAudioWithTimelinePhones(rawAudio: RawAudio, timeline: Timeline) {
	let wordIndex = 0
	let phoneIndex = 0

	function onTimePosition(timePosition: number) {
		for (; wordIndex < timeline.length; wordIndex++) {
			const wordEntry = timeline[wordIndex]
			const phoneTimeline = wordEntry.timeline!

			if (phoneTimeline.every(phoneEntry => phoneEntry.text == "")) {
				continue
			}

			for (; phoneIndex < phoneTimeline.length; phoneIndex++) {
				const entry = phoneTimeline[phoneIndex]

				if (entry.startTime > timePosition) {
					return
				}

				writeToStderr(`${entry.text} `)
			}

			writeToStderr(`| `)
			phoneIndex = 0
		}
	}

	writeToStderr("\n")

	await playAudioSamples(rawAudio, onTimePosition)

	writeToStderr("\n")
}


export async function playAudioPairWithTimelineInterleaved(rawAudio1: RawAudio, rawAudio2: RawAudio, timeline1: Timeline, timeline2: Timeline) {
	if (timeline1.length != timeline2.length) {
		throw new Error("Timelines have different lengths")
	}

	for (let i = 0; i < timeline1.length; i++) {
		writeToStderr(`${timeline1[i].text} `)

		await playAudioSamples(sliceRawAudioByTime(rawAudio1, timeline1[i].startTime, timeline1[i].endTime))
		await waitTimeout(200)
		await playAudioSamples(sliceRawAudioByTime(rawAudio2, timeline2[i].startTime, timeline2[i].endTime))
		await waitTimeout(500)
	}

	writeToStderr("\n")
}

export function playAudioSamples(rawAudio: RawAudio, onTimePosition?: (timePosition: number) => void, microFadeInOut = true) {
	return new Promise<void>(async (resolve, reject) => {
		if (microFadeInOut) {
			rawAudio = fadeAudioInOut(rawAudio, 0.0025)
		}

		let playerProcessClosed = false

		const channelCount = rawAudio.audioChannels.length
		const audioDuration = getRawAudioDuration(rawAudio)

		const playerSpawnedOpenPromise = new OpenPromise<null>()

		const soxPath = await tryResolvingSoxPath()

		if (soxPath) {
			const audioBuffer = encodeToAudioBuffer(rawAudio.audioChannels, 16)

			const player = spawn(
				soxPath,
				['-t', 'raw', '-r', `${rawAudio.sampleRate}`, '-e', 'signed', '-b', '16', '-c', channelCount.toString(), '-', '-d'],
				{}
			)

			// Required to work around SoX bug:
			player.stderr.on("data", (data) => {
				//logErr(data.toString('utf-8'))
			})

			player.once("spawn", () => {
				player.stdin!.write(audioBuffer)
				player.stdin!.end()

				playerSpawnedOpenPromise.resolve(null)
			})

			player.once("error", (e) => {
				reject(e)
			})

			player.once('close', () => {
				playerProcessClosed = true
				resolve()
			})
		} else {
			const waveAudio = encodeWaveBuffer(rawAudio)

			const tempDir = getAppTempDir(appName)
			const tempWaveFilePath = path.join(tempDir, getRandomHexString(16) + ".wav")
			await writeFile(tempWaveFilePath, waveAudio)

			let command = ""

			if (process.platform == 'darwin' && await commandExists("afplay")) {
				command = "afplay"
			} else if (process.platform == 'linux' && await commandExists("aplay")) {
				command = "aplay"
			} else {
				throw new Error(`Couldn't find a supported audio player for this platform. Please install the SoX tool on your system path, for best results.`)
			}

			const player = spawn(command, [tempWaveFilePath],
				{ stdio: "ignore" }
			)

			player.once("spawn", () => {
				playerSpawnedOpenPromise.resolve(null)
			})

			player.once("error", async (e) => {
				await remove(tempWaveFilePath)
				reject(e)
			})

			player.once('close', async () => {
				playerProcessClosed = true
				await remove(tempWaveFilePath)
				resolve()
			})
		}

		await playerSpawnedOpenPromise.promise

		const timer = new Timer()

		while (true) {
			const elapsedTime = timer.elapsedTimeSeconds

			if (onTimePosition) {
				onTimePosition(elapsedTime)
			}

			if (playerProcessClosed || elapsedTime >= audioDuration) {
				if (onTimePosition) {
					onTimePosition(audioDuration)
				}

				return
			}

			await waitTimeout(20)
		}
	})
}

export function playAudioSamples_Speaker(rawAudio: RawAudio, onTimePosition?: (timePosition: number) => void, microFadeInOut = true) {
	return new Promise<void>(async (resolve, reject) => {
		if (microFadeInOut) {
			rawAudio = fadeAudioInOut(rawAudio, 0.0025)
		}

		const channelCount = rawAudio.audioChannels.length
		let audioData = AudioBufferConversion.encodeToAudioBuffer(rawAudio.audioChannels, 16)

		const { default: Speaker } = await import('speaker')

		const speaker = new Speaker({
			channels: rawAudio.audioChannels.length,
			bitDepth: 16,
			sampleRate: rawAudio.sampleRate,
		})

		speaker.on("error", (e: any) => {
			reject(e)
		})

		const bytesPerSecond = rawAudio.sampleRate * 2 * channelCount

		const byteCountToDuration = (byteCount: number) => {
			return byteCount / bytesPerSecond
		}

		const audioDuration = byteCountToDuration(audioData.length)

		let mpg123AudioBufferSize: number
		let mpg123AudioBufferDuration: number

		if (process.platform == "win32") {
			mpg123AudioBufferSize = 65536
			mpg123AudioBufferDuration = byteCountToDuration(mpg123AudioBufferSize)
		} else {
			mpg123AudioBufferDuration = 0.5
			mpg123AudioBufferSize = bytesPerSecond * mpg123AudioBufferDuration
		}

		audioData = Buffer.concat([audioData, Buffer.alloc(mpg123AudioBufferSize)])

		const maxChunkSize = mpg123AudioBufferSize

		const writeAheadDuration = 0.5

		const timer = new Timer()
		let readOffset = 0
		let targetTimePosition = 0

		while (true) {
			const elapsedTime = timer.elapsedTimeSeconds

			if (onTimePosition) {
				onTimePosition(elapsedTime)
			}

			if (readOffset < audioData.length) {
				const targetWriteTime = targetTimePosition - writeAheadDuration

				if (elapsedTime >= targetWriteTime) {
					const chunk = audioData.subarray(readOffset, readOffset + maxChunkSize)

					speaker.write(chunk)

					readOffset += chunk.length
					targetTimePosition += byteCountToDuration(chunk.length)
				}
			}

			if (elapsedTime >= audioDuration) {
				//speaker.close(false)
				resolve()
				return
			}

			await waitTimeout(20)
		}
	})
}

export const charactersToWriteAhead =
	[",", ".", "，", "、", "：", "；", "。", ":", ";", "?", "!", ")", "]", "}", "\"", "'", "”", "’", "-", "—"]
