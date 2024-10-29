import { decodeAscii } from './Ascii.js';

export function encodeBase64(inputBytes: Uint8Array,
	paddingCharacter: string | undefined = '=',
	charCodeMap?: Uint8Array): string {

	const asciiBuffer = encodeBase64AsAsciiBuffer(inputBytes, undefined, paddingCharacter, charCodeMap)

	return decodeAscii(asciiBuffer)
}

export function encodeBase64AsAsciiBuffer(
	inputBytes: Uint8Array,
	asciiBuffer?: Uint8Array,
	paddingCharacter: string | undefined = '=',
	charCodeMap?: Uint8Array): Uint8Array {

	if (!inputBytes || inputBytes.length == 0) {
		return new Uint8Array(0)
	}

	let paddingCharCode: number

	if (paddingCharacter == null) {
		paddingCharCode = -1
	} else if (paddingCharacter.length !== 1) {
		throw new Error(`A padding character can only be a single character`)
	} else {
		paddingCharCode = paddingCharacter.charCodeAt(0)
	}

	if (!charCodeMap) {
		charCodeMap = defaultBase64CharCodeMap
	}

	let charCodes: Uint8Array

	if (asciiBuffer) {
		charCodes = asciiBuffer
	} else {
		charCodes = new Uint8Array(Math.floor((inputBytes.length * 4 / 3) + 4))
	}

	const inputBytesLength = inputBytes.length

	let writeOffset = 0
	let readOffset = 0

	while (readOffset <= inputBytesLength - 3) {
		const uint24 =
			inputBytes[readOffset++] << 16 |
			inputBytes[readOffset++] << 8 |
			inputBytes[readOffset++]

		charCodes[writeOffset++] = charCodeMap[(uint24 >>> 18) & 63]
		charCodes[writeOffset++] = charCodeMap[(uint24 >>> 12) & 63]
		charCodes[writeOffset++] = charCodeMap[(uint24 >>> 6) & 63]
		charCodes[writeOffset++] = charCodeMap[(uint24) & 63]
	}

	if (readOffset === inputBytesLength - 2) {
		// If two bytes are left, output 3 encoded characters and one padding character
		const uint24 =
			inputBytes[readOffset++] << 16 |
			inputBytes[readOffset++] << 8

		charCodes[writeOffset++] = charCodeMap[(uint24 >>> 18) & 63]
		charCodes[writeOffset++] = charCodeMap[(uint24 >>> 12) & 63]
		charCodes[writeOffset++] = charCodeMap[(uint24 >>> 6) & 63]

		if (paddingCharCode >= 0) {
			charCodes[writeOffset++] = paddingCharCode
		}
	} else if (readOffset === inputBytesLength - 1) {
		// Arrived at last byte at a position that did not complete a full 3 byte set
		const uint24 =
			inputBytes[readOffset++] << 16

		charCodes[writeOffset++] = charCodeMap[(uint24 >>> 18) & 63]
		charCodes[writeOffset++] = charCodeMap[(uint24 >>> 12) & 63]

		if (paddingCharCode >= 0) {
			charCodes[writeOffset++] = paddingCharCode
			charCodes[writeOffset++] = paddingCharCode
		}
	}

	return charCodes.subarray(0, writeOffset)
}

export function decodeBase64(
	base64String: string,
	outputBuffer?: Uint8Array,
	paddingCharacter = '=',
	reverseCharCodeMap?: Uint8Array): Uint8Array {

	if (!base64String || base64String.length === 0) {
		return new Uint8Array(0)
	}

	if (!paddingCharacter || paddingCharacter.length !== 1) {
		throw new Error(`A valid padding character must be provided for Base 64 decoding`)
	}

	// Add padding if omitted
	const lengthModulo4 = base64String.length % 4

	if (lengthModulo4 === 1) {
		throw new Error(`Invalid Base64 string: length % 4 == 1`)
	} else if (lengthModulo4 === 2) {
		base64String += paddingCharacter
		base64String += paddingCharacter
	} else if (lengthModulo4 === 3) {
		base64String += paddingCharacter
	}

	if (!reverseCharCodeMap) {
		reverseCharCodeMap = defaultBase64ReverseCharCodeMap
	}

	if (!outputBuffer) {
		const capacity = (base64String.length / 4) * 3

		outputBuffer = new Uint8Array(capacity)
	}

	const stringLength = base64String.length

	let readOffset = 0
	let writeOffset = 0

	while (readOffset < stringLength) {
		const uint24 =
			(reverseCharCodeMap[base64String.charCodeAt(readOffset++)] << 18) |
			(reverseCharCodeMap[base64String.charCodeAt(readOffset++)] << 12) |
			(reverseCharCodeMap[base64String.charCodeAt(readOffset++)] << 6) |
			(reverseCharCodeMap[base64String.charCodeAt(readOffset++)])

		outputBuffer[writeOffset++] = (uint24 >>> 16) & 255
		outputBuffer[writeOffset++] = (uint24 >>> 8) & 255
		outputBuffer[writeOffset++] = (uint24) & 255
	}

	// Remove 1 or 2 last bytes if padding characters were added to the string
	if (base64String[stringLength - 1] === paddingCharacter) {
		writeOffset--
	}

	if (base64String[stringLength - 2] === paddingCharacter) {
		writeOffset--
	}

	return outputBuffer.subarray(0, writeOffset)
}

export const defaultBase64CharCodeMap: Uint8Array = new Uint8Array([65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 43, 47])
export const defaultBase64ReverseCharCodeMap: Uint8Array = new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 62, 255, 255, 255, 63, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 255, 255, 255, 0, 255, 255, 255, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 255, 255, 255, 255, 255, 255, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 255, 255, 255, 255])
