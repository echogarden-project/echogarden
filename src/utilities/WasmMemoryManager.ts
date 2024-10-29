import { decodeUtf8, encodeUtf8 } from "../encodings/Utf8.js"
import { TypedArray } from "../typings/TypedArray.js"
import { concatUint8Arrays } from "./Utilities.js"

export class WasmMemoryManager {
	wasmModule: any

	private wasmAlloc: WasmAllocMethod
	private wasmFree: WasmFreeMethod

	private allocatedReferences = new Set<WasmRef>()

	constructor(wasmModule: any, options?: WasmMemoryManagerOptions) {
		options = options ?? {}

		this.wasmModule = wasmModule

		if (options.wasmAlloc) {
			this.wasmAlloc = options.wasmAlloc
		} else {
			if (!wasmModule._malloc) {
				throw new Error(`Couldn't find a '_malloc' function in the module and no custom 'wasmAlloc' was provided in the options`)
			}

			this.wasmAlloc = wasmModule._malloc
		}

		if (options.wasmFree) {
			this.wasmFree = options.wasmFree
		} else {
			if (!wasmModule._free) {
				throw new Error(`Couldn't find a '_malloc' function in the module and no custom 'wasmFree' was provided in the options`)
			}

			this.wasmFree = wasmModule._free
		}
	}

	allocInt8() {
		const address = this.alloc(1)
		return this.wrapInt8(address).clear()
	}

	wrapInt8(address: number) {
		const ref = new Int8Ref(address, this)
		this.allocatedReferences.add(ref)
		return ref
	}

	allocUint8() {
		const address = this.alloc(1)
		return this.wrapUint8(address).clear()
	}

	wrapUint8(address: number) {
		const ref = new Uint8Ref(address, this)
		this.allocatedReferences.add(ref)
		return ref
	}

	allocInt16() {
		const address = this.alloc(2)
		return this.wrapInt16(address).clear()
	}

	wrapInt16(address: number) {
		const ref = new Int16Ref(address, this)
		this.allocatedReferences.add(ref)
		return ref
	}

	allocUint16() {
		const address = this.alloc(2)
		return this.wrapUint16(address).clear()
	}

	wrapUint16(address: number) {
		const ref = new Uint16Ref(address, this)
		this.allocatedReferences.add(ref)
		return ref
	}

	allocInt32() {
		const address = this.alloc(4)
		return this.wrapInt32(address).clear()
	}

	wrapInt32(address: number) {
		const ref = new Int32Ref(address, this)
		this.allocatedReferences.add(ref)
		return ref
	}

	allocUint32() {
		const address = this.alloc(4)
		return this.wrapUint32(address).clear()
	}

	wrapUint32(address: number) {
		const ref = new Uint32Ref(address, this)
		this.allocatedReferences.add(ref)
		return ref
	}

	allocPointer() {
		const address = this.alloc(4)
		return this.wrapPointer(address).clear()
	}

	wrapPointer(address: number) {
		const ref = new PointerRef(address, this)
		this.allocatedReferences.add(ref)
		return ref
	}

	allocFloat32() {
		const address = this.alloc(4)
		return this.wrapFloat64(address).clear()
	}

	wrapFloat32(address: number) {
		const ref = new Float32Ref(address, this)
		this.allocatedReferences.add(ref)
		return ref
	}

	allocFloat64() {
		const address = this.alloc(8)
		return this.wrapFloat64(address).clear()
	}

	wrapFloat64(address: number) {
		const ref = new Float64Ref(address, this)
		this.allocatedReferences.add(ref)
		return ref
	}

	// Allocate or wrap arrays
	allocInt8Array(length: number) {
		const address = this.alloc(length << 0)
		return this.wrapInt8Array(address, length).clear()
	}

	wrapInt8Array(address: number, length: number) {
		const ref = new Int8ArrayRef(address, length, this)
		this.allocatedReferences.add(ref)
		return ref
	}

	allocUint8Array(length: number) {
		const address = this.alloc(length << 0)
		return this.wrapUint8Array(address, length).clear()
	}

	wrapUint8Array(address: number, length: number) {
		const ref = new Uint8ArrayRef(address, length, this)
		this.allocatedReferences.add(ref)
		return ref
	}

	allocInt16Array(length: number) {
		const address = this.alloc(length << 1)
		return this.wrapInt16Array(address, length).clear()
	}

	wrapInt16Array(address: number, length: number) {
		const ref = new Int16ArrayRef(address, length, this)
		this.allocatedReferences.add(ref)
		return ref
	}

	allocUint16Array(length: number) {
		const address = this.alloc(length << 1)
		return this.wrapUint16Array(address, length).clear()
	}

	wrapUint16Array(address: number, length: number) {
		const ref = new Uint16ArrayRef(address, length, this)
		this.allocatedReferences.add(ref)
		return ref
	}

