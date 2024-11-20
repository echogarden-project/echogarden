import { ComplexNumber } from '../math/VectorMath.js'
import { concatFloat32Arrays, isWasmSimdSupported } from '../utilities/Utilities.js'
import { WasmMemoryManager } from '../utilities/WasmMemoryManager.js'

// Compute short-term Fourier transform (real-valued)
export async function stftr(samples: Float32Array, fftOrder: number, windowSize: number, hopSize: number, windowType: WindowType) {
	const frames: Float32Array[] = []

	for await (const frame of stftrGenerator(samples, fftOrder, windowSize, hopSize, windowType)) {
		frames.push(frame)
	}

	return frames
}

// Incrementally generate short-term Fourier transform frames (real-valued)
export async function* stftrGenerator(samples: Float32Array, fftOrder: number, windowSize: number, hopSize: number, windowType: WindowType) {
	if (fftOrder % 2 != 0 || windowSize % 2 != 0) {
		throw new Error('FFT order and window size must be multiples of 2')
	}

	if (windowSize > fftOrder) {
		throw new Error('Window size must be lesser or equal to the FFT size')
	}

	if (hopSize > windowSize) {
		throw new Error('Hop size must be lesser or equal to the window size')
	}

	const halfWindowSize = windowSize / 2

	const padding = new Float32Array(halfWindowSize)
	samples = concatFloat32Arrays([padding, samples, padding])

	const windowWeights = getWindowWeights(windowType, windowSize)

	const m = await getPFFFTInstance(await isPffftSimdSupportedForFFTOrder(fftOrder))
	const wasmMemory = new WasmMemoryManager(m, {
		wasmAlloc: m._pffft_aligned_malloc,
		wasmFree: m._pffft_aligned_free
	})

	const statePtr = m._pffft_new_setup(fftOrder, 0)

	const sampleCount = samples.length
	const frameBufferRef = wasmMemory.allocFloat32Array(fftOrder)
	const binsBufferRef = wasmMemory.allocFloat32Array(fftOrder * 2)
	const workBufferRef = wasmMemory.allocFloat32Array(fftOrder * 2)

	for (let offset = 0; offset < sampleCount; offset += hopSize) {
		const windowSamples = samples.subarray(offset, offset + windowSize)
		frameBufferRef.clear()

		const frameBufferView = frameBufferRef.view

		for (let i = 0; i < windowSamples.length; i++) {
			frameBufferView[i] = windowSamples[i] * windowWeights[i]
		}

		binsBufferRef.clear()

		m._pffft_transform_ordered(statePtr, frameBufferRef.address, binsBufferRef.address, workBufferRef.address, 0)

		const bins = binsBufferRef.view.slice(0, fftOrder + 2)

		yield bins
	}

	m._pffft_destroy_setup(statePtr)

	wasmMemory.freeAll()
}

// Compute short-term inverse Fourier transform (real-valued)
export async function stiftr(binsForFrames: Float32Array[], fftOrder: number, windowSize: number, hopSize: number, windowType: WindowType, expectedOutputLength?: number) {
	if (fftOrder % 2 != 0 || windowSize % 2 != 0) {
		throw new Error('FFT order and window size must multiples of 2')
	}

	if (windowSize > fftOrder) {
		throw new Error('Window size must be lesser or equal to the FFT size')
	}

	if (hopSize > windowSize) {
		throw new Error('Hop size must be lesser or equal to the window size')
	}

	const frameCount = binsForFrames.length

	const halfWindowSize = windowSize / 2

	const windowWeights = getWindowWeights(windowType, windowSize)

	const outSampleCount = hopSize * frameCount

	if (expectedOutputLength == null) {
		expectedOutputLength = outSampleCount
	}

	const outSamples = new Float32Array(outSampleCount)

	const m = await getPFFFTInstance(await isPffftSimdSupportedForFFTOrder(fftOrder))

	const wasmMemory = new WasmMemoryManager(m, {
		wasmAlloc: m._pffft_aligned_malloc,
		wasmFree: m._pffft_aligned_free
	})

	const statePtr = m._pffft_new_setup(fftOrder, 0)

	const frameBufferRef = wasmMemory.allocFloat32Array(fftOrder)
	const binsRef = wasmMemory.allocFloat32Array(fftOrder * 2)
	const workBufferRef = wasmMemory.allocFloat32Array(fftOrder * 2)

	const sumOfSquaredWeightsForSample = new Float32Array(outSampleCount)

	for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
		const binsForFrame = binsForFrames[frameIndex]
		binsRef.clear()
		binsRef.view.set(binsForFrame)

		frameBufferRef.clear()

		m._pffft_transform_ordered(statePtr, binsRef.address, frameBufferRef.address, workBufferRef.address, 1)

		const frameSamples = frameBufferRef.view

		const frameStartOffset = frameIndex * hopSize

		for (let windowOffset = 0; windowOffset < windowSize; windowOffset++) {
			const frameSample = frameSamples[windowOffset]
			const weight = windowWeights[windowOffset]

			const writePosition = frameStartOffset + windowOffset

			outSamples[writePosition] += frameSample * weight

			sumOfSquaredWeightsForSample[writePosition] += weight ** 2
		}
	}

	m._pffft_destroy_setup(statePtr)
	wasmMemory.freeAll()

	// Divide each output sample by the sum of squared weights
	for (let i = 0; i < outSamples.length; i++) {
		outSamples[i] /= sumOfSquaredWeightsForSample[i] + 1e-8
	}

	const outSamplesTrimmed = outSamples.slice(halfWindowSize, halfWindowSize + expectedOutputLength)

	return outSamplesTrimmed
}

