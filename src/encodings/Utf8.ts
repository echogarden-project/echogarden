import { EncodeIntoResult } from './TextEncodingsCommon.js'

//////////////////////////////////////////////////////////////////////////////
// UTF-8 Encoding
//////////////////////////////////////////////////////////////////////////////
export function encodeUtf8(text: string) {
	const textEncoder = new TextEncoder()

	return textEncoder.encode(text)
}

export function encodeUtf8Into(text: string, outputArray: Uint8Array): EncodeIntoResult {
	const textEncoder = new TextEncoder()

	const result = textEncoder.encodeInto(text, outputArray)

	return result
}

export class ChunkedUtf8Encoder {
	private readonly textEncoder = new TextEncoder()

	private pendingHighSurrogate = ''

	writeChunk(stringChunk: string): Uint8Array {
		if (this.pendingHighSurrogate !== '') {
			stringChunk = this.pendingHighSurrogate + stringChunk

			this.pendingHighSurrogate = ''
		}

		const lastCodeUnit = stringChunk.charCodeAt(stringChunk.length - 1)

		if (lastCodeUnit >= 0xD800 && lastCodeUnit <= 0xDBFF) {
			this.pendingHighSurrogate = stringChunk[stringChunk.length - 1]

			stringChunk = stringChunk.substring(0, stringChunk.length - 1)
		}

		return this.textEncoder.encode(stringChunk)
	}

	finalize(): Uint8Array {
		const result = this.textEncoder.encode(this.pendingHighSurrogate)

		this.pendingHighSurrogate = ''

		return result
	}
}

//////////////////////////////////////////////////////////////////////////////
// UTF-8 Decoding
//////////////////////////////////////////////////////////////////////////////
export function decodeUtf8(utf8Bytes: Uint8Array) {
	const maxChunkLength = 2 ** 24

	const chunkedUtf8Decoder = new ChunkedUtf8Decoder()

	let resultString = ''

	for (let offset = 0; offset < utf8Bytes.length; offset += maxChunkLength) {
		const utf8Chunk = utf8Bytes.subarray(offset, offset + maxChunkLength)
		const stringChunk = chunkedUtf8Decoder.writeChunk(utf8Chunk)

		resultString += stringChunk
	}

	return resultString
}

export class ChunkedUtf8Decoder {
	private readonly textDecoder = new TextDecoder('utf-8')

	writeChunk(chunk: Uint8Array) {
		const decodedChunk = this.textDecoder.decode(chunk, { stream: true })

		return decodedChunk
	}
}
