import { StringBuilder } from '../utilities/StringBuilder.js'

export function encodeHex(buffer: Uint8Array) {
	const stringBuilder = new StringBuilder()

	for (let i = 0; i < buffer.length; i++) {
		const value = buffer[i]

		const valueHigh4Bits = (value >>> 4) & 0xf
		const valueLow4Bits = value & 0xf

		stringBuilder.appendCharCode(hexCharCodeLookup[valueHigh4Bits])
		stringBuilder.appendCharCode(hexCharCodeLookup[valueLow4Bits])
	}

	return stringBuilder.toString()
}

export function decodeHex(hexString: string) {
	if (hexString.length % 2 !== 0) {
		throw new Error(`Hexadecimal string doesn't have an even number of characters`)
	}

	const bufferLength = hexString.length / 2

	const buffer = new Uint8Array(bufferLength)

	for (
		let writeOffset = 0, readOffset = 0;
		writeOffset < bufferLength;
		writeOffset++, readOffset += 2) {

		const valueHigh4Bits = hexCharCodeToValue(hexString.charCodeAt(readOffset))
		const valueLow4Bits = hexCharCodeToValue(hexString.charCodeAt(readOffset + 1))

		const value = (valueHigh4Bits << 4) | valueLow4Bits

		buffer[writeOffset] = value
	}

	return buffer
}

function hexCharCodeToValue(hexCharCode: number) {
	if (hexCharCode >= 48 && hexCharCode <= 57) {
		return hexCharCode - 48
	} else if (hexCharCode >= 97 && hexCharCode <= 102) {
		return 10 + hexCharCode - 97
	} else {
		throw new Error(`Can't decode character '${String.fromCharCode(hexCharCode)}' (code: ${hexCharCode}) as hexadecimal`)
	}
}

const hexCharLookup: string[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f']
const hexCharCodeLookup = new Uint8Array([48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 97, 98, 99, 100, 101, 102])
