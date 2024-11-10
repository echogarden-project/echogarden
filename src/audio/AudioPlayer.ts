import { parentPort } from 'node:worker_threads'

import { ChildProcessWithoutNullStreams, spawn } from 'child_process'

import { RawAudio, encodeRawAudioToWave, fadeAudioInOut, getRawAudioDuration, sliceAudioChannels, sliceRawAudioByTime } from './AudioUtilities.js'
import * as FFMpegTranscoder from '../codecs/FFMpegTranscoder.js'

import { Timer } from '../utilities/Timer.js'
import { clip, getRandomHexString, waitTimeout, writeToStderr } from '../utilities/Utilities.js'
import { encodeToAudioBuffer, float32ToInt16Pcm, interleaveChannels } from './AudioBufferConversion.js'
import { OpenPromise } from '../utilities/OpenPromise.js'
import { Timeline, addWordTextOffsetsToTimeline } from '../utilities/Timeline.js'
import { readAndParseJsonFile, readFileAsUtf8, remove, writeFile } from '../utilities/FileSystem.js'
import { tryResolvingSoxPath } from './SoxPath.js'
import { SignalChannel } from '../utilities/SignalChannel.js'
import { deepClone } from '../utilities/ObjectUtilities.js'
import { appName } from '../api/Common.js'
import { getAppTempDir, joinPath } from '../utilities/PathUtilities.js'
import { type AudioOutput } from '@echogarden/audio-io'

export async function playAudioFileWithTimelineFile(audioFilename: string, timelineFileName: string, transcriptFileName?: string, player?: AudioPlayerID) {
	const rawAudio = await FFMpegTranscoder.decodeToChannels(audioFilename, 48000, 1)

	const timeline = await readAndParseJsonFile(timelineFileName)

	let transcript: string | undefined
	if (transcriptFileName) {
		transcript = await readFileAsUtf8(transcriptFileName)
	}

	await playAudioWithWordTimeline(rawAudio, timeline, transcript, player)
}

export async function playAudioWithWordTimeline(rawAudio: RawAudio, wordTimeline: Timeline, transcript?: string, player?: AudioPlayerID) {
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
		if (message.name === 'keypress') {
			//console.log(`Keypress: ${message.key.name}`)

			if (message.timestamp < keypressListenerStartTimestamp) {
				return
			}

			const keyName = message.key.name

			if (keyName === 'return') {
				signalChannel.send('abort')
			} else if (keyName === 'left') {
				signalChannel.send('skip', -1)
			} else if (keyName === 'right') {
				signalChannel.send('skip', 1)

				if (false) {
					const nextTimelineEntryIndex = timelineEntryIndex

					if (nextTimelineEntryIndex < wordTimeline.length) {
						//signalChannel.send('skip', 5)
						const targetTime = wordTimeline[nextTimelineEntryIndex].startTime

						signalChannel.send('seek', targetTime)
					}
				}
			} else if (keyName === 'space') {
				signalChannel.send('togglePause')
			}
		}
	}

	parentPort?.on('message', keypressHandler)

	await playAudioSamples(rawAudio, onTimePosition, signalChannel, player)

	parentPort?.off('message', keypressHandler)

	writeToStderr('\n')
}

export async function playAudioSamplesWithKeyboardControls(rawAudio: RawAudio, player?: AudioPlayerID) {
	const signalChannel = new SignalChannel()

	const keypressListenerStartTimestamp = Date.now()

	function keypressHandler(message: any) {
		if (message.name === 'keypress') {
			//console.log(`Keypress: ${message.key.name}`)

			if (message.timestamp < keypressListenerStartTimestamp) {
				return
			}

			const keyName = message.key.name

			if (keyName === 'return') {
				signalChannel.send('abort')
			} else if (keyName === 'left') {
				signalChannel.send('skip', -1)
			} else if (keyName === 'right') {
				signalChannel.send('skip', 1)
			} else if (keyName === 'space') {
				signalChannel.send('togglePause')
			}
		}
	}

	parentPort?.on('message', keypressHandler)

	await playAudioSamples(rawAudio, undefined, signalChannel, player)

	parentPort?.off('message', keypressHandler)
}

