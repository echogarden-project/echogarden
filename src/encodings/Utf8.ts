
const textEncoder = new TextEncoder()
export function encodeUtf8(utf8Text: string) {
	return textEncoder.encode(utf8Text)
}

const textDecoder = new TextDecoder()
export function decodeUtf8(buffer: Uint8Array) {
	return textDecoder.decode(buffer)
}
