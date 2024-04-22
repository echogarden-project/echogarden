import { parentPort } from 'node:worker_threads'

import { ChildProcessWithoutNullStreams, spawn } from 'child_process'

import { RawAudio, encodeRawAudioToWave, fadeAudioInOut, getRawAudioDuration, sliceRawAudioByTime } from './AudioUtilities.js'
import * as AudioBufferConversion from './AudioBufferConversion.js'
import * as FFMpegTranscoder from '../codecs/FFMpegTranscoder.js'

import { Timer } from '../utilities/Timer.js'
import { getRandomHexString, waitTimeout, writeToStderr } from '../utilities/Utilities.js'
import { encodeToAudioBuffer } from './AudioBufferConversion.js'
import { OpenPromise } from '../utilities/OpenPromise.js'
import { Timeline, addWordTextOffsetsToTimeline } from '../utilities/Timeline.js'
import { outputFile, readAndParseJsonFile, readFile, remove } from '../utilities/FileSystem.js'
import { tryResolvingSoxPath } from './SoxPath.js'
import { SignalChannel } from '../utilities/SignalChannel.js'
import { deepClone } from '../utilities/ObjectUtilities.js'
import { appName } from '../api/Common.js'
import path from 'node:path'
import { getAppTempDir } from '../utilities/PathUtilities.js'

export async function playAudioFileWithTimelineFile(audioFilename: string, timelineFileName: string, transcriptFileName?: string) {
	const rawAudio = await FFMpegTranscoder.decodeToChannels(audioFilename, 48000, 1)

	const timeline = await readAndParseJsonFile(timelineFileName)

	let transcript: string | undefined
	if (transcriptFileName) {
		transcript = await readFile(transcriptFileName, 'utf8')
	}

	await playAudioWithWordTimeline(rawAudio, timeline, transcript)
}

export async function playAudioWithWordTimeline(rawAudio: RawAudio, wordTimeline: Timeline, transcript?: string) {
	if (!transcript) {
		transcript = wordTimeline.map(entry => entry.text).join(' ')
	}

	wordTimeline = deepClone(wordTimeline)

	addWordTextOffsetsToTimeline(wordTimeline, transcript)

	let timelineEntryIndex = 0
	let transcriptOffset = 0

	function onTimePosition(timePosition: number) {
		const text = transcript!

		for (; timelineEntryIndex < wordTimeline.length; timelineEntryIndex++) {
			const entry = wordTimeline[timelineEntryIndex]

			if (entry.startTime > timePosition) {
				return
			}

			const wordStartOffset = entry.startOffsetUtf16
			let wordEndOffset = entry.endOffsetUtf16

			if (wordStartOffset == null || wordEndOffset == null) {
				//writeToStderr(` [No offset available for '${entry.text}'] `)

				continue
			}

			while (wordEndOffset < text.length &&
				charactersToWriteAhead.includes(text[wordEndOffset]) &&
				text[wordEndOffset] != wordTimeline[timelineEntryIndex + 2]?.text) {
				wordEndOffset += 1
			}

			writeToStderr(text.substring(transcriptOffset, wordEndOffset))

			transcriptOffset = wordEndOffset
		}
	}

	writeToStderr('\n')

	const signalChannel = new SignalChannel()

	const keypressListenerStartTimestamp = Date.now()

	function keypressHandler(message: any) {
		if (message.name == 'keypress' &&
			message.key.name == 'return' &&
			message.timestamp >= keypressListenerStartTimestamp) {

			signalChannel.send('abort')
		}
	}

	parentPort?.on('message', keypressHandler)

	await playAudioSamples(rawAudio, onTimePosition, signalChannel)

	parentPort?.off('message', keypressHandler)

	writeToStderr('\n')
}

