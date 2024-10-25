import { extendDeep } from '../utilities/ObjectUtilities.js'

import { logToStderr } from '../utilities/Utilities.js'
import { AudioSourceParam, RawAudio, cropToTimeline, ensureRawAudio, } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'

import { Timeline } from '../utilities/Timeline.js'
import { loadPackage } from '../utilities/PackageManager.js'
import { EngineMetadata } from './Common.js'
import chalk from 'chalk'
import { type AdaptiveGateVADOptions } from '../voice-activity-detection/AdaptiveGateVAD.js'
import { type WhisperVADOptions } from '../recognition/WhisperSTT.js'
import { OnnxExecutionProvider } from '../utilities/OnnxUtilities.js'
import { joinPath } from '../utilities/PathUtilities.js'

const log = logToStderr

export async function detectVoiceActivity(input: AudioSourceParam, options: VADOptions): Promise<VADResult> {
	const logger = new Logger()

	const startTimestamp = logger.getTimestamp()

	const inputRawAudio = await ensureRawAudio(input)

	logger.start(`Resample audio to 16kHz mono`)
	let sourceRawAudio = await ensureRawAudio(inputRawAudio, 16000, 1)

	logger.start(`Detect voice activity with ${options.engine}`)

	options = extendDeep(defaultVADOptions, options)

	const activityThreshold = options.activityThreshold!

	let verboseTimeline: Timeline

	switch (options.engine) {
		case 'webrtc': {
			const WebRtcVAD = await import('../voice-activity-detection/WebRtcVAD.js')

			const webrtcOptions = options.webrtc!

			const frameProbabilities = await WebRtcVAD.detectVoiceActivity(sourceRawAudio, webrtcOptions.frameDuration!)
			const frameDurationSeconds = webrtcOptions.frameDuration! / 1000

			verboseTimeline = frameProbabilitiesToTimeline(frameProbabilities, frameDurationSeconds, activityThreshold)

			break
		}

		case 'silero': {
			const SileroVAD = await import('../voice-activity-detection/SileroVAD.js')

			const sileroOptions = options.silero!

			const modelDir = await loadPackage('silero-vad')

			const modelPath = joinPath(modelDir, 'silero-vad.onnx')
			const frameDuration = sileroOptions.frameDuration!

			const onnxExecutionProviders: OnnxExecutionProvider[] = sileroOptions.provider ? [sileroOptions.provider] : []

			const frameProbabilities = await SileroVAD.detectVoiceActivity(
				sourceRawAudio,
				modelPath,
				frameDuration,
				onnxExecutionProviders)

			const frameDurationSeconds = sileroOptions.frameDuration! / 1000

			verboseTimeline = frameProbabilitiesToTimeline(frameProbabilities, frameDurationSeconds, activityThreshold)

			break
		}

		case 'rnnoise': {
			const RNNoise = await import('../denoising/RNNoise.js')

			const audio48k = await ensureRawAudio(sourceRawAudio, 48000, 1)

			const rnnoiseOptions = options.rnnoise!

			const { denoisedRawAudio, frameVadProbabilities } = await RNNoise.denoiseAudio(audio48k)

			const frameDurationSeconds = 0.01
			const frameProbabilities = frameVadProbabilities

			verboseTimeline = frameProbabilitiesToTimeline(frameProbabilities, frameDurationSeconds, activityThreshold)

			break
		}

		case 'whisper': {
			const WhisperSTT = await import('../recognition/WhisperSTT.js')

			const whisperVADOptions = options.whisper!

			logger.end()

			const { modelName, modelDir } = await WhisperSTT.loadPackagesAndGetPaths(whisperVADOptions.model, 'de')

			logger.end();

			const { partProbabilities } = await WhisperSTT.detectVoiceActivity(
				sourceRawAudio,
				modelName,
				modelDir,
				whisperVADOptions,
			)

			verboseTimeline = []

			for (const entry of partProbabilities) {
				const hasSpeech = entry.confidence! >= activityThreshold

				const text = hasSpeech ? 'active' : 'inactive'

				if (verboseTimeline.length === 0 || verboseTimeline[verboseTimeline.length - 1].text != text) {
					verboseTimeline.push({
						type: 'segment',
						text,
						startTime: entry.startTime,
						endTime: entry.endTime
					})
				} else {
					verboseTimeline[verboseTimeline.length - 1].endTime = entry.endTime
				}
			}

			break
		}

		case 'adaptive-gate': {
			const AdaptiveGateVAD = await import('../voice-activity-detection/AdaptiveGateVAD.js')

			const adaptiveGateOptions = options.adaptiveGate!

			verboseTimeline = await AdaptiveGateVAD.detectVoiceActivity(sourceRawAudio, adaptiveGateOptions)

			break
		}

		default: {
			throw new Error(`Engine '${options.engine}' is not supported`)
		}
	}

	const timeline = verboseTimeline.filter(entry => entry.text === 'active')

	const croppedRawAudio = cropToTimeline(inputRawAudio, timeline)

	logger.end()
	logger.log('')
	logger.logDuration(`Total voice activity detection time`, startTimestamp, chalk.magentaBright)

	return {
		timeline,
		verboseTimeline,
		inputRawAudio,
		croppedRawAudio
	}
}

