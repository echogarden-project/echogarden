import { createDynamicUint8Array, DynamicUint8Array } from "../data-structures/DynamicTypedArray.js"
import { logToStderr } from "../utilities/Utilities.js"


////////////////////////////////////////////////////////////////////////////////////
// Encode unsigned integer
////////////////////////////////////////////////////////////////////////////////////
export function encodeUnsignedInt31(value: number, outEncodedData: DynamicUint8Array) {
	value = value >>> 0

	if (value < (2 ** 7)) {
		outEncodedData.add(
			value
		)
	} else if (value < (2 ** 14)) {
		outEncodedData.addMany(
			(value & 0b00111111) | 0b10000000,
			value >>> 6,
		)
	} else if (value < (2 ** 21)) {
		outEncodedData.addMany(
			(value & 0b00011111) | 0b11000000,
			value >>> 5,
			value >>> 13,
		)
	} else if (value < (2 ** 28)) {
		outEncodedData.addMany(
			(value & 0b00001111) | 0b11100000,
			value >>> 4,
			value >>> 12,
			value >>> 20,
		)
	} else {
		outEncodedData.addMany(
			0b11110000,
			value,
			value >>> 8,
			value >>> 16,
			value >>> 24,
		)
	}
}

////////////////////////////////////////////////////////////////////////////////////
// Decode unsigned integer
////////////////////////////////////////////////////////////////////////////////////
export function decodeUnsignedInt31(encodedData: ArrayLike<number>, readOffset: number): DecodedValueAndReadOffset {
	readOffset = readOffset | 0

	const byte0 = encodedData[readOffset++]

	if ((byte0 & 0b10000000) === 0) {
		// 1 byte
		let decodedValue =
			byte0

		return { decodedValue, readOffset }
	}

	const byte1 = encodedData[readOffset++]

	if ((byte0 & 0b01000000) === 0) {
		// 2 bytes
		let decodedValue =
			(byte0 & 0b00111111) |
			(byte1 << 6)

		return { decodedValue, readOffset }
	}

	const byte2 = encodedData[readOffset++]

	if ((byte0 & 0b00100000) === 0) {
		// 3 bytes
		let decodedValue =
			(byte0 & 0b00011111) |
			(byte1 << 5) |
			(byte2 << 13)

		return { decodedValue, readOffset }
	}

	const byte3 = encodedData[readOffset++]

	if ((byte0 & 0b00010000) === 0) {
		// 4 bytes
		let decodedValue =
			(byte0 & 0b00001111) |
			(byte1 << 4) |
			(byte2 << 12) |
			(byte3 << 20)

		return { decodedValue, readOffset }
	}

	const byte4 = encodedData[readOffset++]

	if (byte0 === 0b11110000) {
		// 5 bytes
		let decodedValue =
			(byte1) |
			(byte2 << 8) |
			(byte3 << 16) |
			(byte4 << 24)

		return { decodedValue, readOffset }
	}

	throw new Error(`Encountered a value that is encoded with more than 5 bytes (beyond Unsigned Int31 range).`)
}

////////////////////////////////////////////////////////////////////////////////////
// Encode signed integer
////////////////////////////////////////////////////////////////////////////////////
export function encodeSignedInt32(value: number, outEncodedData: DynamicUint8Array) {
	const absValue = Math.abs(value | 0)

	if (absValue < (2 ** 6)) {
		outEncodedData.add(
			value & 0b01111111
		)
	} else if (absValue < (2 ** 13)) {
		outEncodedData.addMany(
			(value & 0b00111111) | 0b10000000,
			value >> 6
		)
	} else if (absValue < (2 ** 20)) {
		outEncodedData.addMany(
			(value & 0b00011111) | 0b11000000,
			value >> 5,
			value >> 13,
		)
	} else if (absValue < (2 ** 27)) {
		outEncodedData.addMany(
			(value & 0b00001111) | 0b11100000,
			value >> 4,
			value >> 12,
			value >> 20,
		)
	} else {
		outEncodedData.addMany(
			0b11110000,
			value,
			value >> 8,
			value >> 16,
			value >> 24,
		)
	}
}

