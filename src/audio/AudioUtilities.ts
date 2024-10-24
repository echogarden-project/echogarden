import * as FFMpegTranscoder from '../codecs/FFMpegTranscoder.js'
import { SampleFormat, encodeWave, decodeWave, BitDepth } from '../codecs/WaveCodec.js'
import { resampleAudioSpeex } from '../dsp/SpeexResampler.js'
import { Timeline } from '../utilities/Timeline.js'
import { concatFloat32Arrays } from '../utilities/Utilities.js'

////////////////////////////////////////////////////////////////////////////////////////////////
// Wave encoding and decoding
////////////////////////////////////////////////////////////////////////////////////////////////
export function encodeRawAudioToWave(rawAudio: RawAudio, bitDepth: BitDepth = 16, sampleFormat: SampleFormat = SampleFormat.PCM, speakerPositionMask = 0) {
	return encodeWave(rawAudio, bitDepth, sampleFormat, speakerPositionMask)
}

export function decodeWaveToRawAudio(waveFileBuffer: Uint8Array, ignoreTruncatedChunks = true, ignoreOverflowingDataChunks = true) {
	return decodeWave(waveFileBuffer, ignoreTruncatedChunks, ignoreOverflowingDataChunks)
}

////////////////////////////////////////////////////////////////////////////////////////////////
// Audio trimming
////////////////////////////////////////////////////////////////////////////////////////////////
const defaultSilenceThresholdDecibels = -40

export function trimAudioStart(audioSamples: Float32Array, targetStartSilentSampleCount = 0, amplitudeThresholdDecibels = defaultSilenceThresholdDecibels) {
	const silentSampleCount = getStartingSilentSampleCount(audioSamples, amplitudeThresholdDecibels)

	const trimmedAudio = audioSamples.subarray(silentSampleCount, audioSamples.length)
	const restoredSilence = new Float32Array(targetStartSilentSampleCount)

	const trimmedAudioSamples = concatFloat32Arrays([restoredSilence, trimmedAudio])

	return trimmedAudioSamples
}

export function trimAudioEnd(audioSamples: Float32Array, targetEndSilentSampleCount = 0, amplitudeThresholdDecibels = defaultSilenceThresholdDecibels) {
	if (audioSamples.length === 0) {
		return new Float32Array(0)
	}

	const silentSampleCount = getEndingSilentSampleCount(audioSamples, amplitudeThresholdDecibels)

	const trimmedAudio = audioSamples.subarray(0, audioSamples.length - silentSampleCount)
	const restoredSilence = new Float32Array(targetEndSilentSampleCount)

	const trimmedAudioSamples = concatFloat32Arrays([trimmedAudio, restoredSilence])

	return trimmedAudioSamples
}

export function getStartingSilentSampleCount(audioSamples: Float32Array, amplitudeThresholdDecibels = defaultSilenceThresholdDecibels) {
	const sampleCount = audioSamples.length

	const minSampleAmplitude = decibelsToGainFactor(amplitudeThresholdDecibels)

	let silentSampleCount = 0

	for (let i = 0; i < sampleCount - 1; i++) {
		if (Math.abs(audioSamples[i]) > minSampleAmplitude) {
			break
		}

		silentSampleCount += 1
	}

	return silentSampleCount
}

export function getEndingSilentSampleCount(audioSamples: Float32Array, amplitudeThresholdDecibels = defaultSilenceThresholdDecibels) {
	const sampleCount = audioSamples.length

	const minSampleAmplitude = decibelsToGainFactor(amplitudeThresholdDecibels)

	let silentSampleCount = 0

	for (let i = sampleCount - 1; i >= 0; i--) {
		if (Math.abs(audioSamples[i]) > minSampleAmplitude) {
			break
		}

		silentSampleCount += 1
	}

	return silentSampleCount
}

////////////////////////////////////////////////////////////////////////////////////////////////
// Gain, normalization, mixing, and channel downmixing
////////////////////////////////////////////////////////////////////////////////////////////////
export function downmixToMonoAndNormalize(rawAudio: RawAudio, targetPeakDecibels = -3) {
	const downmixedAudio = downmixToMono(rawAudio)

	normalizeAudioLevelInPlace(downmixedAudio, targetPeakDecibels)

	return downmixedAudio
}

export function attenuateIfClippingInPlace(rawAudio: RawAudio, clippingThreshold = -0.1) {
	normalizeAudioLevelInPlace(rawAudio, clippingThreshold, 0)
}

export function normalizeAudioLevel(rawAudio: RawAudio, targetPeakDecibels = -3, maxGainIncreaseDecibels = 30) {
	const clonedRawAudio = cloneRawAudio(rawAudio)

	normalizeAudioLevelInPlace(clonedRawAudio, targetPeakDecibels, maxGainIncreaseDecibels)

	return clonedRawAudio
}

