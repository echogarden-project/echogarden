export function encodeUtf16(text: string) {
	const len = text.length

	const result = new Uint16Array(len)

	for (let i = 0; i < len; i++) {
		result[i] = text.charCodeAt(i)
	}

	return result
}

export function decodeUtf16(buffer: Uint16Array) {
	const maxChunkSize = 2 ** 24

	const decoder = new ChunkedUtf16Decoder()

	for (let offset = 0; offset < buffer.length; offset += maxChunkSize) {
		const chunk = buffer.subarray(offset, offset + maxChunkSize)
		
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
