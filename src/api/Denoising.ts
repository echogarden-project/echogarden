import { extendDeep } from "../utilities/ObjectUtilities.js"

import { AudioSourceParam, RawAudio, applyGainDecibels, ensureRawAudio, getAudioPeakDecibels, mixAudio, normalizeAudioLevel } from "../audio/AudioUtilities.js"
import { Logger } from "../utilities/Logger.js"

import { logToStderr } from "../utilities/Utilities.js"
import { resampleAudioSpeex } from "../dsp/SpeexResampler.js"
import { EngineMetadata } from "./Common.js"
import chalk from "chalk"

const log = logToStderr

export async function denoise(input: AudioSourceParam, options: DenoisingOptions) {
	const logger = new Logger()
	const startTime = logger.getTimestamp()

	logger.start("Prepare for denoising")

	options = extendDeep(defaultDenoisingOptions, options)

	const inputRawAudio = await ensureRawAudio(input)

	const processingSampleRate = 48000

	logger.start(`Resample audio to ${processingSampleRate} Hz`)
	const resampledRawAudio = await resampleAudioSpeex(inputRawAudio, processingSampleRate, 3)

	logger.start(`Initialize ${options.method} module`)

	let denoisedAudio: RawAudio

	switch (options.method) {
		case "rnnoise": {
			const RNNoise = await import("../denoising/RNNoise.js")
			logger.end()

			const denoisedAudioChannels: Float32Array[] = []

			for (const audioChannel of resampledRawAudio.audioChannels) {
				const audioChannelRawAudio: RawAudio = { audioChannels: [audioChannel], sampleRate: processingSampleRate }

				const { denoisedRawAudio, frameVadProbabilities } = await RNNoise.denoiseAudio(audioChannelRawAudio)
				denoisedAudioChannels.push(denoisedRawAudio.audioChannels[0])
			}

			denoisedAudio = { audioChannels: denoisedAudioChannels, sampleRate: processingSampleRate }

			break
		}

		default: {
			throw new Error(`Method: '${options.method}' is not supported`)
		}
	}

	logger.start("Postprocess audio")

	const shouldNormalize = options.postProcessing!.normalizeAudio!
	const targetPeakDb = options.postProcessing!.targetPeakDb!
	const maxIncreaseDb = options.postProcessing!.maxIncreaseDb!
	const dryMixGainDb = options.postProcessing!.dryMixGainDb!

	const preMixPeakDb = getAudioPeakDecibels(denoisedAudio.audioChannels)
	denoisedAudio = mixAudio(denoisedAudio, applyGainDecibels(resampledRawAudio, dryMixGainDb))
	const postMixPeakDb = getAudioPeakDecibels(denoisedAudio.audioChannels)

	if (shouldNormalize) {
		denoisedAudio = normalizeAudioLevel(denoisedAudio, targetPeakDb, maxIncreaseDb)
	} else {
		denoisedAudio = applyGainDecibels(denoisedAudio, preMixPeakDb - postMixPeakDb)
	}

	logger.end()

	logger.log('')
	logger.logDuration("Total denoising time", startTime, chalk.magentaBright)

	return {
		denoisedAudio,
		inputRawAudio
	}
}

export interface DenoisingResult {
	denoisedAudio: RawAudio
	inputRawAudio: RawAudio
}

export type DenoisingMethod = "rnnoise"

export interface DenoisingOptions {
	method?: DenoisingMethod,
	postProcessing?: {
		normalizeAudio: boolean
		targetPeakDb: number
		maxIncreaseDb: number

		dryMixGainDb?: number
	}
}

export const defaultDenoisingOptions: DenoisingOptions = {
	method: "rnnoise",

	postProcessing: {
		normalizeAudio: false,
		targetPeakDb: -3,
		maxIncreaseDb: 30,
		dryMixGainDb: -20,
	}
}

export const denoisingEngines: EngineMetadata[] = [
	{
		id: 'rnnoise',
		name: 'RNNoise',
		description: 'A noise suppression library based on a recurrent neural network.',
		type: 'local'
	}
]