export function normalizeAudioLevelInPlace(rawAudio: RawAudio, targetPeakDecibels = -3, maxGainIncreaseDecibels = 30){
	//correctDCBiasInPlace(rawAudio)

	const targetPeakAmplitude = decibelsToGainFactor(targetPeakDecibels)
	const maxGainFactor = decibelsToGainFactor(maxGainIncreaseDecibels)

	const peakAmplitude = getSamplePeakAmplitude(rawAudio.audioChannels)

	const gainFactor = Math.min(targetPeakAmplitude / peakAmplitude, maxGainFactor)

	applyGainFactorInPlace(rawAudio, gainFactor)
}

export function correctDCBiasInPlace(rawAudio: RawAudio) {
	for (const channelSamples of rawAudio.audioChannels) {
		const sampleCount = channelSamples.length

		let sampleSum = 0

		for (let i = 0; i < sampleCount; i++) {
			sampleSum += channelSamples[i]
		}

		const sampleAverage = sampleSum / sampleCount

		for (let i = 0; i < sampleCount; i++) {
			channelSamples[i] -= sampleAverage
		}
	}
}

export function applyGainDecibels(rawAudio: RawAudio, gainDecibels: number) {
	const clonedRawAudio = cloneRawAudio(rawAudio)

	applyGainDecibelsInPlace(clonedRawAudio, gainDecibels)

	return clonedRawAudio
}

export function applyGainDecibelsInPlace(rawAudio: RawAudio, gainDecibels: number) {
	applyGainFactorInPlace(rawAudio, decibelsToGainFactor(gainDecibels))
}

export function applyGainFactorInPlace(rawAudio: RawAudio, gainFactor: number) {
	if (gainFactor === 1.0) {
		return
	}

	for (const channelSamples of rawAudio.audioChannels) {
		const sampleCount = channelSamples.length

		for (let i = 0; i < sampleCount; i++) {
			channelSamples[i] *= gainFactor
		}
	}
}

export function downmixToMono(rawAudio: RawAudio): RawAudio {
	const channelCount = rawAudio.audioChannels.length
	const sampleCount = rawAudio.audioChannels[0].length

	if (channelCount === 1) {
		return cloneRawAudio(rawAudio)
	}

	const downmixedAudio = new Float32Array(sampleCount)

	for (const channelSamples of rawAudio.audioChannels) {
		for (let i = 0; i < sampleCount; i++) {
			downmixedAudio[i] += channelSamples[i]
		}
	}

	if (channelCount > 1) {
		for (let i = 0; i < sampleCount; i++) {
			downmixedAudio[i] /= channelCount
		}
	}

	return { audioChannels: [downmixedAudio], sampleRate: rawAudio.sampleRate } as RawAudio
}

export function getSamplePeakDecibels(audioChannels: Float32Array[]) {
	return gainFactorToDecibels(getSamplePeakAmplitude(audioChannels))
}

export function getSamplePeakAmplitude(audioChannels: Float32Array[]) {
	let maxAmplitude = 0.00001

	for (const channelSamples of audioChannels) {
		const sampleCount = channelSamples.length

		for (let i = 0; i < sampleCount; i++) {
			const sampleAbsValue = Math.abs(channelSamples[i])

			if (sampleAbsValue > maxAmplitude) {
				maxAmplitude = sampleAbsValue
			}
		}
	}

	return maxAmplitude
}

export function mixAudio(rawAudio1: RawAudio, rawAudio2: RawAudio) {
	if (rawAudio1.audioChannels.length != rawAudio2.audioChannels.length) {
		throw new Error(`Can't mix audio of unequal channel counts`)
	}

	if (rawAudio1.sampleRate != rawAudio2.sampleRate) {
		throw new Error(`Can't mix audio of different sample rates`)
	}

	const mixedAudioChannels: Float32Array[] = []

	for (let c = 0; c < rawAudio1.audioChannels.length; c++) {
		const inputChannel1 = rawAudio1.audioChannels[c]
		const inputChannel2 = rawAudio2.audioChannels[c]

		const mixedChannelLength = Math.min(inputChannel1.length, inputChannel2.length)

		const mixedChannel = new Float32Array(mixedChannelLength)

		for (let i = 0; i < mixedChannelLength; i++) {
			mixedChannel[i] = inputChannel1[i] + inputChannel2[i]
		}

		mixedAudioChannels.push(mixedChannel)
	}

	const mixedAudio: RawAudio = { audioChannels: mixedAudioChannels, sampleRate: rawAudio1.sampleRate }

	return mixedAudio
}

