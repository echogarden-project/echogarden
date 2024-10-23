import { TypedArray, TypedArrayConstructor } from "../typings/TypedArray.js"

export class DynamicTypedArray<T extends TypedArray> {
	elements: TypedArray
	length = 0

	constructor(private TypedArrayConstructor: TypedArrayConstructor<T>, initialCapacity = 4) {
		this.elements = new TypedArrayConstructor(initialCapacity)
	}

	add(newElement: number) {
		const length = this.length

		if (length === this.elements.length) {
			this.ensureCapacity(length + 1)
		}

		this.elements[length] = newElement
		this.length += 1
	}

	addMany(...newElements: number[]) {
		this.addArray(newElements)
	}

	addArray(newElements: ArrayLike<number>) {
		const addedCount = newElements.length

		this.ensureCapacity(this.length + addedCount)

		this.elements.set(newElements, this.length)
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
