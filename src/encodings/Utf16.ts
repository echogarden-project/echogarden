import { EncodeIntoResult } from "./TextEncodingsCommon.js"

//////////////////////////////////////////////////////////////////////////////
// UTF-16 Encoding
//////////////////////////////////////////////////////////////////////////////
export function encodeUtf16(text: string) {
	const resultArray = new Uint16Array(text.length)

	const { written } = encodeUtf16Into(text, resultArray)

	return resultArray.subarray(0, written)
}

export function encodeUtf16Into(text: string, resultBuffer: Uint16Array): EncodeIntoResult {
	const len = text.length

	if (resultBuffer.length < len) {
		throw new Error(`Result Uint16Array is not large enough to hold the string`)
	}

	for (let readOffset = 0; readOffset < len; readOffset++) {
		resultBuffer[readOffset] = text.charCodeAt(readOffset)
	}

	return { read: len, written: len }
}

//////////////////////////////////////////////////////////////////////////////
// UTF-16 Decoding
//////////////////////////////////////////////////////////////////////////////
export function decodeUtf16(encodedString: Uint16Array) {
	const maxChunkLength = 2 ** 24

	const chunkedUtf16Decoder = new ChunkedUtf16Decoder()

	let resultString = ''

	for (let offset = 0; offset < encodedString.length; offset += maxChunkLength) {
		const utf16Chunk = encodedString.subarray(offset, offset + maxChunkLength)
		const stringChunk = chunkedUtf16Decoder.writeChunk(utf16Chunk)

		resultString += stringChunk
	}

	return resultString
}

export class ChunkedUtf16Decoder {
	private readonly textDecoder = new TextDecoder('utf-16le')

	writeChunk(chunk: Uint16Array) {
		const decodedChunk = this.textDecoder.decode(chunk, { stream: true })

		return decodedChunk
	}
}
