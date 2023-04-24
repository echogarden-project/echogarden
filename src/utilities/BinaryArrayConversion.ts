// Typed arrays to Buffer (little endian) conversions

// int8 <-> bufferLE
export function int8ToBuffer(ints: Int8Array) {
	const buffer = Buffer.alloc(ints.length)

	for (let i = 0; i < ints.length; i++) {
		buffer[i] = ints[i] + 128
	}

	return buffer
}

export function bufferToInt8(buffer: Buffer) {
	const result = new Int8Array(buffer.length)

	for (let i = 0; i < result.length; i++) {
		result[i] = buffer[i] - 128
	}

	return result
}

// int16 <-> bufferLE
export function int16ToBufferLE(ints: Int16Array) {
	const buffer = Buffer.alloc(ints.length * 2)

	for (let i = 0; i < ints.length; i++) {
		buffer.writeInt16LE(ints[i], i * 2)
	}

	return buffer
}

export function bufferLEToInt16(buffer: Buffer) {
	const result = new Int16Array(buffer.length / 2)

	for (let i = 0; i < result.length; i++) {
		result[i] = buffer.readInt16LE(i * 2)
	}

	return result
}

// int24 <-> bufferLE (uses int32 for storage)
export function int24ToBufferLE(ints: Int32Array) {
	const buffer = Buffer.alloc(ints.length * 3)

	for (let i = 0; i < ints.length; i++) {
		const val = ints[i]
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
export function int32ToBufferLE(ints: Int32Array) {
	const buffer = Buffer.alloc(ints.length * 4)

	for (let i = 0; i < ints.length; i++) {
		buffer.writeInt32LE(ints[i], i * 4)
	}

	return buffer
}

export function bufferLEToInt32(buffer: Buffer) {
	const result = new Int32Array(buffer.length / 4)

	for (let i = 0; i < result.length; i++) {
		result[i] = buffer.readInt32LE(i * 4)
	}

	return result
}

// float32 <-> bufferLE
export function float32ToBufferLE(floats: Float32Array) {
	const buffer = Buffer.alloc(floats.length * 4)

	for (let i = 0; i < floats.length; i++) {
		buffer.writeFloatLE(floats[i], i * 4)
	}

	return buffer
}

export function bufferLEToFloat32(buffer: Buffer) {
	const result = new Float32Array(buffer.length / 4)

	for (let i = 0; i < result.length; i++) {
		result[i] = buffer.readFloatLE(i * 4)
	}

	return result
}

// float64 <-> bufferLE
export function float64ToBufferLE(floats: Float64Array) {
	const buffer = Buffer.alloc(floats.length * 8)

	for (let i = 0; i < floats.length; i++) {
		buffer.writeDoubleLE(floats[i], i * 8)
	}

	return buffer
}

export function bufferLEToFloat64(buffer: Buffer) {
	const result = new Float64Array(buffer.length / 8)

	for (let i = 0; i < result.length; i++) {
		result[i] = buffer.readDoubleLE(i * 8)
	}

	return result
}

// float64 <-> float32
export function float64Tofloat32(doubles: Float64Array) {
	const floats = new Float32Array(doubles.length)

	for (let i = 0; i < doubles.length; i++) {
		floats[i] = doubles[i]
	}

	return floats
}

export function float32Tofloat64(floats: Float32Array) {
	const doubles = new Float64Array(floats.length)

	for (let i = 0; i < floats.length; i++) {
		doubles[i] = floats[i]
	}

	return doubles
}