	allocInt32Array(length: number) {
		const address = this.alloc(length << 2)
		return this.wrapInt32Array(address, length).clear()
	}

	wrapInt32Array(address: number, length: number) {
		const ref = new Int32ArrayRef(address, length, this)
		this.allocatedReferences.add(ref)
		return ref
	}

	allocUint32Array(length: number) {
		const address = this.alloc(length << 2)
		return this.wrapUint32Array(address, length).clear()
	}

	wrapUint32Array(address: number, length: number) {
		const ref = new Uint32ArrayRef(address, length, this)
		this.allocatedReferences.add(ref)
		return ref
	}

	allocFloat32Array(length: number) {
		const address = this.alloc(length << 2)
		return this.wrapFloat32Array(address, length).clear()
	}

	wrapFloat32Array(address: number, length: number) {
		const ref = new Float32ArrayRef(address, length, this)
		this.allocatedReferences.add(ref)
		return ref
	}

	allocFloat64Array(length: number) {
		const address = this.alloc(length << 3)
		return this.wrapFloat64Array(address, length).clear()
	}

	wrapFloat64Array(address: number, length: number) {
		const ref = new Float64ArrayRef(address, length, this)
		this.allocatedReferences.add(ref)
		return ref
	}

	allocNullTerminatedUtf8String(str: string) {
		const strBuffer = concatUint8Arrays([encodeUtf8(str), new Uint8Array(1)])
		const ref = this.allocUint8Array(strBuffer.length)
		ref.view.set(strBuffer)
		return ref
	}

	wrapNullTerminatedUtf8String(address: number) {
		const ref = new NullTerminatedUtf8StringRef(address, this)
		this.allocatedReferences.add(ref)
		return ref
	}

	private alloc(size: number) {
		const ptr = this.wasmAlloc(size)

		return ptr
	}

	free(wasmReference: WasmRef) {
		if (wasmReference.isFreed) {
			return
		}

		this.wasmFree(wasmReference.address)

		this.allocatedReferences.delete(wasmReference)
		wasmReference.clearAddress()
	}

	freeAll() {
		for (const wasmReference of this.allocatedReferences) {
			this.free(wasmReference)
		}
	}

	detach<T extends WasmRef>(wasmReference: T) {
		this.allocatedReferences.delete(wasmReference)

		return wasmReference
	}
}

abstract class ValueRef<T extends number | string> {
	protected ptr: number
	private readonly manager: WasmMemoryManager

	protected get module() { return this.manager.wasmModule }

	constructor(ptr: number, manager: WasmMemoryManager) {
		this.ptr = ptr
		this.manager = manager
	}

	get value(): T {
		this.assertNotFreed()
		return this.getValue()
	}

	set value(newValue: T) {
		this.assertNotFreed()
		this.setValue(newValue)
	}

	abstract getValue(): T
	abstract setValue(newValue: T): void

	get address() {
		this.assertNotFreed()
		return this.ptr
	}

	clear() {
		this.assertNotFreed()

		if (typeof this.value == 'number') {
			this.value = 0 as any
		} else if (typeof this.value == 'string') {
			throw new Error('Unimplemented')
		}

		return this
	}

	free() {
		this.manager.free(this as any)
	}

	detach() {
		return this.manager.detach(this as any) as this
	}

	clearAddress() {
		this.ptr = 0
	}

	get isFreed() { return this.ptr == 0 }

	protected assertNotFreed() {
		if (this.isFreed) {
			throw new Error('Attempt to read a freed WASM value reference.')
		}
	}
}

export class Int8Ref extends ValueRef<number> {
	getValue() {
		return this.module.HEAP8[this.ptr >>> 0] as number
	}

	setValue(newValue: number) {
		this.module.HEAP8[this.ptr >>> 0] = newValue
	}
}

export class Uint8Ref extends ValueRef<number> {
	getValue() {
		return this.module.HEAPU8[this.ptr >>> 0] as number
	}

	setValue(newValue: number) {
		this.module.HEAPU8[this.ptr >>> 0] = newValue
	}
}

export class Int16Ref extends ValueRef<number> {
	getValue() {
		return this.module.HEAP16[this.ptr >>> 1] as number
	}

	setValue(newValue: number) {
		this.module.HEAP16[this.ptr >>> 1] = newValue
	}
}

export class Uint16Ref extends ValueRef<number> {
	getValue() {
		return this.module.HEAPU16[this.ptr >>> 1] as number
	}

	setValue(newValue: number) {
		this.module.HEAPU16[this.ptr >>> 1] = newValue
	}
}

export class Int32Ref extends ValueRef<number> {
	getValue() {
		return this.module.HEAP32[this.ptr >>> 2] as number
	}

	setValue(newValue: number) {
		this.module.HEAP32[this.ptr >>> 2] = newValue
	}
}

export class Uint32Ref extends ValueRef<number> {
	getValue() {
		return this.module.HEAPU32[this.ptr >>> 2] as number
	}

