import type * as Onnx from 'onnxruntime-node'
import { RawAudio } from '../audio/AudioUtilities.js';
import { binBufferToComplex, complexToBinBuffer, getWindowWeights, stftr, stiftr } from '../dsp/FFT.js';
import { ComplexNumber } from '../math/VectorMath.js';
import { logToStderr } from '../utilities/Utilities.js';
import { Logger } from '../utilities/Logger.js';
import { OnnxExecutionProvider, getOnnxSessionOptions } from '../utilities/OnnxUtilities.js';

const log = logToStderr

export async function isolate(
	rawAudio: RawAudio,
	modelFilePath: string,
	executionProviders: OnnxExecutionProvider[]) {

	const model = new MDXNet(modelFilePath, executionProviders)

	return model.processAudio(rawAudio)
}

export class MDXNet {
	session?: Onnx.InferenceSession

	constructor(
		public readonly modelFilePath: string,
		public readonly executionProviders: OnnxExecutionProvider[]) {
	}

	async processAudio(rawAudio: RawAudio) {
		if (rawAudio.audioChannels.length != 2) {
			throw new Error(`Input audio must be stereo`)
		}

		if (rawAudio.sampleRate != 44100) {
			throw new Error(`Input audio must have a sample rate of 44100 Hz`)
		}

		await this.initializeSessionIfNeeded()

		const Onnx = await import('onnxruntime-node')

		const logger = new Logger()

		const session = this.session!

		const sampleRate = rawAudio.sampleRate
		const fftSize = 6144
		const fftCount = 2048
		const fftWindowSize = fftSize
		const fftHopSize = 1024

		const segmentSize = 256
		const segmentHopSize = 240

		const sampleCount = rawAudio.audioChannels[0].length

		logger.start('Compute STFT of full waveform')

		const fftFramesLeft = await stftr(rawAudio.audioChannels[0], fftSize, fftWindowSize, fftHopSize, 'hann')
		const fftFramesRight = await stftr(rawAudio.audioChannels[1], fftSize, fftWindowSize, fftHopSize, 'hann')

		const fftFramesLeftComplex = fftFramesLeft.map(frame => binBufferToComplex(frame).slice(0, fftCount))
		const fftFramesRightComplex = fftFramesRight.map(frame => binBufferToComplex(frame).slice(0, fftCount))

		const audioForSegments: Float32Array[][] = []

		for (let segmentOffset = 0; segmentOffset < fftFramesLeft.length; segmentOffset += segmentHopSize) {
			const timePosition = segmentOffset * (fftHopSize / sampleRate)

			logger.start(`Process segment at time position ${timePosition.toFixed(2)}`)

			const fftFramesLeftComplexForSegment = fftFramesLeftComplex.slice(segmentOffset, segmentOffset + segmentSize)
			const fftFramesRightComplexForSegment = fftFramesRightComplex.slice(segmentOffset, segmentOffset + segmentSize)

			const segmentLength = fftFramesLeftComplexForSegment.length

			const flattenedInputTensor = new Float32Array(1 * 4 * fftCount * segmentSize)

			{
				let writePosition = 0

				for (let tensorChannelIndex = 0; tensorChannelIndex < 4; tensorChannelIndex++) {
					const isEvenTensorChannelIndex = tensorChannelIndex % 2 === 0
					const inChannelIndex = tensorChannelIndex < 2 ? 0 : 1

					for (let binIndex = 0; binIndex < fftCount; binIndex++) {
						for (let frameIndex = 0; frameIndex < segmentSize; frameIndex++) {
							let value = 0

							if (frameIndex < segmentLength && binIndex >= 0) {
								let frame: ComplexNumber[]

								if (inChannelIndex === 0) {
									frame = fftFramesLeftComplexForSegment[frameIndex]
								} else {
									frame = fftFramesRightComplexForSegment[frameIndex]
								}

								const bin = frame[binIndex]

								if (isEvenTensorChannelIndex) {
									value = bin.real
								} else {
									value = bin.imaginary
								}
							}

							flattenedInputTensor[writePosition++] = value
						}
					}
				}
			}

			const inputTensor = new Onnx.Tensor('float32', flattenedInputTensor, [1, 4, 2048, 256])

			logger.start('Run MDXNet model')

			const { output: outputTensor } = await session.run({ input: inputTensor })

			logger.start('Process MDXNet model output')

			const flattenedOutputTensor = outputTensor.data as Float32Array

			const outputChannelComplexFrames: ComplexNumber[][][] = []

			{
				for (let outChannelIndex = 0; outChannelIndex < 2; outChannelIndex++) {
					const framesForChannel: ComplexNumber[][] = []

					for (let frameIndex = 0; frameIndex < 256; frameIndex++) {
						const frame: ComplexNumber[] = []

						for (let binIndex = 0; binIndex < fftSize; binIndex++) {
							frame.push({ real: 0, imaginary: 0 })
						}

						framesForChannel.push(frame)
					}

					outputChannelComplexFrames.push(framesForChannel)
				}

				let readPosition = 0

				for (let tensorChannelIndex = 0; tensorChannelIndex < 4; tensorChannelIndex++) {
					const isEvenTensorChannelIndex = tensorChannelIndex % 2 === 0
					const outChannelIndex = tensorChannelIndex < 2 ? 0 : 1

					const binsForOutputChannel = outputChannelComplexFrames[outChannelIndex]

					for (let binIndex = 0; binIndex < 2048; binIndex++) {
						for (let frameIndex = 0; frameIndex < 256; frameIndex++) {
							const bin = binsForOutputChannel[frameIndex][binIndex]

							if (isEvenTensorChannelIndex) {
								bin.real = flattenedOutputTensor[readPosition++]
							} else {
								bin.imaginary = flattenedOutputTensor[readPosition++]
							}
						}
					}
				}
			}

			const outputAudioChannels: Float32Array[] = []

			logger.start(`Compute inverse STFT for segment`)
			for (let channelIndex = 0; channelIndex < 2; channelIndex++) {
				const fftSizeReciprocal = 1 / fftSize

				let outputChannelFlattenedFrames = outputChannelComplexFrames[channelIndex]
					.map(frame => complexToBinBuffer(frame).map(value => value * fftSizeReciprocal))

				const samples = await stiftr(
					outputChannelFlattenedFrames,
					fftSize,
					fftWindowSize,
					fftHopSize,
					'hann')

				outputAudioChannels.push(samples)
			}

			audioForSegments.push(outputAudioChannels)
		}

		// Join segments using overlapping Hann windows
		logger.start(`Join segments`)
		const concatenatedAudioChannels = [new Float32Array(sampleCount), new Float32Array(sampleCount)]

		{
			const segmentCount = audioForSegments.length

			const segmentSampleCount = audioForSegments[0][0].length

			const windowWeights = getWindowWeights('hann', segmentSampleCount)

			const sumOfWeightsForSample = new Float32Array(sampleCount)

			for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
				const segmentStartFrameIndex = segmentIndex * segmentHopSize
				const segmentStartSampleIndex = segmentStartFrameIndex * fftHopSize

				const segmentSamples = audioForSegments[segmentIndex]

				for (let segmentSampleOffset = 0; segmentSampleOffset < segmentSampleCount; segmentSampleOffset++) {
					const sampleIndex = segmentStartSampleIndex + segmentSampleOffset

					if (sampleIndex >= sampleCount) {
						break
					}

					const weight = windowWeights[segmentSampleOffset]

					for (let channelIndex = 0; channelIndex < 2; channelIndex++) {
						concatenatedAudioChannels[channelIndex][sampleIndex] += segmentSamples[channelIndex][segmentSampleOffset] * weight
					}

					sumOfWeightsForSample[sampleIndex] += weight
				}
			}

			for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
				for (let channelIndex = 0; channelIndex < 2; channelIndex++) {
					concatenatedAudioChannels[channelIndex][sampleIndex] /= sumOfWeightsForSample[sampleIndex] + 1e-8
				}
			}
		}

		const isolatedRawAudio: RawAudio = { audioChannels: concatenatedAudioChannels, sampleRate }

		logger.end()

		return isolatedRawAudio
	}

	private async initializeSessionIfNeeded() {
		if (this.session) {
			return
		}

		const Onnx = await import('onnxruntime-node')

		const onnxSessionOptions = getOnnxSessionOptions({ executionProviders: this.executionProviders })

		this.session = await Onnx.InferenceSession.create(this.modelFilePath, onnxSessionOptions)
	}
}
