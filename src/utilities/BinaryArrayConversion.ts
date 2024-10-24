// Typed arrays to Uint8Array buffers (little endian) conversions
//
// The conversion methods (other than the methods for int8 and int24) would only work correctly
// on little-endian architectures, since they assume the byte order of the underlying architecture.
//
// Since Echogarden only supports little-endian architectures, this shouldn't matter.

// int8 <-> bufferLE
export function int8ToBuffer(int8s: Int8Array) {
	return new Uint8Array(int8s.buffer, int8s.byteOffset, int8s.byteLength)
}

export function bufferToInt8(buffer: Uint8Array) {
	return new Int8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

// int16 <-> bufferLE
export function int16ToBufferLE(int16s: Int16Array) {
	return new Uint8Array(int16s.buffer, int16s.byteOffset, int16s.byteLength)
}

export function bufferLEToInt16(buffer: Uint8Array) {
	return new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2)
}

// int24 <-> bufferLE (uses int32 for storage)
export function int24ToBufferLE(int24s: Int32Array) {
	const buffer = new Uint8Array(int24s.length * 3)

	let readOffset = 0
	let writeOffset = 0

	while (readOffset < int24s.length) {
		const signedValue = int24s[readOffset++]

		let unsignedValue: number

		if (signedValue >= 0) {
			unsignedValue = signedValue
		} else {
			unsignedValue = signedValue + (2 ** 24)
		}

		buffer[writeOffset++] = (unsignedValue) & 0xff
		buffer[writeOffset++] = (unsignedValue >> 8) & 0xff
		buffer[writeOffset++] = (unsignedValue >> 16) & 0xff
	}

	return buffer
}

export function bufferLEToInt24(buffer: Uint8Array) {
	if (buffer.length % 3 !== 0) {
		throw new Error(`Buffer has a length of ${buffer.length}, which is not a multiple of 3`)
	}

	const result = new Int32Array(buffer.length / 3)

	let readOffset = 0
	let writeOffset = 0

	while (writeOffset < result.length) {
		const b0 = buffer[readOffset++]
		const b1 = buffer[readOffset++]
		const b2 = buffer[readOffset++]

		const unsignedValue = (b0) | (b1 << 8) | (b2 << 16)

		let signedValue: number

		if (unsignedValue < 2 ** 23) {
			signedValue = unsignedValue
		} else {
			signedValue = unsignedValue - (2 ** 24)
		}

		result[writeOffset++] = signedValue
	}

	return result
}

// int32 <-> bufferLE
export function int32ToBufferLE(int32s: Int32Array) {
	return new Uint8Array(int32s.buffer, int32s.byteOffset, int32s.byteLength)
}

export function bufferLEToInt32(buffer: Uint8Array) {
	return new Int32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
}

// float32 <-> bufferLE
export function float32ToBufferLE(float32s: Float32Array) {
	return new Uint8Array(float32s.buffer, float32s.byteOffset, float32s.byteLength)
}

export function bufferLEToFloat32(buffer: Uint8Array) {
	return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
}

// float64 <-> bufferLE
export function float64ToBufferLE(float64s: Float64Array) {
	return new Uint8Array(float64s.buffer, float64s.byteOffset, float64s.byteLength)
}

export function bufferLEToFloat64(buffer: Uint8Array) {
	return new Float64Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 8)
}

// float64 <-> float32
export function float64Tofloat32(float64s: Float64Array) {
	return Float32Array.from(float64s)
}

export function float32Tofloat64(float32s: Float32Array) {
	return Float64Array.from(float32s)
}
