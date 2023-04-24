import { extendDeep } from "../utilities/ObjectUtilities.js"

import * as FFMpegTranscoder from "../codecs/FFMpegTranscoder.js"

import { playAudioSamples } from "../audio/AudioPlayer.js"
import { RawAudio, applyGainDecibels, downmixToMonoAndNormalize, getAudioPeakDecibels, mixAudio, normalizeAudioLevel } from "../audio/AudioUtilities.js"
import { Logger } from "../utilities/Logger.js"

import { logToStderr } from "../utilities/Utilities.js"
import { resampleAudioSpeex } from "../dsp/SpeexResampler.js"

const log = logToStderr

export async function denoiseFile(filename: string, options: DenoisingOptions) {
	const rawAudio = await FFMpegTranscoder.decodeToChannels(filename)

	return denoise(rawAudio, options)
}

export async function denoise(rawAudio: RawAudio, options: DenoisingOptions) {
	const logger = new Logger()
	const startTime = logger.getTimestamp()
	logger.start("Prepare for denoising")

	options = extendDeep(defaultDenoisingOptions, options)

	const processingSampleRate = 48000

	logger.start(`Resample audio to ${processingSampleRate} Hz`)
	const resampledRawAudio = await resampleAudioSpeex(rawAudio, processingSampleRate, 3)

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

	logger.logDuration("Total denoising time", startTime)

	return denoisedAudio
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
