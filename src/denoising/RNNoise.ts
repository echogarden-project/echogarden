import { float32ToInt16Pcm } from '../audio/AudioBufferConversion.js'
import { concatFloat32Arrays } from '../utilities/Utilities.js'
import { WasmMemoryManager } from '../utilities/WasmMemoryManager.js'
import { Logger } from '../utilities/Logger.js'
import { RawAudio, cloneRawAudio } from '../audio/AudioUtilities.js'

let rnnoiseInstance: any

export async function denoiseAudio(rawAudio: RawAudio) {
	const logger = new Logger()
	if (rawAudio.sampleRate != 48000) {
		throw new Error(`RNNoise requires a 48000 Hz sample rate (${rawAudio.sampleRate} Hz given)`)
	}

	if (rawAudio.audioChannels.length !== 1) {
		throw new Error('RNNoise requires a channel count of 1')
	}

	if (rawAudio.audioChannels[0].length == 0) {
		return { denoisedRawAudio: cloneRawAudio(rawAudio), frameVadProbabilities: [] }
	}

	logger.start('Get RNNoise WASM instance')
	const m = await getRnnoiseInstance()

	logger.start('Process with RNNoise')
	const wasmMemory = new WasmMemoryManager(m)

	const stateSize = m._rnnoise_get_size()
	const frameSize = m._rnnoise_get_frame_size()

	const denoiseState = m._rnnoise_create(0)

	const inputRef = wasmMemory.allocFloat32Array(frameSize)
	const outputRef = wasmMemory.allocFloat32Array(frameSize)

	const floatSamples = rawAudio.audioChannels[0]
	const int16Samples = float32ToInt16Pcm(floatSamples)
	const int16SamplesAsFloats = new Float32Array(int16Samples)

	const processedFrames: Float32Array[] = []
	const frameVadProbabilities: number[] = []

	function outputNewFrame(newFrame: Float32Array, vadProbability: number) {
		processedFrames.push(newFrame)
		frameVadProbabilities.push(vadProbability)
	}

	for (let readOffset = 0; readOffset < int16Samples.length; readOffset += frameSize) {
		let frame = int16SamplesAsFloats.subarray(readOffset, readOffset + frameSize)

		if (frame.length < frameSize) {
			frame = concatFloat32Arrays([frame, new Float32Array(frameSize - frame.length)])
		}

		inputRef.view.set(frame)

		const vadProbability = m._rnnoise_process_frame(denoiseState, outputRef.address, inputRef.address)

		// Latency compensation: don't write an output frame for the first read frame
		if (readOffset > 0) {
			outputNewFrame(outputRef.view.slice(), vadProbability)
		}
	}

	// Latency compensation: process an empty input frame for the last output frame
	inputRef.view.set(new Float32Array(frameSize))

	const lastFrameVadProbability = m._rnnoise_process_frame(denoiseState, outputRef.address, inputRef.address)
	outputNewFrame(outputRef.view.slice(), lastFrameVadProbability)

	m._rnnoise_destroy(denoiseState)
	wasmMemory.freeAll()

	const int16DenoisedSamplesAsFloats = concatFloat32Arrays(processedFrames)

	let denoisedSamples = int16DenoisedSamplesAsFloats.map(sample => sample / 32768)
	denoisedSamples = denoisedSamples.subarray(0, floatSamples.length)

	const denoisedRawAudio: RawAudio = { audioChannels: [denoisedSamples], sampleRate: 48000 }

	logger.end()

	return { denoisedRawAudio, frameVadProbabilities }
}

export async function getRnnoiseInstance() {
	if (!rnnoiseInstance) {
		const { default: initializer } = await import('@echogarden/rnnoise-wasm')

		rnnoiseInstance = await initializer()
	}

	return rnnoiseInstance
}
