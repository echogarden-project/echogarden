import type * as Onnx from 'onnxruntime-node'
import { OnnxExecutionProvider, getOnnxSessionOptions } from '../utilities/OnnxUtilities.js';

import { RawAudio } from "../audio/AudioUtilities.js";
import { computeMelSpectrogram } from "../dsp/MelSpectrogram.js";
import { Logger } from '../utilities/Logger.js';
import { concatFloat32Arrays, splitFloat32Array } from '../utilities/Utilities.js';
import { applyEmphasis } from '../dsp/MFCC.js';

export function computeEmbeddings(audioSamples: RawAudio, modelFilePath: string, executionProviders: OnnxExecutionProvider[]) {
	const wav2vecBert = new Wav2Vec2BertFeatureEmbeddings(
		modelFilePath,
		executionProviders,
	)

	const result = wav2vecBert.computeEmbeddings(audioSamples)

	return result
}

export class Wav2Vec2BertFeatureEmbeddings {
	session?: Onnx.InferenceSession

	constructor(
		public readonly modelFilePath: string,
		public readonly executionProviders: OnnxExecutionProvider[]) {
	}

	async computeEmbeddings(rawAudio: RawAudio) {
		const logger = new Logger()

		rawAudio.audioChannels[0] = applyEmphasis(rawAudio.audioChannels[0], 0.97)

		const { melSpectrogram } = await computeMelSpectrogram(
			rawAudio,
			512,
			400,
			160,
			80,
			20,
			8000,
			'povey')

		// Ensure even length
		if (melSpectrogram.length % 2 != 0) {
			melSpectrogram.push(new Float32Array(80))
		}

		// Normalize filterbanks
		for (let filterbankIndex = 0; filterbankIndex < 80; filterbankIndex++) {
			let sum = 0
			let sumOfSquares = 0

			for (let i = 0; i < melSpectrogram.length; i++) {
				const value = melSpectrogram[i][filterbankIndex]

				sum += value
				sumOfSquares += value ** 2
			}

			const mean = sum / melSpectrogram.length
			const normalizationFactor = 1 / (Math.sqrt(sumOfSquares / melSpectrogram.length) + 1e-40)

			for (let i = 0; i < melSpectrogram.length; i++) {
				melSpectrogram[i][filterbankIndex] -= mean
				melSpectrogram[i][filterbankIndex] *= normalizationFactor
			}
		}

		// Flatten
		const flattenedMelSpectrogram = concatFloat32Arrays(melSpectrogram)

		// Initialize session
		await this.initializeSessionIfNeeded()

		const session = this.session!

		const Onnx = await import('onnxruntime-node')

		const inputTensor = new Onnx.Tensor('float32', flattenedMelSpectrogram, [1, melSpectrogram.length / 2, 80 * 2])

		const attentionMask = new Int32Array(melSpectrogram.length / 2).fill(1)
		const attentionMaskTensor = new Onnx.Tensor('int32', attentionMask, [1, attentionMask.length])

		// Run inference
		const outputs = await session.run({ 'input_features': inputTensor, 'attention_mask': attentionMaskTensor })

		// Return output
		const lastHiddenStateData = outputs['last_hidden_state'].data as Float32Array

		const outputEmbeddings = splitFloat32Array(lastHiddenStateData, outputs['last_hidden_state'].dims[2])

		return outputEmbeddings
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
