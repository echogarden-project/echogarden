import { extendDeep } from "../utilities/ObjectUtilities.js"

import { logToStderr } from "../utilities/Utilities.js"
import { AudioSourceParam, RawAudio, ensureRawAudio, } from "../audio/AudioUtilities.js"
import { Logger } from "../utilities/Logger.js"

import { Timeline } from "../utilities/Timeline.js"
import path from "path"
import { loadPackage } from "../utilities/PackageManager.js"
import { EngineMetadata } from "./Common.js"
import chalk from "chalk"

const log = logToStderr

export async function detectVoiceActivity(input: AudioSourceParam, options: VADOptions): Promise<VADResult> {
	const logger = new Logger()
	const startTimestamp = logger.getTimestamp()

	logger.start("Prepare for voice activity detection")

	const inputRawAudio = await ensureRawAudio(input)

	let sourceRawAudio = await ensureRawAudio(inputRawAudio, 16000, 1)

	options = extendDeep(defaultVADOptions, options)

	logger.start(`Detect voice activity with ${options.engine}`)

	let frameDurationSeconds: number
	let frameProbabilities: number[]

	switch (options.engine) {
		case "webrtc": {
			const WebRtcVAD = await import("../voice-activity-detection/WebRtcVAD.js")

			const webrtcOptions = options.webrtc!

			frameProbabilities = await WebRtcVAD.detectVoiceActivity(sourceRawAudio, webrtcOptions.frameDuration!)
			frameDurationSeconds = webrtcOptions.frameDuration! / 1000

			break
		}

		case "silero": {
			const SileroVAD = await import("../voice-activity-detection/SileroVAD.js")

			const sileroOptions = options.silero!

			const modelDir = await loadPackage("silero-vad")

			const modelPath = path.join(modelDir, "silero-vad.onnx")
			const frameDuration = sileroOptions.frameDuration!

			frameProbabilities = await SileroVAD.detectVoiceActivity(sourceRawAudio, modelPath, frameDuration)
			frameDurationSeconds = sileroOptions.frameDuration! / 1000

			break
		}

		case "rnnoise": {
			const RNNoise = await import("../denoising/RNNoise.js")

			const rnnoiseOptions = options.rnnoise!

			const { denoisedRawAudio, frameVadProbabilities } = await RNNoise.denoiseAudio(sourceRawAudio)

			frameDurationSeconds = 0.01
			frameProbabilities = frameVadProbabilities

			break
		}

		default: {
			throw new Error(`Engine '${options.engine}' is not supported`)
		}
	}

	const timeline: Timeline = []

	for (let i = 0; i < frameProbabilities.length; i++) {
		const frameProbability = frameProbabilities[i]

		const startTime = i * frameDurationSeconds
		const endTime = (i + 1) * frameDurationSeconds

		if (frameProbability >= options.activityThreshold!) {
			if (timeline.length == 0 || timeline[timeline.length - 1].text == "nonspeech") {
				timeline.push({ type: "segment", text: "speech", startTime, endTime })
				continue
			}
		} else {
			if (timeline.length == 0 || timeline[timeline.length - 1].text == "speech") {
				timeline.push({ type: "segment", text: "nonspeech", startTime, endTime })
				continue
			}
		}

		timeline[timeline.length - 1].endTime = endTime
	}

	logger.end()
	logger.log('')
	logger.logDuration(`Total voice activity detection time`, startTimestamp, chalk.magentaBright)

	return { timeline, inputRawAudio }
}

export interface VADResult {
	timeline: Timeline
	inputRawAudio: RawAudio
}

export type VADEngine = "webrtc" | "silero" | "rnnoise"

export interface VADOptions {
	engine?: VADEngine

	activityThreshold?: number

	webrtc?: {
		frameDuration?: 10 | 20 | 30
		mode?: 0 | 1 | 2 | 3
	}

	silero?: {
		modelPath?: string
		frameDuration?: 30 | 60 | 90
	}

	rnnoise?: {
	}
}

export const defaultVADOptions: VADOptions = {
	engine: "webrtc",

	activityThreshold: 0.5,

	webrtc: {
		frameDuration: 30,
		mode: 1
	},

	silero: {
		modelPath: undefined,
		frameDuration: 90,
	},

	rnnoise: {
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
		description: "Uses RNNoise's speech probabilities as VAD metrics.",
		type: 'local'
	}
]
