export type TypedArray = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array

export interface TypedArrayConstructor<T extends TypedArray> {
	new(length: number): T
}
