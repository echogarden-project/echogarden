import { StringBuilder } from "../utilities/StringBuilder.js"

export function encodeUtf8(utf8Text: string) {
	const textEncoder = new TextEncoder()

	return textEncoder.encode(utf8Text)
}

export function decodeUtf8(buffer: Uint8Array) {
	const textDecoder = new TextDecoder()

	return textDecoder.decode(buffer)
}

export class ChunkedUtf8Decoder {
	private str = ''
	private readonly textDecoder = new TextDecoder()

	writeChunk(chunk: Uint8Array) {
		const decodedChunk = this.textDecoder.decode(chunk)
		this.str += decodedChunk
	}

	toString() {
		return this.str
	}
}

export class ChunkedUtf8Decoder_WithStringBuilder {
	private stringBuilder: StringBuilder
	private readonly textDecoder = new TextDecoder()

	constructor(initialCapacity?: number) {
		 this.stringBuilder = new StringBuilder(initialCapacity)
	}

	writeChunk(chunk: Uint8Array) {
		const decodedChunk = this.textDecoder.decode(chunk)

		this.stringBuilder.appendString(decodedChunk)
	}

	toString() {
		return this.stringBuilder.toString()
	}
}
