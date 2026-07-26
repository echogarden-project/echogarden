import { OperationCallbacks } from '../api/Common.js'
import { RawAudio } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'
import * as FFT from './FFT.js'

export async function computeMelSpectrogram(
	rawAudio: RawAudio,
	fftOrder: number,
	windowSize: number,
	hopLength: number,
	melBandCount: number,
	lowerFrequencyHz: number,
	upperFrequencyHz: number,
	windowType: FFT.WindowType = 'hann',
	callbacks: OperationCallbacks) {

	const binCount = (fftOrder / 2) + 2
	const nyquistFrequency = rawAudio.sampleRate / 2
	const binFrequencies = FFT.getBinFrequencies(binCount, nyquistFrequency)

	const lowerFrequencyMel = hertzToMel(lowerFrequencyHz)
	const upperFrequencyMel = hertzToMel(upperFrequencyHz)

	const filterbankCenterFrequencies = getMelFilterbankCenterFrequencies(melBandCount, lowerFrequencyMel, upperFrequencyMel)
	const melFilterbank = getMelFilterbank(binFrequencies, filterbankCenterFrequencies, lowerFrequencyMel, upperFrequencyMel)

	return computeMelSpectrogramUsingFilterbank(rawAudio, fftOrder, windowSize, hopLength, melFilterbank, windowType, callbacks)
}

export async function computeMelSpectrogramUsingFilterbank(
	rawAudio: RawAudio,
	fftOrder: number,
	windowSize: number,
	hopLength: number,
	filterbank: Filterbank,
	windowType: FFT.WindowType = 'hann',
	callbacks: OperationCallbacks) {

	const logger = new Logger(callbacks.logLevel)

	logger.start('Compute short-time FFTs')
	const audioSamples = rawAudio.audioChannels[0]
	const fftFrames = await FFT.stftr(audioSamples, fftOrder, windowSize, hopLength, windowType)

	logger.start('Convert FFT frames to Mel spectrogram')
	const melSpectrogram = fftFramesToMelSpectrogram(fftFrames, filterbank)

	logger.end()

	return { melSpectrogram, fftFrames }
}

export function fftFramesToMelSpectrogram(fftFrames: Float32Array[], melFilterbank: Filterbank) {
	return fftFrames.map(fftFrame => {
		const powerSpectrum = FFT.fftFrameToPowerSpectrum(fftFrame)

		return powerSpectrumToMelSpectrum(powerSpectrum, melFilterbank)
	})
}

export function powerSpectrumToMelSpectrum(powerSpectrum: Float32Array, filterbank: Filterbank) {
	const melBandCount = filterbank.length
	const melSpectrum = new Float32Array(melBandCount)

	for (let melBandIndex = 0; melBandIndex < melBandCount; melBandIndex++) {
		const melFilter = filterbank[melBandIndex]
		const melFilterStartIndex = melFilter.startIndex
		const melFilterWeights = melFilter.weights

		if (melFilterStartIndex === -1) {
			continue
		}

		let melBandValue = 0

		for (let i = 0; i < melFilterWeights.length; i++) {
			const powerSpectrumIndex = melFilterStartIndex + i

			if (powerSpectrumIndex >= powerSpectrum.length) {
				break
			}

			const weight = melFilterWeights[i]
			const powerSpectrumValue = powerSpectrum[powerSpectrumIndex]

			melBandValue += weight * powerSpectrumValue
		}

		melSpectrum[melBandIndex] = melBandValue
	}

	return melSpectrum
}

export function getMelFilterbank(
	powerSpectrumFrequenciesHz: Float32Array,
	centerFrequenciesMel: Float32Array,
	lowerFrequencyMel: number,
	upperFrequencyMel: number) {

	const melBandCount = centerFrequenciesMel.length
	const filterbank: Filterbank = []

	for (let filterbankIndex = 0; filterbankIndex < melBandCount; filterbankIndex++) {
		const centerFrequency = centerFrequenciesMel[filterbankIndex]

		const leftFrequency = filterbankIndex > 0 ? centerFrequenciesMel[filterbankIndex - 1] : lowerFrequencyMel
		const rightFrequency = filterbankIndex < melBandCount - 1 ? centerFrequenciesMel[filterbankIndex + 1] : upperFrequencyMel

		const width = rightFrequency - leftFrequency
		const halfWidth = width / 2

		let startIndex = -1
		let weights: number[] = []

		let weightSum = 0

		for (let powerSpectrumBandIndex = 0; powerSpectrumBandIndex < powerSpectrumFrequenciesHz.length; powerSpectrumBandIndex++) {
			const powerSpectrumBandFrequencyHz = powerSpectrumFrequenciesHz[powerSpectrumBandIndex]
			const powerSpectrumBandFrequencyMel = hertzToMel(powerSpectrumBandFrequencyHz)

			let weight = 0

			if (powerSpectrumBandFrequencyMel >= leftFrequency && powerSpectrumBandFrequencyMel <= centerFrequency) {
				weight = (powerSpectrumBandFrequencyMel - leftFrequency) / halfWidth
			} else if (powerSpectrumBandFrequencyMel > centerFrequency && powerSpectrumBandFrequencyMel <= rightFrequency) {
				weight = (rightFrequency - powerSpectrumBandFrequencyMel) / halfWidth
			}

			if (weight > 0) {
				if (startIndex == -1) {
					startIndex = powerSpectrumBandIndex
				}

				weights.push(weight)
				weightSum += weight
			} else if (startIndex != -1) {
				break
			}
		}

		weights = weights.map(weight => weight / weightSum)

		filterbank.push({ startIndex, weights })
	}

	return filterbank
}

export function getMelFilterbankCenterFrequencies(melBandCount: number, lowerFrequencyMel: number, upperFrequencyMel: number) {
	const stepSizeMel = (upperFrequencyMel - lowerFrequencyMel) / (melBandCount + 1)

	const centerFrequencies = new Float32Array(melBandCount)

	for (let i = 0; i < melBandCount; i++) {
		centerFrequencies[i] = lowerFrequencyMel + ((i + 1) * stepSizeMel)
	}

	return centerFrequencies
}

export function hertzToMel(frequency: number) {
	return 2595.0 * Math.log10(1.0 + (frequency / 700.0))
}

export function melToHertz(mel: number) {
	return 700.0 * (Math.pow(10.0, mel / 2595.0) - 1.0)
}

export type Filterbank = FilterbankElement[]

export interface FilterbankElement {
	startIndex: number
	weights: number[]
}
