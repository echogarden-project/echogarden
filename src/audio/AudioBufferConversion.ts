import AlawMulaw from 'alawmulaw'
import * as BinaryArrayConversion from '../utilities/BinaryArrayConversion.js'
import { BitDepth, SampleFormat } from '../codecs/WaveCodec.js'

/////////////////////////////////////////////////////////////////////////////////////////////
// Low level audio sample conversions
/////////////////////////////////////////////////////////////////////////////////////////////
export function encodeToAudioBuffer(audioChannels: Float32Array[], targetBitDepth: BitDepth = 16, targetSampleFormat: SampleFormat = SampleFormat.PCM) {
	const interleavedChannels = interleaveChannels(audioChannels)

	audioChannels = [] // Zero the array references to allow the GC to free up memory, if possible

	if (targetSampleFormat === SampleFormat.PCM) {
		if (targetBitDepth === 8) {
			return BinaryArrayConversion.int8ToBuffer(float32ToInt8Pcm(interleavedChannels))
		} else if (targetBitDepth === 16) {
			return BinaryArrayConversion.int16ToBufferLE(float32ToInt16Pcm(interleavedChannels))
		} else if (targetBitDepth === 24) {
			return BinaryArrayConversion.int24ToBufferLE(float32ToInt24Pcm(interleavedChannels))
		} else if (targetBitDepth === 32) {
			return BinaryArrayConversion.int32ToBufferLE(float32ToInt32Pcm(interleavedChannels))
		} else {
			throw new Error(`Unsupported PCM bit depth: ${targetBitDepth}`)
		}
	} else if (targetSampleFormat === SampleFormat.Float) {
		if (targetBitDepth === 32) {
			return BinaryArrayConversion.float32ToBufferLE(interleavedChannels)
		} else if (targetBitDepth === 64) {
			return BinaryArrayConversion.float64ToBufferLE(BinaryArrayConversion.float32Tofloat64(interleavedChannels))
		} else {
			throw new Error(`Unsupported float bit depth: ${targetBitDepth}`)
		}
	} else if (targetSampleFormat === SampleFormat.Alaw) {
		if (targetBitDepth === 8) {
			return Buffer.from(AlawMulaw.alaw.encode(float32ToInt16Pcm(interleavedChannels)))
		} else {
			throw new Error(`Unsupported alaw bit depth: ${targetBitDepth}`)
		}
	} else if (targetSampleFormat === SampleFormat.Mulaw) {
		if (targetBitDepth === 8) {
			return Buffer.from(AlawMulaw.mulaw.encode(float32ToInt16Pcm(interleavedChannels)))
		} else {
			throw new Error(`Unsupported mulaw bit depth: ${targetBitDepth}`)
		}
	} else {
		throw new Error(`Unsupported audio format: ${targetSampleFormat}`)
	}
}

export function decodeToChannels(audioBuffer: Buffer, channelCount: number, sourceBitDepth: number, sourceSampleFormat: SampleFormat) {
	let interleavedChannels: Float32Array

	if (sourceSampleFormat === SampleFormat.PCM) {
		if (sourceBitDepth === 8) {
			interleavedChannels = int8PcmToFloat32(BinaryArrayConversion.bufferToInt8(audioBuffer))
		} else if (sourceBitDepth === 16) {
			interleavedChannels = int16PcmToFloat32(BinaryArrayConversion.bufferLEToInt16(audioBuffer))
		} else if (sourceBitDepth === 24) {
			interleavedChannels = int24PcmToFloat32(BinaryArrayConversion.bufferLEToInt24(audioBuffer))
		} else if (sourceBitDepth === 32) {
			interleavedChannels = int32PcmToFloat32(BinaryArrayConversion.bufferLEToInt32(audioBuffer))
		} else {
			throw new Error(`Unsupported PCM bit depth: ${sourceBitDepth}`)
		}
	} else if (sourceSampleFormat === SampleFormat.Float) {
		if (sourceBitDepth === 32) {
			interleavedChannels = BinaryArrayConversion.bufferLEToFloat32(audioBuffer)
		} else if (sourceBitDepth === 64) {
			interleavedChannels = BinaryArrayConversion.float64Tofloat32(BinaryArrayConversion.bufferLEToFloat64(audioBuffer))
		} else {
			throw new Error(`Unsupported float bit depth: ${sourceBitDepth}`)
		}
	} else if (sourceSampleFormat === SampleFormat.Alaw) {
		if (sourceBitDepth === 8) {
			interleavedChannels = int16PcmToFloat32(AlawMulaw.alaw.decode(audioBuffer))
		} else {
			throw new Error(`Unsupported alaw bit depth: ${sourceBitDepth}`)
		}
	} else if (sourceSampleFormat === SampleFormat.Mulaw) {
		if (sourceBitDepth === 8) {
			interleavedChannels = int16PcmToFloat32(AlawMulaw.mulaw.decode(audioBuffer))
		} else {
			throw new Error(`Unsupported mulaw bit depth: ${sourceBitDepth}`)
		}
	} else {
		throw new Error(`Unsupported audio format: ${sourceSampleFormat}`)
	}

	audioBuffer = Buffer.from([]) // Zero the buffer reference to allow the GC to free up memory, if possible

	return deInterleaveChannels(interleavedChannels, channelCount)
}

