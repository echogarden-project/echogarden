import * as FFMpegTranscoder from "../codecs/FFMpegTranscoder.js"
import { SampleFormat, encodeWave, decodeWave, BitDepth } from "../codecs/WaveCodec.js"
import { resampleAudioSpeex } from "../dsp/SpeexResampler.js"
import { concatFloat32Arrays } from '../utilities/Utilities.js'

////////////////////////////////////////////////////////////////////////////////////////////////
// Wave encoding and decoding
////////////////////////////////////////////////////////////////////////////////////////////////
export function encodeWaveBuffer(rawAudio: RawAudio, bitDepth: BitDepth = 16, sampleFormat: SampleFormat = SampleFormat.PCM, speakerPositionMask = 0) {
	return encodeWave(rawAudio, bitDepth, sampleFormat, speakerPositionMask)
}

export function decodeWaveBuffer(waveFileBuffer: Buffer, ignoreTruncatedChunks = false) {
	return decodeWave(waveFileBuffer, ignoreTruncatedChunks)
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
	const silentSampleCount = getEndingSilentSampleCount(audioSamples, amplitudeThresholdDecibels)

	const trimmedAudio = audioSamples.subarray(0, audioSamples.length - silentSampleCount)
	const restoredSilence = new Float32Array(targetEndSilentSampleCount)

	const trimmedAudioSamples = concatFloat32Arrays([trimmedAudio, restoredSilence])

	return trimmedAudioSamples
}

export function getStartingSilentSampleCount(audioSamples: Float32Array, amplitudeThresholdDecibels = defaultSilenceThresholdDecibels) {
	const minSampleValue = decibelsToGain(amplitudeThresholdDecibels)

	let silentSampleCount = 0

	for (let i = 0; i < audioSamples.length - 1; i++) {
		if (Math.abs(audioSamples[i]) > minSampleValue) {
			break
		}

		silentSampleCount += 1
	}

	return silentSampleCount
}

export function getEndingSilentSampleCount(audioSamples: Float32Array, amplitudeThresholdDecibels = defaultSilenceThresholdDecibels) {
	const minSampleValue = decibelsToGain(amplitudeThresholdDecibels)

	let silentSampleCount = 0

	for (let i = audioSamples.length - 1; i >= 0; i--) {
		if (Math.abs(audioSamples[i]) > minSampleValue) {
			break
		}

		silentSampleCount += 1
	}

	return silentSampleCount
}

////////////////////////////////////////////////////////////////////////////////////////////////
// Gain, normalization, mixing, and channel downmixing
////////////////////////////////////////////////////////////////////////////////////////////////
export function downmixToMonoAndNormalize(rawAudio: RawAudio, targetPeakDb = -3) {
	return normalizeAudioLevel(downmixToMono(rawAudio), targetPeakDb)
}

export function normalizeAudioLevel(rawAudio: RawAudio, targetPeakDb = -3, maxIncreaseDb = 30): RawAudio {
	const targetPeakSampleValue = decibelsToGain(targetPeakDb)
	const maxMultiplier = decibelsToGain(maxIncreaseDb)

	const maxAbsoluteSampleValue = getAudioPeakGain(rawAudio.audioChannels)

	const multiplier = Math.min(targetPeakSampleValue / maxAbsoluteSampleValue, maxMultiplier)

	return applyGain(rawAudio, multiplier)
}

export function applyGainDecibels(rawAudio: RawAudio, decibelGain: number): RawAudio {
	return applyGain(rawAudio, decibelsToGain(decibelGain))
}

export function applyGain(rawAudio: RawAudio, gain: number): RawAudio {
	const sampleCount = rawAudio.audioChannels[0].length
	const outputAudioChannels: Float32Array[] = []

	const multiplier = gain

	for (const channelSamples of rawAudio.audioChannels) {
		const outputChannelSamples = new Float32Array(sampleCount)

		for (let j = 0; j < sampleCount; j++) {
			outputChannelSamples[j] = channelSamples[j] * multiplier
		}

		outputAudioChannels.push(outputChannelSamples)
	}

	return { audioChannels: outputAudioChannels, sampleRate: rawAudio.sampleRate }
}

export function downmixToMono(rawAudio: RawAudio): RawAudio {
	const sampleCount = rawAudio.audioChannels[0].length

	const downmixedAudio = new Float32Array(sampleCount)

	for (const channel of rawAudio.audioChannels) {
		for (let i = 0; i < sampleCount; i++) {
			downmixedAudio[i] += channel[i]
		}
	}

	return { audioChannels: [downmixedAudio], sampleRate: rawAudio.sampleRate }
}