////////////////////////////////////////////////////////////////////////////////////
// Decode signed integer
////////////////////////////////////////////////////////////////////////////////////
export function decodeSignedInt32(encodedData: ArrayLike<number>, readOffset: number): DecodedValueAndReadOffset {
	const byte0 = encodedData[readOffset++]

	if ((byte0 & 0b10000000) === 0) {
		// 1 byte
		let decodedValue =
			byte0

		if ((byte0 & 0b01000000) !== 0) {
			decodedValue |= (-1 << 7)
		}

		return { decodedValue, readOffset }
	}

	const byte1 = encodedData[readOffset++]

	if ((byte0 & 0b01000000) === 0) {
		// 2 bytes
		let decodedValue =
			(byte0 & 0b00111111) |
			(byte1 << 6)

		if ((byte1 & 0b10000000) !== 0) {
			decodedValue |= (-1 << 14)
		}

		return { decodedValue, readOffset }
	}

	const byte2 = encodedData[readOffset++]

	if ((byte0 & 0b00100000) === 0) {
		// 3 bytes
		let decodedValue =
			(byte0 & 0b00011111) |
			(byte1 << 5) |
			(byte2 << 13)

		if ((byte2 & 0b10000000) !== 0) {
			decodedValue |= (-1 << 21)
		}

		return { decodedValue, readOffset }
	}

	const byte3 = encodedData[readOffset++]

	if ((byte0 & 0b00010000) === 0) {
		// 4 bytes
		let decodedValue =
			(byte0 & 0b00001111) |
			(byte1 << 4) |
			(byte2 << 12) |
			(byte3 << 20)

		if ((byte3 & 0b10000000) !== 0) {
			decodedValue |= (-1 << 28)
		}

		return { decodedValue, readOffset }
	}

	const byte4 = encodedData[readOffset++]

	if (byte0 === 0b11110000) {
		// 5 bytes
		let decodedValue =
			(byte1) |
			(byte2 << 8) |
			(byte3 << 16) |
			(byte4 << 24)

		return { decodedValue, readOffset }
	}

	throw new Error(`Encountered a value that is encoded with more than 5 bytes (beyond int32 range).`)
}

////////////////////////////////////////////////////////////////////////////////////
// Types
////////////////////////////////////////////////////////////////////////////////////
export interface DecodedValueAndReadOffset {
	decodedValue: number
	readOffset: number
}

////////////////////////////////////////////////////////////////////////////////////
// Tests
////////////////////////////////////////////////////////////////////////////////////
export function testLPVarintSigned() {
	const encodedBytes = createDynamicUint8Array()

	function runTest(testValue: number) {
		encodedBytes.clear()

		encodeSignedInt32(testValue, encodedBytes)
		const { decodedValue } = decodeSignedInt32(encodedBytes.elements, 0)

		if (decodedValue !== testValue) {
			throw new Error(`Expected ${testValue} but got ${decodedValue}`)
		}
	}

	for (let i = -(2 ** 26); i < 2 ** 26; i++) {
		if (i % 1000000 === 0) {
			logToStderr(i)
		}

		runTest(i)
	}

	const x = 1
}

export function testLPVarintUnsigned() {
	const encodedBytes = createDynamicUint8Array()

	function runTest(testValue: number) {
		encodedBytes.clear()

		encodeUnsignedInt31(testValue, encodedBytes)
		const { decodedValue } = decodeUnsignedInt31(encodedBytes.elements, 0)

		if (decodedValue !== testValue) {
			throw new Error(`Expected ${testValue} but got ${decodedValue}`)
		}
	}

	for (let i = 0; i < 2 ** 31; i++) {
		if (i % 1000000 === 0) {
			logToStderr(i)
		}

		runTest(i)
	}

	const x = 1
}
