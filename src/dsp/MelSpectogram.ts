import { RawAudio } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'
import * as FFT from './FFT.js'

export async function computeMelSpectogram(rawAudio: RawAudio, fftOrder: number, windowSize: number, hopLength: number, filterbankCount: number, lowerFrequencyHz: number, upperFrequencyHz: number, windowType: FFT.WindowType = 'hann') {
	const logger = new Logger()

	logger.start('Compute mel filterbank')
	const binCount = (fftOrder / 2) + 2
	const nyquistFrequency = rawAudio.sampleRate / 2
	const binFrequencies = FFT.getBinFrequencies(binCount, nyquistFrequency)

	const lowerFrequencyMel = hertzToMel(lowerFrequencyHz)
	const upperFrequencyMel = hertzToMel(upperFrequencyHz)

	const filterbanksCenterFrequencies = getMelFilterbanksCenterFrequencies(filterbankCount, lowerFrequencyMel, upperFrequencyMel)
	const melFilterbanks = getMelFilterbanks(binFrequencies, filterbanksCenterFrequencies, lowerFrequencyMel, upperFrequencyMel)

	logger.end()

	return computeMelSpectogramUsingFilterbanks(rawAudio, fftOrder, windowSize, hopLength, melFilterbanks, windowType)
}

export async function computeMelSpectogramUsingFilterbanks(rawAudio: RawAudio, fftOrder: number, windowSize: number, hopLength: number, filterbanks: Filterbank[], windowType: FFT.WindowType = 'hann') {
	const logger = new Logger()

	logger.start('Compute short-time FFTs')
	const audioSamples = rawAudio.audioChannels[0]
	const fftFrames = await FFT.stftr(audioSamples, fftOrder, windowSize, hopLength, windowType)

	logger.start('Convert FFT frames to a mel spectogram')
	const melSpectogram = fftFramesToMelSpectogram(fftFrames, filterbanks)

	logger.end()

	return { melSpectogram, fftFrames }
}

export function fftFramesToMelSpectogram(fftFrames: Float32Array[], melFilterbanks: Filterbank[]) {
	return fftFrames.map(fftFrame => {
		const powerSpectrum = FFT.fftFrameToPowerSpectrum(fftFrame)
		return powerSpectrumToMelSpectrum(powerSpectrum, melFilterbanks)
	})
}

export function powerSpectrumToMelSpectrum(powerSpectrum: Float32Array, filterbanks: Filterbank[]) {
	const filterbankCount = filterbanks.length
	const melSpectrum = new Float32Array(filterbankCount)

	for (let melBandIndex = 0; melBandIndex < filterbankCount; melBandIndex++) {
		const filterbank = filterbanks[melBandIndex]
		const filterbankStartIndex = filterbank.startIndex
		const filterbankWeights = filterbank.weights

		if (filterbankStartIndex === -1) {
			continue
		}

		let melBandValue = 0

		for (let i = 0; i < filterbankWeights.length; i++) {
			const powerSpectrumIndex = filterbankStartIndex + i

			if (powerSpectrumIndex >= powerSpectrum.length) {
				break
			}

			const weight = filterbankWeights[i]
			const powerSpectrumValue = powerSpectrum[powerSpectrumIndex]

			melBandValue += weight * powerSpectrumValue
		}

		melSpectrum[melBandIndex] = melBandValue
	}

	return melSpectrum
}

export function getMelFilterbanks(powerSpectrumFrequenciesHz: Float32Array, centerFrequenciesMel: Float32Array, lowerFrequencyMel: number, upperFrequencyMel: number) {
	const filterbankCount = centerFrequenciesMel.length
	const powerSpectrumFrequenciesMel = powerSpectrumFrequenciesHz.map(frequencyHz => hertzToMel(frequencyHz))

	const filterbanks: Filterbank[] = []

	for (let filterbankIndex = 0; filterbankIndex < filterbankCount; filterbankIndex++) {
		const centerFrequency = centerFrequenciesMel[filterbankIndex]

		const leftFrequency = filterbankIndex > 0 ? centerFrequenciesMel[filterbankIndex - 1] : lowerFrequencyMel
		const rightFrequency = filterbankIndex < filterbankCount - 1 ? centerFrequenciesMel[filterbankIndex + 1] : upperFrequencyMel

		const width = rightFrequency - leftFrequency
		const halfWidth = width / 2

		let startIndex = -1
		let weights: number[] = []

		let weightSum = 0

		for (let powerSpectrumBandIndex = 0; powerSpectrumBandIndex < powerSpectrumFrequenciesMel.length; powerSpectrumBandIndex++) {
			const powerSpectrumBandFrequencyMel = powerSpectrumFrequenciesMel[powerSpectrumBandIndex]

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

		filterbanks.push({ startIndex, weights })
	}

	return filterbanks
}

export function getMelFilterbanksCenterFrequencies(melBandCount: number, lowerFrequencyMel: number, upperFrequencyMel: number) {
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

export type Filterbank = {
	startIndex: number
	weights: number[]
}