////////////////////////////////////////////////////////////////////////////////////////////////
// Cutting, concatenation, and other operations
////////////////////////////////////////////////////////////////////////////////////////////////
export function sliceRawAudioByTime(rawAudio: RawAudio, startTime: number, endTime: number): RawAudio {
	const startSampleIndex = Math.floor(startTime * rawAudio.sampleRate)
	const endSampleIndex = Math.floor(endTime * rawAudio.sampleRate)

	return sliceRawAudio(rawAudio, startSampleIndex, endSampleIndex)
}

export function sliceRawAudio(rawAudio: RawAudio, startSampleIndex: number, endSampleIndex: number): RawAudio {
	return { audioChannels: sliceAudioChannels(rawAudio.audioChannels, startSampleIndex, endSampleIndex), sampleRate: rawAudio.sampleRate } as RawAudio
}

export function sliceAudioChannels(audioChannels: Float32Array[], startSampleIndex: number, endSampleIndex: number) {
	if (audioChannels.length === 0) {
		throw new Error('audioChannels array is empty')
	}

	if (startSampleIndex > endSampleIndex) {
		throw new Error('startSampleIndex must be less or equal to endSampleIndex')
	}

	const channelCount = audioChannels.length

	const outAudioChannels: Float32Array[] = []

	for (let i = 0; i < channelCount; i++) {
		outAudioChannels.push(audioChannels[i].slice(startSampleIndex, endSampleIndex))
	}

	return outAudioChannels
}

export function concatAudioSegments(audioSegments: Float32Array[][]) {
	if (audioSegments.length === 0) {
		return []
	}

	const channelCount = audioSegments[0].length

	const outAudioChannels: Float32Array[] = []

	for (let i = 0; i < channelCount; i++) {
		const audioSegmentsForChannel = audioSegments.map(segment => segment[i])

		outAudioChannels.push(concatFloat32Arrays(audioSegmentsForChannel))
	}

	return outAudioChannels
}

export function cropToTimeline(rawAudio: RawAudio, timeline: Timeline) {
	const sampleRate = rawAudio.sampleRate
	const channelCount = rawAudio.audioChannels.length
	const sampleCount = rawAudio.audioChannels[0].length

	const audioSegments: Float32Array[][] = []

	for (let i = 0; i < timeline.length; i++) {
		const entry = timeline[i]
		const startTime = entry.startTime
		const endTime = entry.endTime

		const startSampleOffset = Math.max(Math.floor(startTime * sampleRate), 0)
		const endSampleOffset = Math.min(Math.floor(endTime * sampleRate), sampleCount)

		const segment: Float32Array[] = []

		for (let c = 0; c < channelCount; c++) {
			segment.push(rawAudio.audioChannels[c].subarray(startSampleOffset, endSampleOffset))
		}

		audioSegments.push(segment)
	}

	if (audioSegments.length > 0) {
		const croppedAudioChannels =  concatAudioSegments(audioSegments)
		const croppedRawAudio: RawAudio = { audioChannels: croppedAudioChannels, sampleRate: rawAudio.sampleRate }

		return croppedRawAudio
	} else {
		return getEmptyRawAudio(channelCount, sampleRate)
	}
}

export function fadeAudioInOut(rawAudio: RawAudio, fadeTime: number): RawAudio {
	const fadeSampleCount = Math.floor(rawAudio.sampleRate * fadeTime)
	const gainReductionPerFrameDecibels = -60 / fadeSampleCount

	const gainReductionPerFrameFactor = decibelsToGainFactor(gainReductionPerFrameDecibels)

	const outAudioChannels = rawAudio.audioChannels.map(channel => channel.slice())

	for (const channel of outAudioChannels) {
		const sampleCount = channel.length

		if (sampleCount < fadeSampleCount * 2) {
			continue
		}

		let factor = 1.0

		for (let i = fadeSampleCount - 1; i >= 0; i--) {
			channel[i] *= factor

			factor *= gainReductionPerFrameFactor
		}

		factor = 1.0

		for (let i = sampleCount - fadeSampleCount; i < sampleCount; i++) {
			channel[i] *= factor

			factor *= gainReductionPerFrameFactor
		}
	}

	return { audioChannels: outAudioChannels, sampleRate: rawAudio.sampleRate } as RawAudio
}

export function cloneRawAudio(rawAudio: RawAudio): RawAudio {
	return {
		audioChannels: rawAudio.audioChannels.map(channel => channel.slice()),
		sampleRate: rawAudio.sampleRate
	}
}

export function getSilentAudio(sampleCount: number, channelCount: number) {
	const audioChannels: Float32Array[] = []

	for (let i = 0; i < channelCount; i++) {
		audioChannels.push(new Float32Array(sampleCount))
	}

	return audioChannels
}

