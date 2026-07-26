import { parentPort } from 'node:worker_threads'

import { RawAudio, getRawAudioDuration, sliceAudioChannels } from './AudioUtilities.js'

import { clip, writeToStderr } from '../utilities/Utilities.js'
import { float32ToInt16Pcm, interleaveChannels } from './AudioBufferConversion.js'
import { OpenPromise } from '../utilities/OpenPromise.js'
import { Timeline, addWordTextOffsetsToTimelineInPlace } from '../utilities/Timeline.js'
import { SignalChannel } from '../utilities/SignalChannel.js'
import { deepClone } from '../utilities/ObjectUtilities.js'
import { type AudioOutput } from '@echogarden/audio-io'

export async function playAudioWithWordTimeline(rawAudio: RawAudio, wordTimeline: Timeline, transcript?: string, player?: AudioPlayerID) {
	if (!transcript) {
		transcript = wordTimeline.map(entry => entry.text).join(' ')
	}

	wordTimeline = deepClone(wordTimeline)

	addWordTextOffsetsToTimelineInPlace(wordTimeline, transcript)

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

export const charactersToWriteAhead = [
	',', '.', '，', '、', '：', '；',
	'。', ':', ';', '?', '？', '!', '！',
	')', ']', '}', `"`, `'`, '”', '’',
	'-', '—', '»', '،', '؟'
]

export type AudioPlayerID = 'audio-io'