export async function playAudioWithTimelinePhones(rawAudio: RawAudio, timeline: Timeline) {
	let wordIndex = 0
	let phoneIndex = 0

	function onTimePosition(timePosition: number) {
		for (; wordIndex < timeline.length; wordIndex++) {
			const wordEntry = timeline[wordIndex]
			const phoneTimeline = wordEntry.timeline!

			if (phoneTimeline.every(phoneEntry => phoneEntry.text == '')) {
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

	writeToStderr('\n')

	await playAudioSamples(rawAudio, onTimePosition)

	writeToStderr('\n')
}


export async function playAudioPairWithTimelineInterleaved(rawAudio1: RawAudio, rawAudio2: RawAudio, timeline1: Timeline, timeline2: Timeline) {
	if (timeline1.length != timeline2.length) {
		throw new Error('Timelines have different lengths')
	}

	for (let i = 0; i < timeline1.length; i++) {
		writeToStderr(`${timeline1[i].text} `)

		await playAudioSamples(sliceRawAudioByTime(rawAudio1, timeline1[i].startTime, timeline1[i].endTime))
		await waitTimeout(200)
		await playAudioSamples(sliceRawAudioByTime(rawAudio2, timeline2[i].startTime, timeline2[i].endTime))
		await waitTimeout(500)
	}

	writeToStderr('\n')
}

export function playAudioSamples(rawAudio: RawAudio, onTimePosition?: (timePosition: number) => void, signalChannel?: SignalChannel, microFadeInOut = true) {
	return new Promise<void>(async (resolve, reject) => {
		if (microFadeInOut) {
			rawAudio = fadeAudioInOut(rawAudio, 0.0025)
		}

		let playerProcessClosed = false

		const channelCount = rawAudio.audioChannels.length
		const audioDuration = getRawAudioDuration(rawAudio)

		const playerSpawnedOpenPromise = new OpenPromise<null>()

		const soxPath = await tryResolvingSoxPath()

		if (!soxPath) {
			throw new Error(`Couldn't find or install the SoX utility. Please install the SoX utility on your system path to enable audio playback.`)
		}

		let aborted = false

		let streamToStdin = true

		if (process.platform == 'darwin') {
			streamToStdin = false
		}

		let tempFilePath: string | undefined
		let audioBuffer: Buffer | undefined

		async function cleanup() {
			if (tempFilePath) {
				await remove(tempFilePath)
			}
		}

		let playerProcess: ChildProcessWithoutNullStreams

		if (streamToStdin) {
			audioBuffer = encodeToAudioBuffer(rawAudio.audioChannels)

			playerProcess = spawn(
				soxPath,
				['-t', 'raw', '-r', `${rawAudio.sampleRate}`, '-e', 'signed', '-b', '16', '-c', channelCount.toString(), '-', '-d'],
				{}
			)
		} else {
			tempFilePath = path.join(getAppTempDir(appName), `${getRandomHexString(16)}.wav`)
			const waveFileBuffer = encodeRawAudioToWave(rawAudio)
			await outputFile(tempFilePath, waveFileBuffer)

			playerProcess = spawn(
				soxPath,
				[tempFilePath, '-d'],
				{}
			)
		}

		if (signalChannel) {
			signalChannel.on('abort', () => {
				aborted = true
				playerProcess.kill('SIGKILL')
			})
		}

		// Required to work around SoX bug:
		playerProcess.stderr.on('data', (data) => {
			//writeToStderr(data.toString('utf-8'))
		})

		playerProcess.stdout.on('data', (data) => {
			//writeToStderr(data.toString('utf-8'))
		})

		playerProcess.once('spawn', () => {
			if (audioBuffer != undefined) {
				playerProcess.stdin!.write(audioBuffer)
				playerProcess.stdin!.end()
				playerProcess.stdin!.on('error', () => { })
			}

			playerSpawnedOpenPromise.resolve(null)
		})

		playerProcess.once('error', async (e) => {
			await cleanup()
			playerProcessClosed = true

			reject(e)
		})

		playerProcess.once('close', async () => {
			await cleanup()
			playerProcessClosed = true

			resolve()
		})

		await playerSpawnedOpenPromise.promise

		const timer = new Timer()

		while (!playerProcessClosed && !aborted) {
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
		let audioData = AudioBufferConversion.encodeToAudioBuffer(rawAudio.audioChannels)

		const { default: Speaker } = await import('speaker')

		const speaker = new Speaker({
			channels: rawAudio.audioChannels.length,
			bitDepth: 16,
			sampleRate: rawAudio.sampleRate,
		})

		speaker.on('error', (e: any) => {
			reject(e)
		})

		const bytesPerSecond = rawAudio.sampleRate * 2 * channelCount

		const byteCountToDuration = (byteCount: number) => {
			return byteCount / bytesPerSecond
		}

		const audioDuration = byteCountToDuration(audioData.length)

		let mpg123AudioBufferSize: number
		let mpg123AudioBufferDuration: number

		if (process.platform == 'win32') {
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

export const charactersToWriteAhead = [
	',', '.', '，', '、', '：', '；',
	'。', ':', ';', '?', '？', '!', '！',
	')', ']', '}', `"`, `'`, '”', '’',
	'-', '—', '»', '،', '؟'
]
