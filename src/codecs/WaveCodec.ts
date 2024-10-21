import * as AudioBufferConversion from '../audio/AudioBufferConversion.js'
import { RawAudio } from '../audio/AudioUtilities.js'
import { readUint16LE, readUint32LE, writeAscii, writeUint16LE, writeUint32LE } from '../utilities/BinaryUtilities.js'
import { encodeHex, decodeHex } from '../encodings/Hex.js'
import { concatUint8Arrays, logToStderr } from '../utilities/Utilities.js'
import { decodeAscii } from '../encodings/Ascii.js'

const log = logToStderr

export function encodeWave(rawAudio: RawAudio, bitDepth: BitDepth = 16, sampleFormat: SampleFormat = SampleFormat.PCM, speakerPositionMask = 0) {
	const audioChannels = rawAudio.audioChannels
	const sampleRate = rawAudio.sampleRate

	const audioBuffer = AudioBufferConversion.encodeToAudioBuffer(audioChannels, bitDepth, sampleFormat)
	const audioDataLength = audioBuffer.length

	const shouldUseExtensibleFormat = bitDepth > 16 || audioChannels.length > 2

	const formatSubChunk = new WaveFormat(audioChannels.length, sampleRate, bitDepth, sampleFormat, speakerPositionMask)
	const formatSubChunkBuffer = formatSubChunk.serialize(shouldUseExtensibleFormat)

	const dataSubChunkBuffer = new Uint8Array(4 + 4 + audioDataLength)
	writeAscii(dataSubChunkBuffer, 'data', 0)
	const dataChunkLength = Math.min(audioDataLength, 4294967295) // Ensure large data chunk length is clipped to max
	writeUint32LE(dataSubChunkBuffer, dataChunkLength, 4)
	dataSubChunkBuffer.set(audioBuffer, 8)

	const riffChunkHeaderBuffer = new Uint8Array(12)
	writeAscii(riffChunkHeaderBuffer, 'RIFF', 0)
	const riffChunkLength = Math.min(4 + formatSubChunkBuffer.length + dataSubChunkBuffer.length, 4294967295) // Ensure large RIFF chunk length is clipped to max
	writeUint32LE(riffChunkHeaderBuffer, riffChunkLength, 4)
	writeAscii(riffChunkHeaderBuffer, 'WAVE', 8)

	return concatUint8Arrays([riffChunkHeaderBuffer, formatSubChunkBuffer, dataSubChunkBuffer])
}