// Get bin frequency thresholds for a particular bin count and maximum frequency
export function getBinFrequencies(binCount: number, maxFrequency: number) {
	const binFrequencies = new Float32Array(binCount)
	const frequencyStep = maxFrequency / (binCount - 1)

	for (let i = 0, frequency = 0; i < binFrequencies.length; i++, frequency += frequencyStep) {
		binFrequencies[i] = frequency
	}

	return binFrequencies
}

// Convert an array of raw FFT frames to a power spectrum
export function fftFramesToPowerSpectogram(fftFrames: Float32Array[]) {
	return fftFrames.map(fftFrame => fftFrameToPowerSpectrum(fftFrame))
}

// Convert a raw FFT frame to a power spectrum
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

// Convert raw FFT frames to an array of complex numbers
export function binBufferToComplex(bins: Float32Array, extendAndMirror = false) {
	const complexBins: ComplexNumber[] = []

	for (let i = 0; i < bins.length; i += 2) {
		complexBins.push({
			real: bins[i],
			imaginary: bins[i + 1]
		})
	}

	if (extendAndMirror) {
		const fftSize = bins.length - 2

		for (let i = complexBins.length; i < fftSize; i++) {
			const complexBinToMirror = complexBins[fftSize - i]

			complexBins.push({
				real: complexBinToMirror.real,
				imaginary: -complexBinToMirror.imaginary
			})
		}
	}

	return complexBins
}

// Convert an array of complex numbers to raw FFT frames
export function complexToBinBuffer(complexBins: ComplexNumber[]) {
	const binBuffer = new Float32Array(complexBins.length * 2)

	for (let i = 0, outIndex = 0; i < complexBins.length; i++) {
		const complexBin = complexBins[i]

		binBuffer[outIndex++] = complexBin.real
		binBuffer[outIndex++] = complexBin.imaginary
	}

	return binBuffer
}

// Convert complex bin to magnitude and phase
export function complexToMagnitudeAndPhase(real: number, imaginary: number) {
	const magnitude = Math.sqrt((real ** 2) + (imaginary ** 2))
	const phase = Math.atan2(imaginary, real)

	return { magnitude, phase }
}

// Convert magnitude and phase to complex bin
export function magnitudeAndPhaseToComplex(magnitude: number, phase: number) {
	const real = magnitude * Math.cos(phase)
	const imaginary = magnitude * Math.sin(phase)

	return { real, imaginary } as ComplexNumber
}

// Get window weights for a particular window function
export function getWindowWeights(windowType: WindowType, windowSize: number) {
	const weights = new Float32Array(windowSize)

	const innerFactor = (2 * Math.PI) / (windowSize - 1)

	if (windowType == 'hann') {
		for (let i = 0; i < windowSize; i++) {
			//weights[i] = 0.5 * (1 - Math.cos(2 * Math.PI * (i / (windowSize - 1))))
			weights[i] = 0.5 * (1 - Math.cos(innerFactor * i))
		}
	} else if (windowType == 'hann-sqrt') {
		for (let i = 0; i < windowSize; i++) {
			weights[i] = Math.sqrt(0.5 * (1 - Math.cos(innerFactor * i)))
		}
	} else if (windowType == 'hamming') {
		for (let i = 0; i < windowSize; i++) {
			//weights[i] = 0.54 - (0.46 * Math.cos(2 * Math.PI * (i / (windowSize - 1))))
			weights[i] = 0.54 - (0.46 * Math.cos(innerFactor * i))
		}
	} else if (windowType == 'povey') {
		const hannWeights = getWindowWeights('hann', windowSize)

		for (let i = 0; i < windowSize; i++) {
			weights[i] = hannWeights[i] ** 0.85
		}
	} else {
		throw new Error(`Unsupported window function type: ${windowType}`)
	}

	return weights
}

export async function isPffftSimdSupportedForFFTOrder(fftOrder: number) {
	const simdSupported = await isWasmSimdSupported()

	if (simdSupported === false) {
		return false
	}

	return fftOrder % 32 === 0
}

let pffftNonSimdInstance: any
let pffftSimdInstance: any

export async function getPFFFTInstance(enableSimd: boolean) {
	return enableSimd ? getSimdPFFFTInstance() : getNonSimdPFFFTInstance()
}

// Get non-SIMD PFFFT instance (initialize new if not exists)
async function getNonSimdPFFFTInstance() {
	const { default: initializer } = await import('@echogarden/pffft-wasm')

	pffftNonSimdInstance = await initializer()

	return pffftNonSimdInstance
}

// Get SIMD PFFFT instance (initialize new if not exists)
async function getSimdPFFFTInstance() {
	const { default: initializer } = await import('@echogarden/pffft-wasm/simd')

	pffftSimdInstance = await initializer()

	return pffftSimdInstance
}

export type WindowType = 'hann' | 'hann-sqrt' | 'hamming' | 'povey'
