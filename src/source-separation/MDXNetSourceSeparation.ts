import type * as Onnx from 'onnxruntime-node'
import { getEmptyRawAudio, RawAudio } from '../audio/AudioUtilities.js'
import { getWindowWeights, stftrGenerator, stiftr, WindowType } from '../dsp/FFT.js'
import { logToStderr } from '../utilities/Utilities.js'
import { Logger } from '../utilities/Logger.js'
import { OnnxExecutionProvider, dmlProviderAvailable, getOnnxSessionOptions } from '../utilities/OnnxUtilities.js'
import chalk from 'chalk'
import { WindowedList } from '../data-structures/WindowedList.js'
import { logLevelGreaterOrEqualTo } from '../api/API.js'

const log = logToStderr

export async function isolate(
	rawAudio: RawAudio,
	modelFilePath: string,
	modelProfile: MDXNetModelProfile,
	options: MDXNetOptions) {

	const model = new MDXNet(modelFilePath, modelProfile, options)

	return model.processAudio(rawAudio)
}

export class MDXNet {
	session?: Onnx.InferenceSession
	onnxSessionOptions?: Onnx.InferenceSession.SessionOptions

	constructor(
		public readonly modelFilePath: string,
		public readonly modelProfile: MDXNetModelProfile,
		public readonly options: MDXNetOptions) {
	}

