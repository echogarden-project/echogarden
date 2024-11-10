import { EncodeIntoResult } from "./TextEncodingsCommon.js"

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

export function decodeUtf16(encodedString: Uint16Array) {
	const maxChunkLength = 2 ** 24

	const decoder = new ChunkedUtf16Decoder()

	for (let offset = 0; offset < encodedString.length; offset += maxChunkLength) {
		const chunk = encodedString.subarray(offset, offset + maxChunkLength)

		decoder.writeChunk(chunk)
	}

	return decoder.toString()
}

export class ChunkedUtf16Decoder {
	private str = ''
	private readonly textDecoder = new TextDecoder('utf-16le')

	writeChunk(chunk: Uint16Array) {
		const decodedChunk = this.textDecoder.decode(chunk)

		this.str += decodedChunk
	}

	toString() {
		return this.str
	}
}