export function decodeWave(waveData: Uint8Array, ignoreTruncatedChunks = true, ignoreOverflowingDataChunks = true) {
	let readOffset = 0

	const riffId = decodeAscii(waveData.subarray(readOffset, readOffset + 4))

	if (riffId != 'RIFF') {
		throw new Error('Not a valid wave file. No RIFF id found at offset 0.')
	}

	readOffset += 4

	let riffChunkSize = readUint32LE(waveData, readOffset)

	readOffset += 4

	const waveId = decodeAscii(waveData.subarray(readOffset, readOffset + 4))

	if (waveId != 'WAVE') {
		throw new Error('Not a valid wave file. No WAVE id found at offset 8.')
	}

	if (ignoreOverflowingDataChunks && riffChunkSize === 4294967295) {
		riffChunkSize = waveData.length - 8
	}

	if (riffChunkSize < waveData.length - 8) {
		throw new Error(`RIFF chunk length ${riffChunkSize} is smaller than the remaining size of the buffer (${waveData.length - 8})`)
	}

	if (!ignoreTruncatedChunks && riffChunkSize > waveData.length - 8) {
		throw new Error(`RIFF chunk length (${riffChunkSize}) is greater than the remaining size of the buffer (${waveData.length - 8})`)
	}

	readOffset += 4

	let formatSubChunkBodyBuffer: Uint8Array | undefined
	const dataBuffers: Uint8Array[] = []

	while (true) {
		const subChunkIdentifier = decodeAscii(waveData.subarray(readOffset, readOffset + 4))
		readOffset += 4

		let subChunkSize = readUint32LE(waveData, readOffset)
		readOffset += 4

		if (!ignoreTruncatedChunks && subChunkSize > waveData.length - readOffset) {
			throw new Error(`Encountered a '${subChunkIdentifier}' subchunk with a size of ${subChunkSize} which is greater than the remaining size of the buffer (${waveData.length - readOffset})`)
		}

		if (subChunkIdentifier == 'fmt ') {
			formatSubChunkBodyBuffer = waveData.subarray(readOffset, readOffset + subChunkSize)
		} else if (subChunkIdentifier == 'data') {
			if (!formatSubChunkBodyBuffer) {
				throw new Error('A data subchunk was encountered before a format subchunk')
			}

			// If the data chunk is truncated or extended beyond 4 GiB,
			// the data would be read up to the end of the buffer
			if (ignoreOverflowingDataChunks && subChunkSize === 4294967295) {
				subChunkSize = waveData.length - readOffset
			}

			const subChunkData = waveData.subarray(readOffset, readOffset + subChunkSize)

			dataBuffers.push(subChunkData)
		}
		// All sub chunks other than 'data' (e.g. 'LIST', 'fact', 'plst', 'junk' etc.) are ignored

		// This addition operation may overflow if JavaScript integers were 32 bits,
		// but since they are 52 bits, it is okay:
		readOffset += subChunkSize

		// Break if readOffset is equal to or is greater than the size of the buffer
		if (readOffset >= waveData.length) {
			break
		}
	}

	if (!formatSubChunkBodyBuffer) {
		throw new Error('No format subchunk was found in the wave file')
	}

	if (dataBuffers.length === 0) {
		throw new Error('No data subchunks were found in the wave file')
	}

	const waveFormat = WaveFormat.deserializeFrom(formatSubChunkBodyBuffer)

	const sampleFormat = waveFormat.sampleFormat
	const channelCount = waveFormat.channelCount
	const sampleRate = waveFormat.sampleRate
	const bitDepth = waveFormat.bitDepth
	const speakerPositionMask = waveFormat.speakerPositionMask

	const concatenatedDataBuffers = concatUint8Arrays(dataBuffers)
	dataBuffers.length = 0 // Allow the garbage collector to free up memory held by the data buffers

	const audioChannels = AudioBufferConversion.decodeToChannels(concatenatedDataBuffers, channelCount, bitDepth, sampleFormat)

	return {
		rawAudio: { audioChannels, sampleRate },

		sourceSampleFormat: sampleFormat,
		sourceBitDepth: bitDepth,
		sourceSpeakerPositionMask: speakerPositionMask
	}
}

export function repairWave(waveData: Uint8Array) {
	const { rawAudio, sourceSampleFormat, sourceBitDepth } = decodeWave(waveData)

	return encodeWave(rawAudio, sourceBitDepth, sourceSampleFormat)
}

class WaveFormat { // 24 bytes total for PCM, 26 for float
	sampleFormat: SampleFormat // 2 bytes LE
	channelCount: number // 2 bytes LE
	sampleRate: number // 4 bytes LE
	get byteRate() { return this.sampleRate * this.bytesPerSample * this.channelCount } // 4 bytes LE
	get blockAlign() { return this.bytesPerSample * this.channelCount } // 2 bytes LE
	bitDepth: BitDepth // 2 bytes LE

	speakerPositionMask: number // 4 bytes LE
	get guid() { return sampleFormatToGuid[this.sampleFormat] } // 16 bytes BE

	// helpers:
	get bytesPerSample() { return this.bitDepth / 8 }

	constructor(channelCount: number, sampleRate: number, bitDepth: BitDepth, sampleFormat: SampleFormat, speakerPositionMask = 0) {
		this.sampleFormat = sampleFormat
		this.channelCount = channelCount
		this.sampleRate = sampleRate
		this.bitDepth = bitDepth

		this.speakerPositionMask = speakerPositionMask
	}