export function getEmptyRawAudio(channelCount: number, sampleRate: number) {
	const audioChannels = []

	for (let c = 0; c < channelCount; c++) {
		audioChannels.push(new Float32Array(0))
	}

	const result: RawAudio = { audioChannels, sampleRate }

	return result
}

export function getRawAudioDuration(rawAudio: RawAudio) {
	if (rawAudio.audioChannels.length == 0 || rawAudio.sampleRate == 0) {
		return 0
	}

	return rawAudio.audioChannels[0].length / rawAudio.sampleRate
}

export async function ensureRawAudio(input: AudioSourceParam, outSampleRate?: number, outChannelCount?: number) {
	let inputAsRawAudio: RawAudio = input as RawAudio

	if (isRawAudio(input)) {
		const inputAudioChannelCount = inputAsRawAudio.audioChannels.length

		if (outChannelCount == 1 && inputAudioChannelCount > 1) {
			inputAsRawAudio = downmixToMono(inputAsRawAudio)
		} else if (outChannelCount == 2 && inputAudioChannelCount == 1) {
			inputAsRawAudio = cloneRawAudio(inputAsRawAudio)
			inputAsRawAudio.audioChannels.push(inputAsRawAudio.audioChannels[0].slice())
		} else if (outChannelCount != null && outChannelCount > 2 && outChannelCount != inputAudioChannelCount) {
			throw new Error(`Can't convert ${inputAudioChannelCount} channels to ${outChannelCount} channels. Channel conversion of raw audio currently only supports mono and stereo inputs.`)
		}

		if (outSampleRate && inputAsRawAudio.sampleRate !== outSampleRate) {
			inputAsRawAudio = await resampleAudioSpeex(inputAsRawAudio, outSampleRate)
		}
	} else if (typeof input == 'string' || input instanceof Uint8Array) {
		const inputAsStringOrUint8Array = input as string | Uint8Array

		inputAsRawAudio = await FFMpegTranscoder.decodeToChannels(inputAsStringOrUint8Array, outSampleRate, outChannelCount)
	} else {
		throw new Error('Received an invalid input audio data type.')
	}

	return inputAsRawAudio
}

export function subtractAudio(audio1: RawAudio, audio2: RawAudio) {
	if (audio1.sampleRate !== audio2.sampleRate) {
		throw new Error(`Audio sequences have different sample rates`)
	}

	if (audio1.audioChannels.length !== audio2.audioChannels.length) {
		throw new Error(`Audio sequences have different channel counts`)
	}

	const sampleRate = audio1.sampleRate
	const channelCount = audio1.audioChannels.length
	const sampleCount = Math.min(audio1.audioChannels[0].length, audio2.audioChannels[0].length)

	const subtractedAudioChannels: Float32Array[] = []

	for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
		const subtractedSamples = new Float32Array(sampleCount)

		const samples1 = audio1.audioChannels[channelIndex]
		const samples2 = audio2.audioChannels[channelIndex]

		for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
			subtractedSamples[sampleIndex] = samples1[sampleIndex] - samples2[sampleIndex]
		}

		subtractedAudioChannels.push(subtractedSamples)
	}

	const subtractedRawAudio: RawAudio = {
		audioChannels: subtractedAudioChannels,
		sampleRate: sampleRate
	}

	return subtractedRawAudio
}

export function isRawAudio(obj: any): obj is RawAudio {
	return typeof obj === 'object' && typeof obj.sampleRate === 'number' && Array.isArray(obj.audioChannels)
}

////////////////////////////////////////////////////////////////////////////////////////////////
// Unit conversion
////////////////////////////////////////////////////////////////////////////////////////////////

export function gainFactorToDecibels(gainFactor: number) {
	return gainFactor <= 0.00001 ? -100 : (20.0 * Math.log10(gainFactor))
}

export function decibelsToGainFactor(decibels: number) {
	return decibels <= -100.0 ? 0 : Math.pow(10, 0.05 * decibels)
}

export function powerToDecibels(power: number) {
	return power <= 0.0000000001 ? -100 : (10.0 * Math.log10(power))
}

export function decibelsToPower(decibels: number) {
	return decibels <= -100.0 ? 0 : Math.pow(10, 0.1 * decibels)
}

////////////////////////////////////////////////////////////////////////////////////////////////
// Types
////////////////////////////////////////////////////////////////////////////////////////////////

export type RawAudio = {
	audioChannels: Float32Array[]
	sampleRate: number
}

export type AudioEncoding = {
	codec?: string
	format: string

	channelCount: number
	sampleRate: number
	bitdepth: number
	sampleFormat: SampleFormat

	bitrate?: number
}

export type AudioSourceParam = string | Uint8Array | RawAudio