	async processAudio(rawAudio: RawAudio) {
		if (rawAudio.audioChannels.length !== 2) {
			throw new Error(`Input audio must be stereo`)
		}

		if (rawAudio.sampleRate !== this.modelProfile.sampleRate) {
			throw new Error(`Input audio must have a sample rate of ${this.modelProfile.sampleRate} Hz`)
		}

		if (rawAudio.audioChannels[0].length === 0) {
			return getEmptyRawAudio(rawAudio.audioChannels.length, rawAudio.sampleRate)
		}

		const enableTraceLogging = logLevelGreaterOrEqualTo('trace')

		const logger = new Logger()

		await logger.startAsync(`Initialize session for MDX-NET model '${this.options.model!}'`)

		await this.initializeSessionIfNeeded()

		logger.end()

		logger.logTitledMessage(`Using ONNX execution provider`, `${this.onnxSessionOptions!.executionProviders!.join(', ')}`)

		const Onnx = await import('onnxruntime-node')

		const sampleRate = this.modelProfile.sampleRate
		const fftSize = this.modelProfile.fftSize
		const fftWindowSize = this.modelProfile.fftWindowSize
		const fftHopSize = this.modelProfile.fftHopSize
		const fftWindowType = this.modelProfile.fftWindowType

		const binCount = this.modelProfile.binCount

		const segmentSize = this.modelProfile.segmentSize
		const segmentHopSize = this.modelProfile.segmentHopSize

		const sampleCount = rawAudio.audioChannels[0].length

		const fftSizeReciprocal = 1 / fftSize

		// Initialize generators for STFT frames for each channel
		const fftFramesLeftGenerator = stftrGenerator(rawAudio.audioChannels[0], fftSize, fftWindowSize, fftHopSize, fftWindowType)
		const fftFramesRightGenerator = stftrGenerator(rawAudio.audioChannels[1], fftSize, fftWindowSize, fftHopSize, fftWindowType)

		// Initial windowed lists to store recently computed STFT frames
		const fftFramesLeftWindowedList = new WindowedList<Float32Array>(segmentSize)
		const fftFramesRightWindowedList = new WindowedList<Float32Array>(segmentSize)

		const audioForSegments: Float32Array[][] = []

		for (let segmentStartFrameOffset = 0; ; segmentStartFrameOffset += segmentHopSize) {
			const segmentEndFrameOffset = segmentStartFrameOffset + segmentSize

			const timePosition = segmentStartFrameOffset * (fftHopSize / sampleRate)

			if (enableTraceLogging) {
				await logger.startAsync(`Compute STFT of segment at time position ${timePosition.toFixed(2)}`, undefined, chalk.magentaBright)
			} else {
				await logger.startAsync(`Process segment at time position ${timePosition.toFixed(2)}`)
			}

			while (fftFramesLeftWindowedList.endOffset < segmentEndFrameOffset) {
				const nextLeftFrameResult = await fftFramesLeftGenerator.next()

				if (nextLeftFrameResult.done) {
					break
				}

				const nextRightFrameResult = await fftFramesRightGenerator.next()

				if (nextRightFrameResult.done) {
					break
				}

				fftFramesLeftWindowedList.add(nextLeftFrameResult.value)
				fftFramesRightWindowedList.add(nextRightFrameResult.value)
			}

			const fftFramesForSegment = [
				fftFramesLeftWindowedList.slice(segmentStartFrameOffset, segmentEndFrameOffset),
				fftFramesRightWindowedList.slice(segmentStartFrameOffset, segmentEndFrameOffset)
			]

			const segmentLength = fftFramesForSegment[0].length

			const isLastSegment = segmentLength < segmentSize

			if (enableTraceLogging) {
				await logger.startAsync(`Reshape STFT frames`)
			}

			const flattenedInputTensor = new Float32Array(1 * 4 * binCount * segmentSize)

			{
				let writePosition = 0

				// 4 tensor elements are structured as:
				// <Channel 0 real> <Channel 0 imaginary> <Channel 1 real> <Channel 1 imaginary>
				for (let tensorElementIndex = 0; tensorElementIndex < 4; tensorElementIndex++) {
					const isRealComponentTensorElementIndex = tensorElementIndex % 2 === 0
					const audioChannelIndex = tensorElementIndex < 2 ? 0 : 1

					for (let binIndex = 0; binIndex < binCount; binIndex++) {
						for (let frameIndex = 0; frameIndex < segmentSize; frameIndex++) {
							let value = 0

							if (frameIndex < segmentLength) {
								const frame = fftFramesForSegment[audioChannelIndex][frameIndex]

								if (isRealComponentTensorElementIndex) {
									value = frame[binIndex << 1]
								} else {
									value = frame[(binIndex << 1) + 1]
								}
							}

							flattenedInputTensor[writePosition++] = value
						}
					}
				}
			}

			if (enableTraceLogging) {
				await logger.startAsync(`Process segment with MDXNet model`)
			}

			const inputTensor = new Onnx.Tensor('float32', flattenedInputTensor, [1, 4, binCount, segmentSize])

			const { output: outputTensor } = await this.session!.run({ input: inputTensor })

			if (enableTraceLogging) {
				await logger.startAsync('Reshape processed frames')
			}

			const flattenedOutputTensor = outputTensor.data as Float32Array

			const outputSegmentFramesForChannel: Float32Array[][] = []

			{
				for (let outChannelIndex = 0; outChannelIndex < 2; outChannelIndex++) {
					const framesForChannel: Float32Array[] = []

					for (let frameIndex = 0; frameIndex < segmentSize; frameIndex++) {
						const frame = new Float32Array(fftSize)

						framesForChannel.push(frame)
					}

					outputSegmentFramesForChannel.push(framesForChannel)
				}

				let readPosition = 0

				for (let tensorChannelIndex = 0; tensorChannelIndex < 4; tensorChannelIndex++) {
					const isRealTensorChannelIndex = tensorChannelIndex % 2 === 0
					const audioChannelIndex = tensorChannelIndex < 2 ? 0 : 1

					const framesForOutputChannel = outputSegmentFramesForChannel[audioChannelIndex]

					for (let binIndex = 0; binIndex < binCount; binIndex++) {
						for (let frameIndex = 0; frameIndex < segmentSize; frameIndex++) {
							const outFrame = framesForOutputChannel[frameIndex]

							if (isRealTensorChannelIndex) {
								outFrame[binIndex << 1] = flattenedOutputTensor[readPosition++] * fftSizeReciprocal
							} else {
								outFrame[(binIndex << 1) + 1] = flattenedOutputTensor[readPosition++] * fftSizeReciprocal
							}
						}
					}
				}
			}

			const outputAudioChannels: Float32Array[] = []

			if (enableTraceLogging) {
				await logger.startAsync(`Compute inverse STFT of model output for segment`)
			}

			for (let channelIndex = 0; channelIndex < 2; channelIndex++) {
				const samples = await stiftr(
					outputSegmentFramesForChannel[channelIndex],
					fftSize,
					fftWindowSize,
					fftHopSize,
					fftWindowType)

				outputAudioChannels.push(samples)
			}

			audioForSegments.push(outputAudioChannels)

			if (isLastSegment) {
				break
			}
		}

		// Join segments using overlapping Hann windows
		await logger.startAsync(`Join segments`)
		const joinedSegments = [new Float32Array(sampleCount), new Float32Array(sampleCount)]

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
						joinedSegments[channelIndex][sampleIndex] += segmentSamples[channelIndex][segmentSampleOffset] * weight
					}