	serialize(useExtensibleFormat: boolean) {
		let sampleFormatId = this.sampleFormat

		if (useExtensibleFormat) {
			sampleFormatId = 65534 as number
		}

		const serializedSize = sampleFormatToSerializedSize[sampleFormatId]

		const result = new Uint8Array(serializedSize)

		writeAscii(result, 'fmt ', 0) // + 4
		writeUint32LE(result, serializedSize - 8, 4) // + 4

		writeUint16LE(result, sampleFormatId, 8) // + 2
		writeUint16LE(result, this.channelCount, 10) // + 2
		writeUint32LE(result, this.sampleRate, 12) // + 4
		writeUint32LE(result, this.byteRate, 16) // + 4
		writeUint16LE(result, this.blockAlign, 20) // + 2
		writeUint16LE(result, this.bitDepth, 22) // + 2

		if (useExtensibleFormat) {
			writeUint16LE(result, serializedSize - 26, 24) // + 2 (extension size)
			writeUint16LE(result, this.bitDepth, 26) // + 2 (valid bits per sample)
			writeUint32LE(result, this.speakerPositionMask, 28) // + 2 (speaker position mask)

			if (this.sampleFormat == SampleFormat.PCM || this.sampleFormat == SampleFormat.Float) {
				result.set(decodeHex(this.guid), 32)
			} else {
				throw new Error(`Extensible format is not supported for sample format ${this.sampleFormat}`)
			}
		}

		return result
	}

	static deserializeFrom(formatChunkBody: Uint8Array) { // chunkBody should not include the first 8 bytes
		let sampleFormat = readUint16LE(formatChunkBody, 0) // + 2
		const channelCount = readUint16LE(formatChunkBody, 2) // + 2
		const sampleRate = readUint32LE(formatChunkBody, 4) // + 4
		const bitDepth = readUint16LE(formatChunkBody, 14)
		let speakerPositionMask = 0

		if (sampleFormat == 65534) {
			if (formatChunkBody.length < 40) {
				throw new Error(`Format subchunk specifies a format id of 65534 (extensible) but its body size is ${formatChunkBody.length} bytes, which is smaller than the minimum expected of 40 bytes`)
			}

			speakerPositionMask = readUint16LE(formatChunkBody, 20)

			const guid = encodeHex(formatChunkBody.subarray(24, 40))

			if (guid == sampleFormatToGuid[SampleFormat.PCM]) {
				sampleFormat = SampleFormat.PCM
			} else if (guid == sampleFormatToGuid[SampleFormat.Float]) {
				sampleFormat = SampleFormat.Float
			} else {
				throw new Error(`Unsupported format GUID in extended format subchunk: ${guid}`)
			}
		}

		if (sampleFormat == SampleFormat.PCM) {
			if (bitDepth != 8 && bitDepth != 16 && bitDepth != 24 && bitDepth != 32) {
				throw new Error(`PCM audio has a bit depth of ${bitDepth}, which is not supported`)
			}
		} else if (sampleFormat == SampleFormat.Float) {
			if (bitDepth != 32 && bitDepth != 64) {
				throw new Error(`IEEE float audio has a bit depth of ${bitDepth}, which is not supported`)
			}
		} else if (sampleFormat == SampleFormat.Alaw) {
			if (bitDepth != 8) {
				throw new Error(`Alaw audio has a bit depth of ${bitDepth}, which is not supported`)
			}
		} else if (sampleFormat == SampleFormat.Mulaw) {
			if (bitDepth != 8) {
				throw new Error(`Mulaw audio has a bit depth of ${bitDepth}, which is not supported`)
			}
		} else {
			throw new Error(`Wave audio format id ${sampleFormat} is not supported`)
		}

		return new WaveFormat(channelCount, sampleRate, bitDepth, sampleFormat, speakerPositionMask)
	}
}

export enum SampleFormat {
	PCM = 1,
	Float = 3,
	Alaw = 6,
	Mulaw = 7,
}

export type BitDepth = 8 | 16 | 24 | 32 | 64

const sampleFormatToSerializedSize = {
	[SampleFormat.PCM]: 24,
	[SampleFormat.Float]: 26,
	[SampleFormat.Alaw]: 26,
	[SampleFormat.Mulaw]: 26,
	65534: 48
}

const sampleFormatToGuid = {
	[SampleFormat.PCM]: '0100000000001000800000aa00389b71',
	[SampleFormat.Float]: '0300000000001000800000aa00389b71',
	[SampleFormat.Alaw]: '',
	[SampleFormat.Mulaw]: '',
}
