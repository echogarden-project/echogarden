import type * as Onnx from 'onnxruntime-node'
import { OnnxExecutionProvider, getOnnxSessionOptions } from '../utilities/OnnxUtilities.js';

import { RawAudio } from "../audio/AudioUtilities.js";
import { computeMelSpectogram } from "../dsp/MelSpectogram.js";
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

		const { melSpectogram } = await computeMelSpectogram(
			rawAudio,
			512,
			400,
			160,
			80,
			20,
			8000,
			'povey')

		// Ensure even length
		if (melSpectogram.length % 2 != 0) {
			melSpectogram.push(new Float32Array(80))
		}

		// Normalize filterbanks
		for (let filterbankIndex = 0; filterbankIndex < 80; filterbankIndex++) {
			let sum = 0
			let sumOfSquares = 0

			for (let i = 0; i < melSpectogram.length; i++) {
				const value = melSpectogram[i][filterbankIndex]

				sum += value
				sumOfSquares += value ** 2
			}

			const mean = sum / melSpectogram.length
			const normalizationFactor = 1 / (Math.sqrt(sumOfSquares / melSpectogram.length) + 1e-40)

			for (let i = 0; i < melSpectogram.length; i++) {
				melSpectogram[i][filterbankIndex] -= mean
				melSpectogram[i][filterbankIndex] *= normalizationFactor
			}
		}

		// Flatten
		const flattenedMelSpectogram = concatFloat32Arrays(melSpectogram)

		// Initialize session
		await this.initializeSessionIfNeeded()

		const session = this.session!

		const Onnx = await import('onnxruntime-node')

		const inputTensor = new Onnx.Tensor('float32', flattenedMelSpectogram, [1, melSpectogram.length / 2, 80 * 2])

		const attentionMask = new Int32Array(melSpectogram.length / 2).fill(1)
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