function frameProbabilitiesToTimeline(frameProbabilities: number[], frameDurationSeconds: number, activityThreshold: number) {
	const timeline: Timeline = []

	for (let i = 0; i < frameProbabilities.length; i++) {
		const frameProbability = frameProbabilities[i]

		const startTime = i * frameDurationSeconds
		const endTime = (i + 1) * frameDurationSeconds

		if (frameProbability >= activityThreshold) {
			if (timeline.length == 0 || timeline[timeline.length - 1].text == 'inactive') {
				timeline.push({ type: 'segment', text: 'active', startTime, endTime })

				continue
			}
		} else {
			if (timeline.length == 0 || timeline[timeline.length - 1].text == 'active') {
				timeline.push({ type: 'segment', text: 'inactive', startTime, endTime })

				continue
			}
		}

		timeline[timeline.length - 1].endTime = endTime
	}

	return timeline
}

export function convertCroppedToUncroppedTimeline(timeline: Timeline, uncropTimeline: Timeline) {
	if (timeline.length === 0) {
		return
	}

	for (const entry of timeline) {
		const {
			mappedStartTime,
			mappedEndTime
		} = mapUsingUncropTimeline(entry.startTime, entry.endTime, uncropTimeline)

		const mapSubTimeline = (subTimeline: Timeline | undefined) => {
			if (!subTimeline) {
				return
			}

			for (const subEntry of subTimeline) {
				subEntry.startTime = Math.min(mappedStartTime + (subEntry.startTime - entry.startTime), mappedEndTime)
				subEntry.endTime = Math.min(mappedStartTime + (subEntry.endTime - entry.startTime), mappedEndTime)

				mapSubTimeline(subEntry.timeline)
			}
		}

		mapSubTimeline(entry.timeline)

		entry.startTime = mappedStartTime
		entry.endTime = mappedEndTime
	}
}

function mapUsingUncropTimeline(startTimeInCroppedAudio: number, endTimeInCroppedAudio: number, uncropTimeline: Timeline): UncropTimelineMapResult {
	if (uncropTimeline.length === 0) {
		return {
			mappedStartTime: 0,
			mappedEndTime: 0,
		}
	}

	let offsetInCroppedAudio = 0

	if (endTimeInCroppedAudio < startTimeInCroppedAudio) {
		endTimeInCroppedAudio = startTimeInCroppedAudio
	}

	let bestOverlapDuration = -1
	let mappedStartTime = -1
	let mappedEndTime = -1

	for (const uncropEntry of uncropTimeline) {
		const uncropEntryDuration = uncropEntry.endTime - uncropEntry.startTime

		const overlapStartTime = Math.max(startTimeInCroppedAudio, offsetInCroppedAudio)
		const overlapEndTime = Math.min(endTimeInCroppedAudio, offsetInCroppedAudio + uncropEntryDuration)

		const overlapDuration = overlapEndTime - overlapStartTime

		if (overlapDuration >= 0 && overlapDuration > bestOverlapDuration) {
			bestOverlapDuration = overlapDuration

			mappedStartTime = uncropEntry.startTime + (overlapStartTime - offsetInCroppedAudio)
			mappedEndTime = uncropEntry.startTime + (overlapEndTime - offsetInCroppedAudio)
		}

		offsetInCroppedAudio += uncropEntryDuration
	}

	if (bestOverlapDuration === -1) {
		if (startTimeInCroppedAudio >= offsetInCroppedAudio) {
			const maxTimestamp = uncropTimeline[uncropTimeline.length - 1].endTime

			return {
				mappedStartTime: maxTimestamp,
				mappedEndTime: maxTimestamp
			}
		} else {
			throw new Error(`Given start time ${startTimeInCroppedAudio} was smaller than audio duration but no match was found in uncrop timeline (should not occur)`)
		}
	}

	return {
		mappedStartTime,
		mappedEndTime
	}
}

interface UncropTimelineMapResult {
	mappedStartTime: number
	mappedEndTime: number
}

export interface VADResult {
	timeline: Timeline
	verboseTimeline: Timeline

	inputRawAudio: RawAudio
	croppedRawAudio: RawAudio
}

export type VADEngine = 'webrtc' | 'silero' | 'rnnoise' | 'whisper' | 'adaptive-gate'

export interface VADOptions {
	engine?: VADEngine

	activityThreshold?: number

	webrtc?: {
		frameDuration?: 10 | 20 | 30
		mode?: 0 | 1 | 2 | 3
	}

	silero?: {
		frameDuration?: 30 | 60 | 90
		provider?: OnnxExecutionProvider
	}

	rnnoise?: {
	}

	whisper?: WhisperVADOptions

	adaptiveGate?: AdaptiveGateVADOptions
}

export const defaultVADOptions: VADOptions = {
	engine: 'silero',

	activityThreshold: 0.5,

	webrtc: {
		frameDuration: 30,
		mode: 1
	},

	silero: {
		frameDuration: 90,
		provider: undefined,
	},

	rnnoise: {
	},

	whisper: {
		model: 'tiny',
		temperature: 1.0,
	},

	adaptiveGate: {
	}
}

export const vadEngines: EngineMetadata[] = [
	{
		id: 'webrtc',
		name: 'WebRTC VAD',
		description: 'A voice activity detector from the Chromium browser sources.',
		type: 'local'
	},
	{
		id: 'silero',
		name: 'Silero VAD',
		description: 'A voice activity detection model by Silero.',
		type: 'local'
	},
	{
		id: 'rnnoise',
		name: 'RNNoise',
		description: `Uses RNNoise's internal speech probabilities as VAD metrics.`,
		type: 'local'
	}
]
