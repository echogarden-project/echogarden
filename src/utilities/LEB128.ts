import { logToStderr } from "./Utilities.js"

////////////////////////////////////////////////////////////////////////////////////
// Encode
////////////////////////////////////////////////////////////////////////////////////
export function encodeSignedInt32(value: number, outEncodedData: number[]) {
	if (value < -2147483648 || value > 2147483647) {
		throw new Error('Value must be between -2147483648 and 2147483647')
	}

	while (true) {
		const lowest7Bits = value & 127

		value >>= 7

		if (
			(value === 0 && (lowest7Bits & 64) === 0) ||
			(value === -1 && (lowest7Bits & 64) !== 0)) {
			outEncodedData.push(lowest7Bits)

			return outEncodedData
		} else {
			outEncodedData.push(lowest7Bits | 128)
		}
	}
}

export function encodeSignedInt32sFast(value: number, outEncodedData: number[]) {
	const absValue = Math.abs(value)
	//const absMask = value >> 31
	//const absValue = (value ^ absMask) - absMask

	if (absValue < (2 ** 6)) {
		outEncodedData.push(
			(value & 127)
		)
	} else if (absValue < (2 ** 13)) {
		outEncodedData.push(
			(value & 127) | 128,
			(value >> 7) & 127
		)
	} else if (absValue < (2 ** 20)) {
		outEncodedData.push(
			(value & 127) | 128,
			((value >> 7) & 127) | 128,
			(value >> 14) & 127
		)
	} else if (absValue < (2 ** 27)) {
		outEncodedData.push(
			(value & 127) | 128,
			((value >> 7) & 127) | 128,
			((value >> 14) & 127) | 128,
			(value >> 21) & 127
		)
	} else if (value < (2 ** 31) && value >= -(2 ** 31)) {
		outEncodedData.push(
			(value & 127) | 128,
			((value >> 7) & 127) | 128,
			((value >> 14) & 127) | 128,
			((value >> 21) & 127) | 128,
			(value >> 28) & 127
		)
	} else {
		throw new Error(`Value must be between -2147483648 and 2147483647`)
	}
}

////////////////////////////////////////////////////////////////////////////////////
// Decode
////////////////////////////////////////////////////////////////////////////////////
export function decodeSignedInt32s(encodedData: ArrayLike<number>, outDecodedValues: number[]) {
	for (let readIndex = 0; readIndex < encodedData.length;) {
		let currentDecodedValue = 0
		let shiftAmount = 0

		while (true) {
			const encodedByte = encodedData[readIndex++]
			const lowest7Bits = encodedByte & 127

			currentDecodedValue |= lowest7Bits << shiftAmount

			// If 8th bit is 0, then this is the last byte in the sequence
			if ((encodedByte & 128) === 0) {
				// If 7th bit is 1, then the value is negative
				if ((encodedByte & 64) !== 0) {
					// If the value should be negative
					// Ensure that the value is encoded as a negative number by
					// setting all higher bits to 1
					currentDecodedValue |= -1 << Math.min(shiftAmount + 7, 31)
				}

				break
			}

			if (readIndex === encodedData.length) {
				throw new Error(`Invalid LEB128 data. Last encoded byte sequence is truncated.`)
			}

			shiftAmount += 7

			if (shiftAmount > 31) {
				throw new Error(`LEB128 sequence can't be decoded. Byte sequence extends beyond the range of a signed 32 bit integer.`)
			}
		}

		outDecodedValues.push(currentDecodedValue)
	}

	return outDecodedValues
}

export function decodeSignedInt32sFast(encodedData: ArrayLike<number>, outDecodedValues: number[]) {
	for (let readIndex = 0; readIndex < encodedData.length;) {
		const byte0 = encodedData[readIndex++]

		if ((byte0 & 128) === 0) {
			let decodedValue =
				(byte0 & 127)

			if ((byte0 & 64) !== 0) {
				decodedValue |= -1 << 7
			}

			outDecodedValues.push(decodedValue)

			continue
		}

		const byte1 = encodedData[readIndex++]

		if ((byte1 & 128) === 0) {
			let decodedValue =
				(byte0 & 127) |
				(byte1 & 127) << 7

			if ((byte1 & 64) !== 0) {
				decodedValue |= -1 << 14
			}

			outDecodedValues.push(decodedValue)

			continue
		}

		const byte2 = encodedData[readIndex++]

		if ((byte2 & 128) === 0) {
			let decodedValue =
				(byte0 & 127) |
				(byte1 & 127) << 7 |
				(byte2 & 127) << 14

			if ((byte2 & 64) !== 0) {
				decodedValue |= -1 << 21
			}

			outDecodedValues.push(decodedValue)

			continue
		}

		const byte3 = encodedData[readIndex++]

		if ((byte3 & 128) === 0) {
			let decodedValue =
				(byte0 & 127) |
				(byte1 & 127) << 7 |
				(byte2 & 127) << 14 |
				(byte3 & 127) << 21

			if ((byte3 & 64) !== 0) {
				decodedValue |= -1 << 28
			}

			outDecodedValues.push(decodedValue)

			continue
		}

		const byte4 = encodedData[readIndex++]

		if ((byte4 & 128) === 0) {
			let decodedValue =
				(byte0 & 127) |
				(byte1 & 127) << 7 |
				(byte2 & 127) << 14 |
				(byte3 & 127) << 21 |
				(byte4 & 127) << 28

			if ((byte4 & 64) !== 0) {
				decodedValue |= -1 << 31
			}

			outDecodedValues.push(decodedValue)

			continue
		}

		if (readIndex >= encodedData.length) {
			throw new Error(`Invalid LEB128 data. Last encoded byte sequence is truncated.`)
		} else {
			throw new Error(`LEB128 sequence can't be decoded. Encoded byte sequence represents a value that extends beyond the range of a signed 32 bit integer.`)
		}
	}

	return outDecodedValues
}

////////////////////////////////////////////////////////////////////////////////////
// Tests
////////////////////////////////////////////////////////////////////////////////////
export function testLeb128() {
	const encodedBytes: number[] = []
	const decodedValues: number[] = []

	function runTest(testValue: number) {
		encodedBytes.length = 0
		decodedValues.length = 0

		encodeSignedInt32sFast(testValue, encodedBytes)
		decodeSignedInt32sFast(encodedBytes, decodedValues)

		if (decodedValues[0] !== testValue) {
			throw new Error(`Expected ${testValue} but got ${decodedValues[0]}`)
		}
	}

	for (let i = -(2 ** 22); i < 2 ** 22; i++) {
		if (i % 1000000 === 0) {
			logToStderr(i)
		}

		runTest(i)
	}

	const x = 1
}