// Int8 PCM <-> Float32 conversion
export function int8PcmToFloat32(input: Int8Array) {
	const output = new Float32Array(input.length)

	for (let i = 0; i < input.length; i++) {
		const sample = input[i]
		output[i] = sample < 0 ? sample / 128 : sample / 127
	}

	return output
}

export function float32ToInt8Pcm(input: Float32Array) {
	const output = new Int8Array(input.length)

	for (let i = 0; i < input.length; i++) {
		const sample = clampFloatSample(input[i])
		output[i] = (sample < 0 ? sample * 128 : sample * 127) | 0
	}

	return output
}

// Int16 PCM <-> Float32 conversion
export function int16PcmToFloat32(input: Int16Array) {
	const output = new Float32Array(input.length)

	for (let i = 0; i < input.length; i++) {
		const sample = input[i]
		output[i] = sample < 0 ? sample / 32768 : sample / 32767
	}

	return output
}

export function float32ToInt16Pcm(input: Float32Array) {
	const output = new Int16Array(input.length)

	for (let i = 0; i < input.length; i++) {
		const sample = clampFloatSample(input[i])
		output[i] = (sample < 0 ? sample * 32768 : sample * 32767) | 0
	}

	return output
}

// Int24 PCM <-> Float32 conversion (uses int32 for storage)
export function int24PcmToFloat32(input: Int32Array) {
	const output = new Float32Array(input.length)

	for (let i = 0; i < input.length; i++) {
		const sample = input[i]
		output[i] = sample < 0 ? sample / 8388608 : sample / 8388607
	}

	return output
}

export function float32ToInt24Pcm(input: Float32Array) {
	const output = new Int32Array(input.length)

	for (let i = 0; i < input.length; i++) {
		const sample = clampFloatSample(input[i])
		output[i] = (sample < 0 ? sample * 8388608 : sample * 8388607) | 0
	}

	return output
}

// Int32 PCM <-> Float32 conversion
export function int32PcmToFloat32(input: Int32Array) {
	const output = new Float32Array(input.length)

	for (let i = 0; i < input.length; i++) {
		const sample = input[i]
		output[i] = sample < 0 ? sample / 2147483648 : sample / 2147483647
	}

	return output
}

export function float32ToInt32Pcm(input: Float32Array) {
	const output = new Int32Array(input.length)

	for (let i = 0; i < input.length; i++) {
		const sample = clampFloatSample(input[i])
		output[i] = (sample < 0 ? sample * 2147483648 : sample * 2147483647) | 0
	}

	return output
}

/////////////////////////////////////////////////////////////////////////////////////////////
// Channel interleaving
/////////////////////////////////////////////////////////////////////////////////////////////
export function interleaveChannels(channels: Float32Array[]) {
	const channelCount = channels.length

	if (channelCount === 0) {
		throw new Error('Empty channel array received')
	}

	if (channelCount === 1) {
		return channels[0]
	}

	const sampleCount = channels[0].length
	const result = new Float32Array(sampleCount * channelCount)

	let writeIndex = 0

	for (let i = 0; i < sampleCount; i++) {
		for (let c = 0; c < channelCount; c++) {
			result[writeIndex] = channels[c][i]
			writeIndex += 1
		}
	}

	return result
}

export function deInterleaveChannels(interleavedChannels: Float32Array, channelCount: number) {
	if (channelCount === 0) {
		throw new Error('0 channel count received')
	}

	if (channelCount === 1) {
		return [interleavedChannels]
	}

	if (interleavedChannels.length % channelCount != 0) {
		throw new Error(`Size of interleaved channels (${interleaveChannels.length}) is not a multiple of channel count (${channelCount})`)
	}

	const sampleCount = interleavedChannels.length / channelCount
	const channels: Float32Array[] = []

	for (let i = 0; i < channelCount; i++) {
		channels.push(new Float32Array(sampleCount))
	}

	let readIndex = 0

	for (let i = 0; i < sampleCount; i++) {
		for (let c = 0; c < channelCount; c++) {
			channels[c][i] = interleavedChannels[readIndex]
			readIndex += 1
		}
	}

	return channels
}

/////////////////////////////////////////////////////////////////////////////////////////////
// Utilities
/////////////////////////////////////////////////////////////////////////////////////////////
export function clampFloatSample(floatSample: number) {
	if (floatSample < -1.0) {
		return -1.0
	} else if (floatSample > 1.0) {
		return 1.0
	} else {
		return floatSample
	}
}