export function getAudioPeakDecibels(audioChannels: Float32Array[]) {
	return gainToDecibels(getAudioPeakGain(audioChannels))
}

export function getAudioPeakGain(audioChannels: Float32Array[]) {
	let maxAbsoluteSampleValue = 0.00001

	for (const channel of audioChannels) {
		for (const sample of channel) {
			maxAbsoluteSampleValue = Math.max(maxAbsoluteSampleValue, Math.abs(sample))
		}
	}

	return maxAbsoluteSampleValue
}

export function mixAudio(rawAudio1: RawAudio, rawAudio2: RawAudio) {
	if (rawAudio1.audioChannels.length != rawAudio2.audioChannels.length) {
		throw new Error("Can't mix audio of unequal channel counts")
	}

	if (rawAudio1.sampleRate != rawAudio2.sampleRate) {
		throw new Error("Can't mix audio of different sample rates")
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
	return { audioChannels: sliceAudioChannels(rawAudio.audioChannels, startSampleIndex, endSampleIndex), sampleRate: rawAudio.sampleRate }
}

export function sliceAudioChannels(audioChannels: Float32Array[], startSampleIndex: number, endSampleIndex: number) {
	const channelCount = audioChannels.length

	const outAudioChannels: Float32Array[] = []

	for (let i = 0; i < channelCount; i++) {
		outAudioChannels.push(audioChannels[i].slice(startSampleIndex, endSampleIndex))
	}

	return outAudioChannels
}

export function concatAudioSegments(audioSegments: Float32Array[][]) {
	if (audioSegments.length == 0) {
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

export function fadeAudioInOut(rawAudio: RawAudio, fadeTime: number): RawAudio {
	const fadeSampleCount = Math.floor(rawAudio.sampleRate * fadeTime)
	const gainReductionPerFrameDecibels = -60 / fadeSampleCount

	const gainReductionPerFrameMultiplier = decibelsToGain(gainReductionPerFrameDecibels)

	const outAudioChannels = rawAudio.audioChannels.map(channel => channel.slice())

	for (const channel of outAudioChannels) {
		if (channel.length < fadeSampleCount * 2) {
			continue
		}

		let multiplier = 1.0

		for (let i = fadeSampleCount - 1; i >= 0; i--) {
			channel[i] *= multiplier
			multiplier *= gainReductionPerFrameMultiplier
		}

		multiplier = 1.0

		for (let i = channel.length - fadeSampleCount; i < channel.length; i++) {
			channel[i] *= multiplier
			multiplier *= gainReductionPerFrameMultiplier
		}
	}

	return { audioChannels: outAudioChannels, sampleRate: rawAudio.sampleRate }
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

	if (inputAsRawAudio.audioChannels?.length > 0 && inputAsRawAudio.sampleRate) {
		const inputAudioChannelCount = inputAsRawAudio.audioChannels.length

		if (outChannelCount == 1 && inputAudioChannelCount > 1) {
			inputAsRawAudio = downmixToMono(inputAsRawAudio)
		}

		if (outChannelCount != null && outChannelCount >= 2 && outChannelCount != inputAudioChannelCount) {
			throw new Error(`Can't convert ${inputAudioChannelCount} channels to ${outChannelCount} channels. Channel conversion of raw audio currently only supports downmixing to mono.`)
		}

		if (outSampleRate && inputAsRawAudio.sampleRate != outSampleRate) {
			inputAsRawAudio = await resampleAudioSpeex(inputAsRawAudio, outSampleRate)
		}
	} else if (typeof input == "string" || input instanceof Uint8Array) {
		if (input instanceof Uint8Array && !Buffer.isBuffer(input)) {
			input = Buffer.from(input)
		}

		const inputAsStringOrBuffer = input as string | Buffer

		inputAsRawAudio = await FFMpegTranscoder.decodeToChannels(inputAsStringOrBuffer, outSampleRate, outChannelCount)
	} else {
		throw new Error("Received an invalid input audio data type.")
	}

	return inputAsRawAudio
}

////////////////////////////////////////////////////////////////////////////////////////////////
// Unit conversion
////////////////////////////////////////////////////////////////////////////////////////////////

export function gainToDecibels(gain: number) {
	return gain <= 0.00001 ? -100 : (20.0 * Math.log10(gain))
}

export function decibelsToGain(decibels: number) {
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

export type AudioSourceParam = string | Buffer | Uint8Array | RawAudio