					sumOfWeightsForSample[sampleIndex] += weight
				}
			}

			for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
				for (let channelIndex = 0; channelIndex < 2; channelIndex++) {
					joinedSegments[channelIndex][sampleIndex] /= sumOfWeightsForSample[sampleIndex] + 1e-8
				}
			}
		}

		const isolatedRawAudio: RawAudio = { audioChannels: joinedSegments, sampleRate }

		logger.end()

		return isolatedRawAudio
	}

	private async initializeSessionIfNeeded() {
		if (this.session) {
			return
		}

		const Onnx = await import('onnxruntime-node')

		const executionProviders: OnnxExecutionProvider[] =
			this.options.provider ? [this.options.provider] : getDefaultMDXNetProviders()

		this.onnxSessionOptions = getOnnxSessionOptions({ executionProviders })

		this.session = await Onnx.InferenceSession.create(this.modelFilePath, this.onnxSessionOptions)
	}
}

export function getDefaultMDXNetProviders(): OnnxExecutionProvider[] {
	if (dmlProviderAvailable()) {
		return ['dml', 'cpu']
	} else {
		return []
	}
}

export function getProfileForMDXNetModelName(modelName: MDXNetModelName) {
	if (['UVR_MDXNET_1_9703', 'UVR_MDXNET_2_9682', 'UVR_MDXNET_3_9662', 'UVR_MDXNET_KARA'].includes(modelName)) {
		return mdxNetModelProfile1
	}

	if (['UVR_MDXNET_Main', 'Kim_Vocal_1', 'Kim_Vocal_2'].includes(modelName)) {
		return mdxNetModelProfile2
	}

	throw new Error(`Unsupported model name: '${modelName}'`)
}

export const mdxNetModelProfile1: MDXNetModelProfile = {
	sampleRate: 44100,

	fftSize: 6144,
	fftWindowSize: 6144,
	fftHopSize: 1024,
	fftWindowType: 'hann',

	binCount: 2048,

	segmentSize: 256,
	segmentHopSize: 224,
}

export const mdxNetModelProfile2: MDXNetModelProfile = {
	sampleRate: 44100,

	fftSize: 7680,
	fftWindowSize: 7680,
	fftHopSize: 1024,
	fftWindowType: 'hann',

	binCount: 3072,

	segmentSize: 256,
	segmentHopSize: 224,
}

export interface MDXNetModelProfile {
	sampleRate: number

	fftSize: number
	fftWindowSize: number
	fftHopSize: number
	fftWindowType: WindowType

	binCount: number

	segmentSize: number
	segmentHopSize: number
}

export type MDXNetModelName =
	'UVR_MDXNET_1_9703' |
	'UVR_MDXNET_2_9682' |
	'UVR_MDXNET_3_9662' |
	'UVR_MDXNET_KARA' |
	'UVR_MDXNET_Main' |
	'Kim_Vocal_1' |
	'Kim_Vocal_2'

export interface MDXNetOptions {
	model?: MDXNetModelName
	provider?: OnnxExecutionProvider
}

export const defaultMDXNetOptions: MDXNetOptions = {
	model: 'UVR_MDXNET_1_9703',
	provider: undefined,
}
