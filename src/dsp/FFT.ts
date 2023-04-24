import { RawAudio } from "../audio/AudioUtilities.js"
import { concatFloat32Arrays } from "../utilities/Utilities.js"
import { WasmMemoryManager } from "../utilities/WasmMemoryManager.js"

let kissFFTInstance: any

export async function stftr(samples: Float32Array, fftOrder: number, windowSize: number, hopLength: number, windowType: WindowType) {
	if (fftOrder % 2 != 0 || windowSize % 2 != 0) {
		throw new Error("FFT order and window size must multiples of 2")
	}

	if (windowSize > fftOrder) {
		throw new Error("Window size must be lesser or equal to the FFT order")
	}

	const halfWindowSize = windowSize / 2

	const padding = new Float32Array(halfWindowSize)
	samples = concatFloat32Arrays([padding, samples, padding])

	const windowWeights = getWindowWeights(windowType, windowSize)

	const m = await getKissFFTInstance()
	const wasmMemory = new WasmMemoryManager(m)

	const statePtr = m._kiss_fftr_alloc(fftOrder, 0, 0, 0)
	wasmMemory.wrapPointer(statePtr)

	const sampleCount = samples.length
	const frameBufferRef = wasmMemory.allocFloat32Array(fftOrder)
	const binsBufferRef = wasmMemory.allocFloat32Array(fftOrder * 2)

	const frames: Float32Array[] = []

	for (let offset = 0; offset < sampleCount; offset += hopLength) {
		const windowSamples = samples.subarray(offset, offset + windowSize)
		frameBufferRef.clear()

		const frameBufferView = frameBufferRef.view

		for (let i = 0; i < windowSamples.length; i++) {
			frameBufferView[i] = windowSamples[i] * windowWeights[i]
		}

		binsBufferRef.clear()
		m._kiss_fftr(statePtr, frameBufferRef.address, binsBufferRef.address)

		const bins = binsBufferRef.view.slice(0, fftOrder + 2)
		frames.push(bins)
	}

	wasmMemory.freeAll()

	return frames
}

export async function stiftr(binsForFrames: Float32Array[], fftOrder: number, windowSize: number, hopSize: number, windowType: WindowType, expectedOutputLength: number) {
	if (fftOrder % 2 != 0 || windowSize % 2 != 0) {
		throw new Error("FFT order and window size must multiples of 2")
	}

	if (windowSize > fftOrder) {
		throw new Error("Window size must be lesser or equal to the FFT order")
	}

	const halfWindowSize = windowSize / 2

	if (hopSize != halfWindowSize) {
		throw new Error("To perform inverse short-time FFT, hop size must be half the window size")
	}

	if (windowType != "hann") {
		throw new Error("Only Hann window is currently supported for inverse short-time FFT")
	}

	const m = await getKissFFTInstance()
	const wasmMemory = new WasmMemoryManager(m)

	const statePtr = m._kiss_fftr_alloc(fftOrder, 1, 0, 0)
	wasmMemory.wrapPointer(statePtr)

	const outSamples = new Float32Array(binsForFrames.length * hopSize)

	const frameBufferRef = wasmMemory.allocFloat32Array(fftOrder)
	const binsRef = wasmMemory.allocFloat32Array(fftOrder * 2)

	for (let frameIndex = 0, writeOffset = 0; frameIndex < binsForFrames.length; frameIndex++, writeOffset += hopSize) {
		const bins = binsForFrames[frameIndex]
		binsRef.clear()
		binsRef.view.set(bins)

		frameBufferRef.clear()
		m._kiss_fftri(statePtr, binsRef.address, frameBufferRef.address)

		const frameSamples = frameBufferRef.view
		for (let i = 0; i < windowSize; i++) {
			outSamples[writeOffset + i] += frameSamples[i]
		}
	}

	wasmMemory.freeAll()

	return outSamples.subarray(halfWindowSize, halfWindowSize + expectedOutputLength)
}

export function getBinFrequencies(binCount: number, maxFrequency: number) {
	const binFrequencies = new Float32Array(binCount)
	const frequencyStep = maxFrequency / (binCount - 1)

	for (let i = 0, frequency = 0; i < binFrequencies.length; i++, frequency += frequencyStep) {
		binFrequencies[i] = frequency
	}

	return binFrequencies
}

export function fftFramesToPowerSpectogram(fftFrames: Float32Array[]) {
	return fftFrames.map(fftFrame => fftFrameToPowerSpectrum(fftFrame))
}

export function fftFrameToPowerSpectrum(fftFrame: Float32Array) {
	const powerSpectrum = new Float32Array(fftFrame.length / 2)

	for (let i = 0; i < powerSpectrum.length; i++) {
		const binOffset = i * 2
		const fftCoefficientRealPart = fftFrame[binOffset]
		const fftCoefficientImaginaryPart = fftFrame[binOffset + 1]
		const binPower = (fftCoefficientRealPart ** 2) + (fftCoefficientImaginaryPart ** 2)

		powerSpectrum[i] = binPower
	}

	return powerSpectrum
}

export async function getKissFFTInstance() {
	if (!kissFFTInstance) {
		const { default: initializer } = await import('@echogarden/kissfft-wasm')

		kissFFTInstance = await initializer()
	}

	return kissFFTInstance
}

function getWindowWeights(windowType: WindowType, windowSize: number) {
	const weights = new Float32Array(windowSize)

	if (windowType == "hann") {
		//const innerMultiplier = (2 * Math.PI) / (windowSize - 1)

		for (let i = 0; i < windowSize; i++) {
			weights[i] = 0.5 * (1 - Math.cos(2 * Math.PI * (i / (windowSize - 1))))
			//weights[i] = 0.5 * (1 - Math.cos(innerMultiplier * i))
		}
	} else if (windowType == "hamming") {
		for (let i = 0; i < windowSize; i++) {
			weights[i] = 0.54 - (0.46 * Math.cos(2 * Math.PI * (i / (windowSize - 1))))
			//weights[i] = 0.54 - (0.46 * Math.cos(i * innerMultiplier))
		}
	} else {
		throw new Error(`Unsupported window function type: ${windowType}`)
	}

	return weights
}

export async function testFFT1(rawAudio: RawAudio) {
	const { resampleAudioSpeex } = await import("./SpeexResampler.js")

	const samples = (await resampleAudioSpeex(rawAudio, 16000)).audioChannels[0]

	const fftOrder = 512
	const windowSize = 320
	const hopLength = windowSize / 2
	const windowType: WindowType = "hann"

	const bins = await stftr(samples, fftOrder, windowSize, hopLength, windowType)
	const normalizedBins = bins.map(bin => bin.map(x => x / fftOrder))
	const recoveredSamples = await stiftr(normalizedBins, fftOrder, windowSize, hopLength, windowType, samples.length)

	const recoveredRawAudio: RawAudio = { audioChannels: [recoveredSamples], sampleRate: 16000 }

	return recoveredRawAudio
}

export type WindowType = "hann" | "hamming"
