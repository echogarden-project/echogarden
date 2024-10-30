import { extendDeep } from '../utilities/ObjectUtilities.js'

import { AudioSourceParam, RawAudio, applyGainDecibels, applyGainDecibelsInPlace, attenuateIfClippingInPlace, ensureRawAudio, getSamplePeakDecibels, mixAudio, normalizeAudioLevelInPlace } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'

import { logToStderr } from '../utilities/Utilities.js'
import { resampleAudioSpeex } from '../dsp/SpeexResampler.js'
import { EngineMetadata } from './Common.js'
import chalk from 'chalk'
import { defaultNSNet2Options, NSNet2Options } from '../denoising/NSNet2.js'
import { loadPackage } from '../utilities/PackageManager.js'

const log = logToStderr

export async function denoise(input: AudioSourceParam, options: DenoisingOptions) {
	const logger = new Logger()
	const startTime = logger.getTimestamp()

	options = extendDeep(defaultDenoisingOptions, options)

	const inputRawAudio = await ensureRawAudio(input)

	logger.start(`Initialize ${options.engine} module`)

	let denoisedAudio: RawAudio

	switch (options.engine) {
		case 'rnnoise': {
			const RNNoise = await import('../denoising/RNNoise.js')
			logger.end()

			const processingSampleRate = 48000

			logger.start(`Resample audio to ${processingSampleRate} Hz`)
			const inputRawAudioResampled = await resampleAudioSpeex(inputRawAudio, processingSampleRate, 0)

			const denoisedAudioChannels: Float32Array[] = []

			for (let channelIndex = 0; channelIndex < inputRawAudioResampled.audioChannels.length; channelIndex++) {
				const audioChannel = inputRawAudioResampled.audioChannels[channelIndex]

				const audioChannelRawAudio: RawAudio = { audioChannels: [audioChannel], sampleRate: processingSampleRate }

				logger.end()
				logger.logTitledMessage(`Denoise audio channel`, `${channelIndex}`, chalk.magentaBright)

				const { denoisedRawAudio, frameVadProbabilities } = await RNNoise.denoiseAudio(audioChannelRawAudio)

				logger.end()

				denoisedAudioChannels.push(denoisedRawAudio.audioChannels[0])
			}

			denoisedAudio = { audioChannels: denoisedAudioChannels, sampleRate: processingSampleRate }

			break
		}

		case 'nsnet2': {
			const NSNet2 = await import('../denoising/NSNet2.js')
			logger.end()

			const nsnet2Options = options.nsnet2!

			let processingSampleRate: number
			let packageName: string

			if (nsnet2Options.model === 'baseline-16khz') {
				processingSampleRate = 16000

				packageName = 'nsnet2-20ms-baseline'
			} else if (nsnet2Options.model === 'baseline-48khz') {
				processingSampleRate = 48000

				packageName = 'nsnet2-20ms-48k-baseline'
			} else {
				throw new Error(`Unknown model name: ${nsnet2Options.model}`)
			}

			if (!nsnet2Options.modelDirectoryPath) {
				nsnet2Options.modelDirectoryPath = await loadPackage(packageName)
			}

			logger.start(`Resample audio to ${processingSampleRate} Hz`)
			const inputRawAudioResampled = await resampleAudioSpeex(inputRawAudio, processingSampleRate, 0)

			const denoisedAudioChannels: Float32Array[] = []

			for (let channelIndex = 0; channelIndex < inputRawAudioResampled.audioChannels.length; channelIndex++) {
				const audioChannel = inputRawAudioResampled.audioChannels[channelIndex]

				const audioChannelRawAudio: RawAudio = { audioChannels: [audioChannel], sampleRate: processingSampleRate }

				logger.end()

				logger.logTitledMessage(`Denoise audio channel`, `${channelIndex}`, chalk.magentaBright)

				const { denoisedAudio } = await NSNet2.denoiseAudio(audioChannelRawAudio, nsnet2Options)

				logger.end()

				denoisedAudioChannels.push(denoisedAudio.audioChannels[0])
			}

			denoisedAudio = { audioChannels: denoisedAudioChannels, sampleRate: processingSampleRate }

			break
		}

		default: {
			throw new Error(`Engine '${options.engine}' is not recognized.`)
		}
	}

	logger.logTitledMessage(`Postprocess`, ``, chalk.magentaBright)

	logger.start(`Resample denoised audio (${denoisedAudio.sampleRate} Hz) back to original sample rate (${inputRawAudio.sampleRate} Hz)`)

	denoisedAudio = await ensureRawAudio(denoisedAudio, inputRawAudio.sampleRate, inputRawAudio.audioChannels.length)

	logger.start('Postprocess audio')

	const shouldNormalize = options.postProcessing!.normalizeAudio!
	const targetPeakDecibels = options.postProcessing!.targetPeak!
	const maxGainIncreaseDecibels = options.postProcessing!.maxGainIncrease!
	const dryMixGainDecibels = options.postProcessing!.dryMixGain!

	attenuateIfClippingInPlace(denoisedAudio)

	const preMixPeakDecibels = getSamplePeakDecibels(denoisedAudio.audioChannels)
	const inputRawAudioWithGain = applyGainDecibels(inputRawAudio, dryMixGainDecibels)
	denoisedAudio = mixAudio(denoisedAudio, inputRawAudioWithGain)
	const postMixPeakDecibels = getSamplePeakDecibels(denoisedAudio.audioChannels)

	if (shouldNormalize) {
		normalizeAudioLevelInPlace(denoisedAudio, targetPeakDecibels, maxGainIncreaseDecibels)
	} else {
		applyGainDecibelsInPlace(denoisedAudio, preMixPeakDecibels - postMixPeakDecibels)
	}

	logger.end()

	logger.log('')
	logger.logDuration('Total denoising time', startTime, chalk.magentaBright)

	return {
		denoisedAudio,
		inputRawAudio
	}
}

export interface DenoisingResult {
	denoisedAudio: RawAudio
	inputRawAudio: RawAudio
}

export type DenoisingEngine = 'rnnoise' | 'nsnet2'

export interface DenoisingOptions {
	engine?: DenoisingEngine,

	postProcessing?: {
		normalizeAudio: boolean
		targetPeak: number
		maxGainIncrease: number

		dryMixGain?: number
	}

	nsnet2?: NSNet2Options
}

export const defaultDenoisingOptions: DenoisingOptions = {
	engine: 'rnnoise',

	postProcessing: {
		normalizeAudio: false,
		targetPeak: -3,
		maxGainIncrease: 30,
		dryMixGain: -100,
	},

	nsnet2: defaultNSNet2Options,
}

export const denoisingEngines: EngineMetadata[] = [
	{
		id: 'rnnoise',
		name: 'RNNoise',
		description: 'A noise suppression library based on a recurrent neural network.',
		type: 'local'
	},
	{
		id: 'nsnet2',
		name: 'Noise Suppression Net 2',
		description: 'Noise suppression models used as baselines for the ICASSP 2021 Deep Noise Suppression challenge.',
		type: 'local'
	}
]
