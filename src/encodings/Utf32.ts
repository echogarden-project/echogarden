import { EncodeIntoResult } from "./TextEncodingsCommon.js"

export function encodeUtf32(text: string) {
	const resultArray = new Uint32Array(text.length * 2)

	const { written } = encodeUtf32Into(text, resultArray)

	return resultArray.subarray(0, written)
}

export function encodeUtf32Into(text: string, resultBuffer: Uint32Array): EncodeIntoResult {
	const len = text.length

	let readOffset = 0
	let writeOffset = 0

	while (readOffset < len && writeOffset < resultBuffer.length) {
		const codepoint = text.codePointAt(readOffset)

		if (codepoint === undefined) {
			throw new Error(`Couldn't read a codepoint at offset ${readOffset}`)
		}

		resultBuffer[writeOffset++] = codepoint

		if (codepoint > 0xffff) {
			readOffset += 2
		} else {
			readOffset += 1
		}
	}

	return { read: readOffset, written: writeOffset }
}

export function decodeUtf32(encodedString: Uint32Array) {
	const maxChunkLength = 2 ** 10

	const decoder = new ChunkedUtf32Decoder()

	for (let offset = 0; offset < encodedString.length; offset += maxChunkLength) {
		const chunk = encodedString.subarray(offset, offset + maxChunkLength)

		decoder.writeChunk(chunk)
	}

	return decoder.toString()
}

export class ChunkedUtf32Decoder {
	private str = ''

	writeChunk(chunk: Uint32Array) {
		const decodedChunk = String.fromCodePoint(...chunk)

		this.str += decodedChunk
	}

	toString() {
		return this.str
	}
}
