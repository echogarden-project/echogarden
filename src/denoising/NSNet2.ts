import { decibelsToGainFactor, RawAudio } from '../audio/AudioUtilities.js'

import type * as Onnx from 'onnxruntime-node'
import { getOnnxSessionOptions, OnnxExecutionProvider } from '../utilities/OnnxUtilities.js'
import { readdir } from '../utilities/FileSystem.js'
import { joinPath } from '../utilities/PathUtilities.js'
import { stftr, stiftr } from '../dsp/FFT.js'
import { clip, concatFloat32Arrays } from '../utilities/Utilities.js'
import { Logger } from '../utilities/Logger.js'

export async function denoiseAudio(rawAudio: RawAudio, options: NSNet2Options) {
	const onnxExecutionProviders: OnnxExecutionProvider[] = options.provider ? [options.provider] : []//['dml', 'cpu']

	const denoiser = new NSNet2(options.model!, options.modelDirectoryPath!, onnxExecutionProviders, options.maxAttenuation!)

	const result = await denoiser.denoiseAudio(rawAudio)

	return result
}

export class NSNet2 {
	session?: Onnx.InferenceSession

	constructor(
		public readonly modelName: NSNet2ModelName,
		public readonly modelDirectoryPath: string,
		public readonly executionProviders: OnnxExecutionProvider[],
		public readonly maxAttenuation: number) {
	}

	async denoiseAudio(rawAudio: RawAudio) {
		const logger = new Logger()

		logger.start(`Initialize ONNX model ${this.modelName}`)
		await this.initializeIfNeeded()

		let fftSize: number

		if (this.modelName === 'baseline-48khz') {
			fftSize = 1024

			if (rawAudio.sampleRate !== 48000) {
				throw new Error(`Denoising model baseline-48khz requires a 48000 Hz signal`)
			}
		} else if (this.modelName === 'baseline-16khz') {
			fftSize = 320

			if (rawAudio.sampleRate !== 16000) {
				throw new Error(`Denoising model baseline-16khz requires a 16000 Hz signal`)
			}
		} else {
			throw new Error(`Unsupported model name: ${this.modelName}`)
		}

		const fftHopSize = fftSize / 2
		const fftRealBinCount = (fftSize / 2) + 1

		logger.start('Compute STFT frames')
		const stftrFrames = await stftr(rawAudio.audioChannels[0], fftSize, fftSize, fftHopSize, 'hann')

		logger.start('Compute log-power spectogram')
		let logPowerSpectogram: Float32Array[] = []

		{
			for (const frame of stftrFrames) {
				const logPowerSpectrum = new Float32Array(frame.length / 2)

				let readOffset = 0
				let writeOffset = 0

				while (readOffset < frame.length) {
					const real = frame[readOffset++]
					const imaginary = frame[readOffset++]

					const powerValue = (real ** 2) + (imaginary ** 2)
					const clampedPowerValue = Math.max(powerValue, 1e-12)
					const logPowerValue = Math.log10(clampedPowerValue)

					logPowerSpectrum[writeOffset++] = logPowerValue
				}

				logPowerSpectogram.push(logPowerSpectrum)
			}
		}

		logger.start('Process log-power spectogram using ONNX model')

		const frameCount = logPowerSpectogram.length
		let flattenedOutputTensor: Float32Array

		{
			const Onnx = await import('onnxruntime-node')

			const flattenedFeatures = concatFloat32Arrays(logPowerSpectogram)

			const inputTensor = new Onnx.Tensor('float32', flattenedFeatures, [1, frameCount, fftRealBinCount])
			const inputs = { input: inputTensor }

			const result = await this.session!.run(inputs)

			flattenedOutputTensor = result.output.data as Float32Array
		}

		{
			logger.start('Apply model output as a filter to original STFT frames')

			const fftSizeReciprocal = 1 / fftSize

			const minGainRatio = decibelsToGainFactor(-this.maxAttenuation)
			const maxGainRatio = 1.0

			let flattenenedOutputTensorReadIndex = 0

			for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
				const frame = stftrFrames[frameIndex]

				let frameReadIndex = 0

				for (let binIndex = 0; binIndex < fftRealBinCount; binIndex++) {
					let gainRatio = flattenedOutputTensor[flattenenedOutputTensorReadIndex++]
					gainRatio = clip(gainRatio, minGainRatio, maxGainRatio)

					frame[frameReadIndex++] *= gainRatio * fftSizeReciprocal
					frame[frameReadIndex++] *= gainRatio * fftSizeReciprocal
				}
			}
		}

		// Allow logPowerSpectogram to be garbage collected
		logPowerSpectogram = undefined as any

		logger.start('Reconstruct filtered signal using inverse STFT')
		const filteredSignal = await stiftr(stftrFrames, fftSize, fftSize, fftHopSize, 'hann')

		const denoisedAudio: RawAudio = {
			audioChannels: [filteredSignal],
			sampleRate: rawAudio.sampleRate
		}

		logger.end()

		return { denoisedAudio }
	}

	private async initializeIfNeeded() {
		if (this.session) {
			return
		}

		const filesInModelPath = await readdir(this.modelDirectoryPath)
		const onnxModelFilename = filesInModelPath.find(filename => filename.endsWith('.onnx'))

		if (!onnxModelFilename) {
			throw new Error(`Couldn't file any ONNX model file in ${this.modelDirectoryPath}`)
		}

		const onnxModelPath = joinPath(this.modelDirectoryPath, onnxModelFilename)

		const Onnx = await import('onnxruntime-node')

		const onnxSessionOptions = getOnnxSessionOptions({ executionProviders: this.executionProviders })

		this.session = await Onnx.InferenceSession.create(onnxModelPath, onnxSessionOptions)
	}
}

//export type NSNet2ModelName = 'nsnet2-20ms-baseline' | 'nsnet2-20ms-48k-baseline'
export type NSNet2ModelName = 'baseline-16khz' | 'baseline-48khz'

export const defaultNSNet2Options: NSNet2Options = {
	model: 'baseline-48khz',
	modelDirectoryPath: undefined,
	provider: undefined,
	maxAttenuation: 30,
}

export interface NSNet2Options {
	model?: NSNet2ModelName
	modelDirectoryPath?: string
	provider?: OnnxExecutionProvider
	maxAttenuation?: number
}
