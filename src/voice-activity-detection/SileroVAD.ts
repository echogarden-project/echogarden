import type * as Onnx from 'onnxruntime-node'

import { concatFloat32Arrays } from '../utilities/Utilities.js'
import { RawAudio } from '../audio/AudioUtilities.js'

let sileroVad: SileroVAD

export async function detectVoiceActivity(rawAudio: RawAudio, modelPath: string, frameDuration: 30 | 60 | 90) {
	if (rawAudio.sampleRate != 16000) {
		throw new Error('Audio sample rate must be 16KHz')
	}

	const audioSamples = rawAudio.audioChannels[0]

	const frameLength = Math.floor(16000 * (frameDuration / 1000))

	if (!sileroVad) {
		sileroVad = new SileroVAD(modelPath)
	}

	const frameProbabilities: number[] = []

	for (let position = 0; position < audioSamples.length; position += frameLength) {
		let chunk = audioSamples.subarray(position, position + frameLength)

		if (chunk.length < frameLength) {
			chunk = concatFloat32Arrays([chunk, new Float32Array(frameLength - chunk.length)])
		}

		const probability = await sileroVad.predictAudioFrame(chunk)

		frameProbabilities.push(probability)
	}

	return frameProbabilities
}

export class SileroVAD {
	session?: Onnx.InferenceSession

	modelStateH?: Onnx.Tensor
	modelStateC?: Onnx.Tensor
	modelSampleRate?: Onnx.Tensor

	modelPath: string

	constructor(modelPath: string) {
		this.modelPath = modelPath
	}

	async predictAudioFrame(frame: Float32Array) {
		await this.initializeIfNeeded()

		const Onnx = await import('onnxruntime-node')

		const inputTensor = new Onnx.Tensor('float32', frame, [1, frame.length])

		const inputs = { input: inputTensor, sr: this.modelSampleRate!, h: this.modelStateH!, c: this.modelStateC! }

		const results = await this.session!.run(inputs)

		const probability = results['output'].data[0] as number

		this.modelStateH = results['hn']
		this.modelStateC = results['cn']

		return probability
	}
	private async initializeIfNeeded() {
		if (this.session) {
			return
		}

		const Onnx = await import('onnxruntime-node')

		const h = new Float32Array(2 * 1 * 64)
		const c = new Float32Array(2 * 1 * 64)

		this.modelStateH = new Onnx.Tensor('float32', h, [2, 1, 64])
		this.modelStateC = new Onnx.Tensor('float32', c, [2, 1, 64])

		this.modelSampleRate = new Onnx.Tensor('int64', new BigInt64Array([BigInt(16000)]), [])

		const onnxOptions: Onnx.InferenceSession.SessionOptions = {
			logSeverityLevel: 3
		}

		this.session = await Onnx.InferenceSession.create(this.modelPath, onnxOptions)
	}
}
