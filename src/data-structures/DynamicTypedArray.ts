import { TypedArray, TypedArrayConstructor } from "../typings/TypedArray.js"

export class DynamicTypedArray<T extends TypedArray> {
	elements: TypedArray
	length = 0

	constructor(private TypedArrayConstructor: TypedArrayConstructor<T>, initialCapacity = 4) {
		this.elements = new TypedArrayConstructor(initialCapacity)
	}

	add(element: number) {
		this.ensureCapacity(this.length + 1)

		this.elements[this.length] = element
		this.length += 1
	}

	addMany(...elements: number[]) {
		this.addArray(elements)
	}

	addArray(elements: ArrayLike<number>) {
		const addedCount = elements.length

		this.ensureCapacity(this.length + addedCount)

		this.elements.set(elements, this.length)
		this.length += addedCount
	}

	ensureCapacity(requiredCapacity: number) {
		if (requiredCapacity > this.elements.length) {
			const newCapacity = requiredCapacity * 2

			const newElements = new this.TypedArrayConstructor(newCapacity)
			newElements.set(this.toTypedArray())

			this.elements = newElements
		}
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