	setValue(newValue: number) {
		this.module.HEAPU32[this.ptr >>> 2] = newValue
	}
}

export class PointerRef extends Uint32Ref { }

export class Float32Ref extends ValueRef<number> {
	getValue() {
		return this.module.HEAPF32[this.ptr >>> 2] as number
	}

	setValue(newValue: number) {
		this.module.HEAPF32[this.ptr >>> 2] = newValue
	}
}

export class Float64Ref extends ValueRef<number> {
	getValue() {
		return this.module.HEAPF64[this.ptr >>> 3] as number
	}

	setValue(newValue: number) {
		this.module.HEAPF64[this.ptr >>> 3] = newValue
	}
}

export class NullTerminatedUtf8StringRef extends ValueRef<string> {
	getValue() {
		const ptr = this.ptr >>> 0

		const heapU8 = this.module.HEAPU8

		const endByteOffset = heapU8.subarray(ptr).indexOf(0)

		const strBytes = heapU8.subarray(ptr, ptr + endByteOffset)

		const str = decodeUtf8(strBytes)

		return str
	}

	setValue(newValue: string) {
		throw new Error('Unimplemented')
	}
}

abstract class TypedArrayRef<T extends TypedArray> {
	protected ptr: number
	readonly length: number
	private readonly manager: WasmMemoryManager

	get module() { return this.manager.wasmModule }

	constructor(ptr: number, length: number, manager: WasmMemoryManager) {
		this.ptr = ptr
		this.length = length
		this.manager = manager
	}

	get view() {
		this.assertNotFreed()
		return this.getView()
	}

	protected abstract getView(): T

	slice(start?: number, end?: number) {
		return this.view.slice(start, end)
	}

	get address() {
		this.assertNotFreed()
		return this.ptr
	}

	clear() {
		this.view.fill(0)
		return this
	}

	free() {
		this.manager.free(this)
	}

	clearAddress() {
		this.ptr = 0
	}

	detach() {
		return this.manager.detach(this)
	}

	get isFreed() { return this.ptr == 0 }

	protected assertNotFreed() {
		if (this.isFreed) {
			throw new Error('Attempt to read a freed WASM typed array reference.')
		}
	}
}

export class Int8ArrayRef extends TypedArrayRef<Int8Array> {
	getView() {
		const startIndex = this.ptr >>> 0
		return this.module.HEAP8.subarray(startIndex, startIndex + this.length) as Int8Array
	}
}

export class Uint8ArrayRef extends TypedArrayRef<Uint8Array> {
	getView() {
		const startIndex = this.ptr >>> 0
		return this.module.HEAPU8.subarray(startIndex, startIndex + this.length) as Uint8Array
	}

	readAsNullTerminatedUtf8String(): string {
		let strBytes = this.view

		const indexOfFirstZero = strBytes.indexOf(0)

		if (indexOfFirstZero >= 0) {
			strBytes = strBytes.subarray(0, indexOfFirstZero)
		}

		const str = decodeUtf8(strBytes)

		return str
	}
}

export class Int16ArrayRef extends TypedArrayRef<Int16Array> {
	getView() {
		const startIndex = this.ptr >>> 1
		return this.module.HEAP16.subarray(startIndex, startIndex + this.length) as Int16Array
	}
}

export class Uint16ArrayRef extends TypedArrayRef<Uint16Array> {
	getView() {
		const startIndex = this.ptr >>> 1
		return this.module.HEAPU16.subarray(startIndex, startIndex + this.length) as Uint16Array
	}
}

export class Int32ArrayRef extends TypedArrayRef<Int32Array> {
	getView() {
		const startIndex = this.ptr >>> 2
		return this.module.HEAP32.subarray(startIndex, startIndex + this.length) as Int32Array
	}
}

export class Uint32ArrayRef extends TypedArrayRef<Uint32Array> {
	getView() {
		const startIndex = this.ptr >>> 2
		return this.module.HEAPU32.subarray(startIndex, startIndex + this.length) as Uint32Array
	}
}

export class Float32ArrayRef extends TypedArrayRef<Float32Array> {
	getView() {
		const startIndex = this.ptr >>> 2
		return this.module.HEAPF32.subarray(startIndex, startIndex + this.length) as Float32Array
	}
}

export class Float64ArrayRef extends TypedArrayRef<Float64Array> {
	getView() {
		const startIndex = this.ptr >>> 3
		return this.module.HEAPF64.subarray(startIndex, startIndex + this.length) as Float64Array
	}
}
export type WasmRef = ValueRef<number> | ValueRef<string> | TypedArrayRef<TypedArray>

export interface WasmMemoryManagerOptions {
	wasmAlloc?: WasmAllocMethod
	wasmFree?: WasmFreeMethod
}

export type WasmAllocMethod = (size: number) => number
export type WasmFreeMethod = (address: number) => void
