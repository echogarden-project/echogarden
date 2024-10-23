export function encodeAscii(asciiString: string) {
	const len = asciiString.length

	const buffer = new Uint8Array(len)

	for (let i = 0; i < len; i++) {
		const charCode = asciiString.charCodeAt(i)

		if (charCode >= 128) {
			throw new Error(`Character '${asciiString[i]}' (code: ${charCode}) can't be encoded as a standard ASCII character`)
		}

		buffer[i] = charCode
	}

	return buffer
}

export function decodeAscii(buffer: Uint8Array) {
	const maxChunkSize = 2 ** 24

	const decoder = new ChunkedAsciiDecoder()

	for (let offset = 0; offset < buffer.length; offset += maxChunkSize) {
		const chunk = buffer.subarray(offset, offset + maxChunkSize)

		decoder.writeChunk(chunk)
	}

	return decoder.toString()
}

export class ChunkedAsciiDecoder {
	private str = ''
	private readonly textDecoder = new TextDecoder('windows-1252')

	writeChunk(chunk: Uint8Array) {
		const decodedChunk = this.textDecoder.decode(chunk)

		this.str += decodedChunk
	}

	toString() {
		return this.str
	}
}
