export function readInt16LE(buffer: Uint8Array, offset: number) {
	const value =
		(buffer[offset]) |
		(buffer[offset + 1] << 8)

	return value
}

export function writeInt16LE(buffer: Uint8Array, value: number, offset: number) {
	value |= 0

	buffer[offset] = value & 0xff
	buffer[offset + 1] = (value >> 8) & 0xff
}

export function readInt32LE(buffer: Uint8Array, offset: number) {
	const value =
		(buffer[offset]) |
		(buffer[offset + 1] << 8) |
		(buffer[offset + 2] << 16) |
		(buffer[offset + 3] << 24)

	return value
}

export function writeInt32LE(buffer: Uint8Array, value: number, offset: number) {
	value |= 0

	buffer[offset] = value & 0xff
	buffer[offset + 1] = (value >> 8) & 0xff
	buffer[offset + 2] = (value >> 16) & 0xff
	buffer[offset + 3] = (value >> 24) & 0xff
}

export function readUint16LE(buffer: Uint8Array, offset: number) {
	return readInt16LE(buffer, offset) >>> 0
}

export function writeUint16LE(buffer: Uint8Array, value: number, offset: number) {
	value = value >>> 0

	buffer[offset] = value & 0xff
	buffer[offset + 1] = (value >>> 8) & 0xff
}

export function readUint32LE(buffer: Uint8Array, offset: number) {
	return readInt32LE(buffer, offset) >>> 0
}

export function writeUint32LE(buffer: Uint8Array, value: number, offset: number) {
	value = value >>> 0

	buffer[offset] = value & 0xff
	buffer[offset + 1] = (value >>> 8) & 0xff
	buffer[offset + 2] = (value >>> 16) & 0xff
	buffer[offset + 3] = (value >>> 24) & 0xff
}

export function writeAscii(buffer: Uint8Array, str: string, writeStartOffset: number) {
	const writeEndOffset = Math.min(writeStartOffset + str.length, buffer.length)

	for (
		let writeOffset = writeStartOffset, readOffset = 0;
		writeOffset < writeEndOffset;
		writeOffset++, readOffset++) {
			
		buffer[writeOffset] = str.charCodeAt(readOffset)
	}
}
