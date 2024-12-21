import { TypedArray, TypedArrayConstructor } from '../typings/TypedArray.js'

export class DynamicTypedArray<T extends TypedArray> {
	elements: TypedArray
	length = 0

	constructor(private TypedArrayConstructor: TypedArrayConstructor<T>, initialCapacity = 4) {
		this.elements = new TypedArrayConstructor(initialCapacity)
	}

	add(newElement: number) {
		const newLength = this.length + 1

		if (newLength > this.capacity) {
			this.ensureCapacity(newLength)
		}

		this.elements[this.length] = newElement
		this.length = newLength
	}

	addMany(...newElements: number[]) {
		this.addArray(newElements)
	}

	addArray(newElements: ArrayLike<number>) {
		const newLength = this.length + newElements.length

		if (newLength > this.capacity) {
			this.ensureCapacity(newLength)
		}

		this.elements.set(newElements, this.length)
		this.length = newLength
	}

	ensureCapacity(requiredCapacity: number) {
		if (requiredCapacity > this.capacity) {
			const newCapacity = requiredCapacity * 2

			const newElements = new this.TypedArrayConstructor(newCapacity)
			newElements.set(this.toTypedArray())

			this.elements = newElements
		}
	}

	get capacity() {
		return this.elements.length
	}

	toTypedArray() {
		return this.elements.subarray(0, this.length) as T
	}

	clear() {
		this.length = 0
	}
}

export function createDynamicUint8Array(initialCapacity?: number): DynamicUint8Array {
	return new DynamicTypedArray<Uint8Array>(Uint8Array, initialCapacity)
}

export function createDynamicUint16Array(initialCapacity?: number): DynamicUint16Array {
	return new DynamicTypedArray<Uint16Array>(Uint16Array, initialCapacity)
}

export type DynamicUint8Array = DynamicTypedArray<Uint8Array>
export type DynamicUint16Array = DynamicTypedArray<Uint16Array>
