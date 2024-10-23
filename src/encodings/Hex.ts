import { decodeAscii } from "./Ascii.js"

export function encodeHex(buffer: Uint8Array) {
	const asciiBuffer = encodeHexAsAsciiBuffer(buffer)

	return decodeAscii(asciiBuffer)
}

export function encodeHexAsAsciiBuffer(buffer: Uint8Array) {
	const bufferLen = buffer.length

	const charCodes = new Uint8Array(bufferLen * 2)

	let readOffset = 0
	let writeOffset = 0

	while (readOffset < bufferLen) {
		const value = buffer[readOffset++]

		const valueHigh4Bits = (value >>> 4) & 0xf
		const valueLow4Bits = value & 0xf

		charCodes[writeOffset++] = hexCharCodeLookup[valueHigh4Bits]
		charCodes[writeOffset++] = hexCharCodeLookup[valueLow4Bits]
	}

	return charCodes
}

export function decodeHex(hexString: string) {
	const hexLength = hexString.length

	if (hexLength % 2 !== 0) {
		throw new Error(`Hexadecimal string doesn't have an even number of characters`)
	}

	const buffer = new Uint8Array(hexLength / 2)

	let readOffset = 0
	let writeOffset = 0

	while (readOffset < hexLength) {
		const valueHigh4Bits = hexCharCodeToValue(hexString.charCodeAt(readOffset++))
		const valueLow4Bits = hexCharCodeToValue(hexString.charCodeAt(readOffset++))

		const value = (valueHigh4Bits << 4) | valueLow4Bits

		buffer[writeOffset++] = value
	}

	return buffer
}

function hexCharCodeToValue(hexCharCode: number) {
	if (hexCharCode >= 48 && hexCharCode <= 57) { // '0'..'9'
		return hexCharCode - 48
	} else if (hexCharCode >= 97 && hexCharCode <= 102) { // 'a'..'f'
		return 10 + hexCharCode - 97
	} else if (hexCharCode >= 65 && hexCharCode <= 70) { // 'A'..'F'
		return 10 + hexCharCode - 65
	} else {
		throw new Error(`Can't decode character '${String.fromCharCode(hexCharCode)}' (code: ${hexCharCode}) as hexadecimal`)
	}
}

const hexCharLookup: string[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f']
const hexCharCodeLookup = new Uint8Array([48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 97, 98, 99, 100, 101, 102])
