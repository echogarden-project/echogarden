export function encodeAscii(asciiString: string) {
	const buffer = new Uint8Array(asciiString.length)

	for (let i = 0; i < asciiString.length; i++) {
		const charCode = asciiString.charCodeAt(i)

		if (charCode >= 256) {
			throw new Error(`Character '${asciiString[i]}' (code: ${charCode}) can't be encoded as ASCII`)
		}

		buffer[i] = charCode
	}

	return buffer
}

export function decodeAscii(buffer: Uint8Array) {
	return String.fromCharCode(...buffer)
}
