import { DynamicUint8Array, createDynamicUint8Array } from "../data-structures/DynamicTypedArray.js"
import { logToStderr } from "../utilities/Utilities.js"

////////////////////////////////////////////////////////////////////////////////////////////////////
// Encode unsigned integer
////////////////////////////////////////////////////////////////////////////////////////////////////
export function encodeUnsignedInt(value: number | bigint, outEncodedData: DynamicUint8Array) {
	if (value < 0) {
		throw new Error(`The negative value ${value} can't be encoded as an unsigned LEB128 integer.`)
	}

	if (typeof value === 'number') {
		if (value < (2 ** 31)) {
			return encodeUnsignedInt31(value, outEncodedData)
		} else {
			return encodeUnsignedBigInt(BigInt(value), outEncodedData)
		}
	} else {
		return encodeUnsignedBigInt(value, outEncodedData)
	}
}

function encodeUnsignedInt31(value: number, outEncodedData: DynamicUint8Array) {
	value = value >>> 0

	if (value < (2 ** 7)) {
		outEncodedData.add(
			value
		)
	} else if (value < (2 ** 14)) {
		outEncodedData.addMany(
			(value & 0b01111111) | 0b10000000,
			value >>> 7
		)
	} else if (value < (2 ** 21)) {
		outEncodedData.addMany(
			(value & 0b01111111) | 0b10000000,
			((value >>> 7) & 0b01111111) | 0b10000000,
			value >>> 14
		)
	} else if (value < (2 ** 28)) {
		outEncodedData.addMany(
			(value & 0b01111111) | 0b10000000,
			((value >>> 7) & 0b01111111) | 0b10000000,
			((value >>> 14) & 0b01111111) | 0b10000000,
			value >>> 21
		)
	} else {
		outEncodedData.addMany(
			(value & 0b01111111) | 0b10000000,
			((value >>> 7) & 0b01111111) | 0b10000000,
			((value >>> 14) & 0b01111111) | 0b10000000,
			((value >>> 21) & 0b01111111) | 0b10000000,
			value >>> 28
		)
	}

	return outEncodedData
}

function encodeUnsignedBigInt(value: bigint, outEncodedData: DynamicUint8Array) {
	while (true) {
		const lowest7Bits = Number(value & 0b01111111n)

		value = value >> 7n

		if (value === 0n) {
			outEncodedData.add(lowest7Bits)

			return outEncodedData
		} else {
			outEncodedData.add(lowest7Bits | 0b10000000)
		}
	}
}

////////////////////////////////////////////////////////////////////////////////////
// Decode unsigned integer
////////////////////////////////////////////////////////////////////////////////////
export function decodeUnsignedInt31Fast(encodedData: ArrayLike<number>, readOffset: number): DecodedValueAndReadOffset {
	const byte0 = encodedData[readOffset++]

	if ((byte0 & 0b10000000) === 0) {
		const decodedValue =
			byte0

		return { decodedValue, readOffset }
	}

	const byte1 = encodedData[readOffset++]

	if ((byte1 & 0b10000000) === 0) {
		const decodedValue =
			(byte0 & 0b01111111) |
			(byte1 & 0b01111111) << 7

		return { decodedValue, readOffset }
	}

	const byte2 = encodedData[readOffset++]

	if ((byte2 & 0b10000000) === 0) {
		const decodedValue =
			(byte0 & 0b01111111) |
			(byte1 & 0b01111111) << 7 |
			(byte2 & 0b01111111) << 14

		return { decodedValue, readOffset }
	}

	const byte3 = encodedData[readOffset++]

	if ((byte3 & 0b10000000) === 0) {
		const decodedValue =
			(byte0 & 0b01111111) |
			(byte1 & 0b01111111) << 7 |
			(byte2 & 0b01111111) << 14 |
			(byte3 & 0b01111111) << 21

		return { decodedValue, readOffset }
	}

	const byte4 = encodedData[readOffset++]

	if ((byte4 & 0b10000000) === 0) {
		const decodedValue =
			(byte0 & 0b01111111) |
			(byte1 & 0b01111111) << 7 |
			(byte2 & 0b01111111) << 14 |
			(byte3 & 0b01111111) << 21 |
			(byte4 & 0b01111111) << 28

		return { decodedValue, readOffset }
	}

	if (readOffset >= encodedData.length) {
		throw new Error(`Invalid LEB128 data. Last encoded byte sequence is truncated.`)
	} else {
		throw new Error(`LEB128 sequence can't be decoded. Encoded byte sequence represents a value that extends beyond the range of a unsigned 32 bit integer.`)
	}
}

////////////////////////////////////////////////////////////////////////////////////
// Encode signed integer
////////////////////////////////////////////////////////////////////////////////////
export function encodeSignedInt32(value: number, outEncodedData: DynamicUint8Array) {
	if (value < -(2 ** 31) || value > (2 ** 31)) {
		throw new Error('Value must be between -(2^31) and 2^31 - 1')
	}

	while (true) {
		const lowest7Bits = value & 0b01111111

		value >>= 7

		if (
			(value === 0 && (lowest7Bits & 0b01000000) === 0) ||
			(value === -1 && (lowest7Bits & 0b01000000) !== 0)) {
			outEncodedData.add(lowest7Bits)

			return outEncodedData
		} else {
			outEncodedData.add(lowest7Bits | 0b10000000)
		}
	}
}