export function playAudioSamples(rawAudio: RawAudio, onTimePosition?: (timePosition: number) => void, signalChannel?: SignalChannel, player?: AudioPlayerID) {
	if (!player) {
		player = 'audio-io'
	}

	if (player === 'audio-io') {
		return playAudioSamples_AudioIO(rawAudio, onTimePosition, signalChannel)
	} else if (player === 'sox') {
		return playAudioSamples_Sox(rawAudio, onTimePosition, signalChannel)
	} else {
		throw new Error(`Unsupported audio player ID: ${player}`)
	}
}

export async function playAudioSamples_AudioIO(rawAudio: RawAudio, onTimePosition?: (timePosition: number) => void, signalChannel?: SignalChannel) {
	const openPromise = new OpenPromise()

	const sampleRate = rawAudio.sampleRate
	const channelCount = rawAudio.audioChannels.length
	const bufferDuration = 100.0
	const audioFrameCount = rawAudio.audioChannels[0].length
	const audioDuration = getRawAudioDuration(rawAudio)

	const { createAudioOutput } = await import('@echogarden/audio-io')

	let frameOffset = 0
	let audioOutput: AudioOutput
	let abortRequested = false
	let ended = false

	let isPaused = false

	// Define an audio output handler function
	async function audioOutputHandler(outputBuffer: Int16Array) {
		if (ended) {
			return
		}

		if (onTimePosition) {
			const audioTime = Math.min(frameOffset / sampleRate, audioDuration)

			onTimePosition(audioTime)
		}

		if (isPaused) {
			return
		}

		const chunkFrameCount = outputBuffer.length / channelCount

		const floatAudioChunk = sliceAudioChannels(rawAudio.audioChannels, frameOffset, frameOffset + chunkFrameCount)
		const interleavedFloatAudioChunk = interleaveChannels(floatAudioChunk)
		const int16AudioChunk = float32ToInt16Pcm(interleavedFloatAudioChunk)

		outputBuffer.set(int16AudioChunk)

		frameOffset += chunkFrameCount

		if (abortRequested || int16AudioChunk.length < outputBuffer.length) {
			ended = true

			await audioOutput.dispose()
			openPromise.resolve()
		}
	}

	if (signalChannel) {
		signalChannel.on('abort', () => {
			abortRequested = true
		})

		signalChannel.on('skip', (durationToSkip: number) => {
			frameOffset += durationToSkip * sampleRate
			frameOffset = Math.floor(frameOffset)
			frameOffset = clip(frameOffset, 0, audioFrameCount)
		})

		signalChannel.on('seek', (timeToSeekTo: number) => {
			frameOffset = Math.floor(timeToSeekTo * sampleRate)
			frameOffset = clip(frameOffset, 0, audioFrameCount)
		})

		signalChannel.on('togglePause', () => {
			isPaused = !isPaused
		})
	}

	audioOutput = await createAudioOutput({
		sampleRate, // Sample rate in Hz, should be an integer like 44100, 22050, 8000
		channelCount, // Channel count, likely 1 (mono), or 2 (stereo)
		bufferDuration, // Target buffer duration, in milliseconds. Defaults to 100.0
	}, audioOutputHandler)

	return openPromise.promise
}

export function playAudioSamples_Sox(rawAudio: RawAudio, onTimePosition?: (timePosition: number) => void, signalChannel?: SignalChannel, microFadeInOut = true) {
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
		let audioBuffer: Uint8Array | undefined

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
			tempFilePath = joinPath(getAppTempDir(appName), `${getRandomHexString(16)}.wav`)
			const waveFileBuffer = encodeRawAudioToWave(rawAudio)
			await writeFile(tempFilePath, waveFileBuffer)

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

/*
export function playAudioSamples_Speaker(rawAudio: RawAudio, onTimePosition?: (timePosition: number) => void, microFadeInOut = true) {
	return new Promise<void>(async (resolve, reject) => {
		if (microFadeInOut) {
			rawAudio = fadeAudioInOut(rawAudio, 0.0025)
		}

		const channelCount = rawAudio.audioChannels.length
		let audioData = encodeToAudioBuffer(rawAudio.audioChannels)

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

		audioData = concatUint8Arrays([audioData, new Uint8Array(mpg123AudioBufferSize)])

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
*/

export const charactersToWriteAhead = [
	',', '.', '，', '、', '：', '；',
	'。', ':', ';', '?', '？', '!', '！',
	')', ']', '}', `"`, `'`, '”', '’',
	'-', '—', '»', '،', '؟'
]

export type AudioPlayerID = 'audio-io' | 'sox'
