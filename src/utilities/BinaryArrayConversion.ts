// Typed arrays to Buffer (little endian) conversions
//
// The faster conversion methods (other than the methods for int8) would only work correctly
// on little-endian architectures, since they assume the byte order of the underlying architecture.
//
// Since Echogarden only supports little-endian architectures, this shouldn't matter.

// int8 <-> bufferLE
export function int8ToBuffer(int8s: Int8Array) {
	return Buffer.copyBytesFrom(int8s)
}

export function int8ToBuffer_Slow(int8s: Int8Array) {
	const buffer = Buffer.alloc(int8s.length)

	for (let i = 0; i < int8s.length; i++) {
		buffer[i] = int8s[i] + 128
	}

	return buffer
}

export function bufferToInt8(buffer: Buffer) {
	return new Int8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

export function bufferToInt8_Slow(buffer: Buffer) {
	const result = new Int8Array(buffer.length)

	for (let i = 0; i < result.length; i++) {
		result[i] = buffer[i] - 128
	}

	return result
}

// int16 <-> bufferLE
export function int16ToBufferLE(int16s: Int16Array) {
	return Buffer.copyBytesFrom(int16s)
}

export function int16ToBufferLE_Slow(int16s: Int16Array) {
	const buffer = Buffer.alloc(int16s.length * 2)

	for (let i = 0; i < int16s.length; i++) {
		buffer.writeInt16LE(int16s[i], i * 2)
	}

	return buffer
}

export function bufferLEToInt16(buffer: Buffer) {
	return new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2)
}

export function bufferLEToInt16_Slow(buffer: Buffer) {
	const result = new Int16Array(buffer.length / 2)

	for (let i = 0; i < result.length; i++) {
		result[i] = buffer.readInt16LE(i * 2)
	}

	return result
}

// int24 <-> bufferLE (uses int32 for storage)
export function int24ToBufferLE(int24s: Int32Array) {
	const buffer = Buffer.alloc(int24s.length * 3)

	for (let i = 0; i < int24s.length; i++) {
		const val = int24s[i]
		const encodedVal = val < 0 ? val + 0x1000000 : val

		buffer[(i * 3) + 0] = (encodedVal >> 0) & 0xff
		buffer[(i * 3) + 1] = (encodedVal >> 8) & 0xff
		buffer[(i * 3) + 2] = (encodedVal >> 16) & 0xff
	}

	return buffer
}

export function bufferLEToInt24(buffer: Buffer) {
	const result = new Int32Array(buffer.length / 3)

	for (let i = 0; i < result.length; i++) {
		const b0 = buffer[(i * 3) + 0]
		const b1 = buffer[(i * 3) + 1]
		const b2 = buffer[(i * 3) + 2]

		const encodedVal = (b0 << 0) + (b1 << 8) + (b2 << 16)
		result[i] = encodedVal > 0x800000 ? encodedVal - 0x1000000 : encodedVal
	}

	return result
}

// int32 <-> bufferLE
export function int32ToBufferLE(int32s: Int32Array) {
	return Buffer.copyBytesFrom(int32s)
}

export function int32ToBufferLE_Slow(int32s: Int32Array) {
	const buffer = Buffer.alloc(int32s.length * 4)

	for (let i = 0; i < int32s.length; i++) {
		buffer.writeInt32LE(int32s[i], i * 4)
	}

	return buffer
}

export function bufferLEToInt32(buffer: Buffer) {
	return new Int32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
}

export function bufferLEToInt32_Slow(buffer: Buffer) {
	const result = new Int32Array(buffer.length / 4)

	for (let i = 0; i < result.length; i++) {
		result[i] = buffer.readInt32LE(i * 4)
	}

	return result
}

// float32 <-> bufferLE
export function float32ToBufferLE(float32s: Float32Array) {
	return Buffer.copyBytesFrom(float32s)
}

export function float32ToBufferLE_Slow(float32s: Float32Array) {
	const buffer = Buffer.alloc(float32s.length * 4)

	for (let i = 0; i < float32s.length; i++) {
		buffer.writeFloatLE(float32s[i], i * 4)
	}

	return buffer
}

export function bufferLEToFloat32(buffer: Buffer) {
	return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
}

export function bufferLEToFloat32_Slow(buffer: Buffer) {
	const result = new Float32Array(buffer.length / 4)

	for (let i = 0; i < result.length; i++) {
		result[i] = buffer.readFloatLE(i * 4)
	}

	return result
}

// float64 <-> bufferLE
export function float64ToBufferLE(float64s: Float64Array) {
	return Buffer.copyBytesFrom(float64s)
}

export function float64ToBufferLE_Slow(float64s: Float64Array) {
	const buffer = Buffer.alloc(float64s.length * 8)

	for (let i = 0; i < float64s.length; i++) {
		buffer.writeDoubleLE(float64s[i], i * 8)
	}

	return buffer
}

export function bufferLEToFloat64(buffer: Buffer) {
	return new Float64Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 8)
}

export function bufferLEToFloat64_Slow(buffer: Buffer) {
	const result = new Float64Array(buffer.length / 8)

	for (let i = 0; i < result.length; i++) {
		result[i] = buffer.readDoubleLE(i * 8)
	}

	return result
}

// float64 <-> float32
export function float64Tofloat32(float64s: Float64Array) {
	return Float32Array.from(float64s)
}

export function float32Tofloat64(float32s: Float32Array) {
	return Float64Array.from(float32s)
}