export function encodeSignedInt32Fast(value: number, outEncodedData: DynamicUint8Array) {
	const absValue = Math.abs(value | 0)

	if (absValue < (2 ** 6)) {
		outEncodedData.add(
			(value & 0b01111111)
		)
	} else if (absValue < (2 ** 13)) {
		outEncodedData.addMany(
			(value & 0b01111111) | 0b10000000,
			(value >> 7) & 0b01111111
		)
	} else if (absValue < (2 ** 20)) {
		outEncodedData.addMany(
			(value & 0b01111111) | 0b10000000,
			((value >> 7) & 0b01111111) | 0b10000000,
			(value >> 14) & 0b01111111
		)
	} else if (absValue < (2 ** 27)) {
		outEncodedData.addMany(
			(value & 0b01111111) | 0b10000000,
			((value >> 7) & 0b01111111) | 0b10000000,
			((value >> 14) & 0b01111111) | 0b10000000,
			(value >> 21) & 0b01111111
		)
	} else {
		outEncodedData.addMany(
			(value & 0b01111111) | 0b10000000,
			((value >> 7) & 0b01111111) | 0b10000000,
			((value >> 14) & 0b01111111) | 0b10000000,
			((value >> 21) & 0b01111111) | 0b10000000,
			(value >> 28) & 0b01111111
		)
	}

	return outEncodedData
}

////////////////////////////////////////////////////////////////////////////////////
// Decode signed integer
////////////////////////////////////////////////////////////////////////////////////
export function decodeSignedInt32(encodedData: ArrayLike<number>, readOffset: number): DecodedValueAndReadOffset {
	let decodedValue = 0
	let shiftAmount = 0

	while (true) {
		const encodedByte = encodedData[readOffset++]
		const lowest7Bits = encodedByte & 0b01111111

		decodedValue |= lowest7Bits << shiftAmount

		// If 8th bit is 0, then this is the last byte in the sequence
		if ((encodedByte & 0b10000000) === 0) {
			// If 7th bit is 1, then the value is negative
			if ((encodedByte & 0b01000000) !== 0) {
				// If the value should be negative
				// Ensure that the value is encoded as a negative number by
				// setting all higher bits to 1
				decodedValue |= -1 << Math.min(shiftAmount + 7, 31)
			}

			return { decodedValue, readOffset }
		}

		if (readOffset === encodedData.length) {
			throw new Error(`Invalid LEB128 data. Last encoded byte sequence is truncated.`)
		}

		shiftAmount += 7

		if (shiftAmount > 31) {
			throw new Error(`LEB128 sequence can't be decoded. Byte sequence extends beyond the range of a signed 32 bit integer.`)
		}
	}
}

export function decodeSignedInt32Fast(encodedData: ArrayLike<number>, readOffset: number) {
	const byte0 = encodedData[readOffset++]

	if ((byte0 & 0b10000000) === 0) {
		let decodedValue =
			byte0

		if ((byte0 & 0b01000000) !== 0) {
			decodedValue |= -1 << 7
		}

		return { decodedValue, readOffset }
	}

	const byte1 = encodedData[readOffset++]

	if ((byte1 & 0b10000000) === 0) {
		let decodedValue =
			(byte0 & 0b01111111) |
			(byte1 & 0b01111111) << 7

		if ((byte1 & 0b01000000) !== 0) {
			decodedValue |= -1 << 14
		}

		return { decodedValue, readOffset }
	}

	const byte2 = encodedData[readOffset++]

	if ((byte2 & 0b10000000) === 0) {
		let decodedValue =
			(byte0 & 0b01111111) |
			(byte1 & 0b01111111) << 7 |
			(byte2 & 0b01111111) << 14

		if ((byte2 & 0b01000000) !== 0) {
			decodedValue |= -1 << 21
		}

		return { decodedValue, readOffset }
	}

	const byte3 = encodedData[readOffset++]

	if ((byte3 & 0b10000000) === 0) {
		let decodedValue =
			(byte0 & 0b01111111) |
			(byte1 & 0b01111111) << 7 |
			(byte2 & 0b01111111) << 14 |
			(byte3 & 0b01111111) << 21

		if ((byte3 & 0b01000000) !== 0) {
			decodedValue |= -1 << 28
		}

		return { decodedValue, readOffset }
	}

	const byte4 = encodedData[readOffset++]

	if ((byte4 & 0b10000000) === 0) {
		let decodedValue =
			(byte0 & 0b01111111) |
			(byte1 & 0b01111111) << 7 |
			(byte2 & 0b01111111) << 14 |
			(byte3 & 0b01111111) << 21 |
			(byte4 & 0b01111111) << 28

		if ((byte4 & 0b01000000) !== 0) {
			decodedValue |= -1 << 31
		}

		return { decodedValue, readOffset }
	}

	if (readOffset >= encodedData.length) {
		throw new Error(`Invalid LEB128 data. Last encoded byte sequence is truncated.`)
	} else {
		throw new Error(`LEB128 sequence can't be decoded. Encoded byte sequence represents a value that extends beyond the range of a signed 32 bit integer.`)
	}
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
export function testLeb128Signed() {
	const encodedBytes = createDynamicUint8Array()

	function runTest(testValue: number) {
		encodedBytes.clear()

		encodeSignedInt32Fast(testValue, encodedBytes)
		const { decodedValue } = decodeSignedInt32Fast(encodedBytes.elements, 0)

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
