export function extendDeep(base: any, extension: any): any {
	const baseClone = deepClone(base)

	if (extension === undefined) {
		return baseClone
	}

	const extensionClone = deepClone(extension)

	if (!isPlainObject(base) || !isPlainObject(extension)) {
		return extensionClone
	}

	for (const propName in extensionClone) {
		if (!extensionClone.hasOwnProperty(propName)) {
			continue
		}

		baseClone[propName] = extendDeep(baseClone[propName], extensionClone[propName])
	}

	return baseClone
}

export function shallowClone<T>(val: T): T {
	return clone(val, false, new Set())
}

export function deepClone<T>(val: T): T {
	return clone(val, true, new Set())
}

function clone<T>(val: T, deep = true, seenObjects: Set<any>): T {
	if (val === undefined || val === null || typeof val !== 'object') {
		return val
	}

	const obj = <any>val
	const prototypeIdentifier = toString.call(obj)

	switch (prototypeIdentifier) {
		case '[object Array]': {
			if (seenObjects.has(obj)) {
				throw new Error('deepClone: encountered a cyclic object')
			}

			seenObjects.add(obj)

			const clonedArray = new Array(obj.length)

			for (let i = 0; i < obj.length; i++) {
				if (deep) {
					clonedArray[i] = clone(obj[i], true, seenObjects)
				} else {
					clonedArray[i] = obj[i]
				}
			}

			seenObjects.delete(obj)

			return clonedArray as any
		}

		case '[object ArrayBuffer]': {
			const clonedArray = new Uint8Array(obj.byteLength)
			clonedArray.set(new Uint8Array(obj))

			return clonedArray.buffer as any
		}

		case '[object Int8Array]': {
			const clonedArray = new Int8Array(obj.length)
			clonedArray.set(obj)

			return clonedArray as any
		}

		case '[object Uint8Array]': {
			const clonedArray = new Uint8Array(obj.length)
			clonedArray.set(obj)

			return clonedArray as any
		}

		case '[object Uint8ClampedArray]': {
			const clonedArray = new Uint8ClampedArray(obj.length)
			clonedArray.set(obj)

			return clonedArray as any
		}

		case '[object Int16Array]': {
			const clonedArray = new Int16Array(obj.length)
			clonedArray.set(obj)

			return clonedArray as any
		}

		case '[object Uint16Array]': {
			const clonedArray = new Uint16Array(obj.length)
			clonedArray.set(obj)

			return clonedArray as any
		}

		case '[object Int32Array]': {
			const clonedArray = new Int32Array(obj.length)
			clonedArray.set(obj)

			return clonedArray as any
		}

		case '[object Uint32Array]': {
			const clonedArray = new Uint32Array(obj.length)
			clonedArray.set(obj)

			return clonedArray as any
		}

		case '[object Float32Array]': {
			const clonedArray = new Float32Array(obj.length)
			clonedArray.set(obj)

			return clonedArray as any
		}

		case '[object Float64Array]': {
			const clonedArray = new Float64Array(obj.length)
			clonedArray.set(obj)

			return clonedArray as any
		}

		case '[object BigInt64Array]': {
			const clonedArray = new BigInt64Array(obj.length)
			clonedArray.set(obj)

			return clonedArray as any
		}

		case '[object BigUint64Array]': {
			const clonedArray = new BigUint64Array(obj.length)
			clonedArray.set(obj)

			return clonedArray as any
		}

		case '[object Date]': {
			return new Date(obj.valueOf()) as any
		}

		case '[object RegExp]': {
			const clonedRegExp = new RegExp(obj.source, obj.flags)
			clonedRegExp.lastIndex = obj.lastIndex

			return clonedRegExp as any
		}

		case '[object Function]': {
			return obj
		}

		case '[object Object]': {
			if (seenObjects.has(obj)) {
				throw new Error('deepClone: encountered a cyclic object.')
			}

			seenObjects.add(obj)

			const clonedObj: any = {}

			for (const propName in obj) {
				if (!obj.hasOwnProperty(propName)) {
					continue
				}

				if (deep) {
					clonedObj[propName] = clone(obj[propName], true, seenObjects)
				} else {
					clonedObj[propName] = obj[propName]
				}
			}

			seenObjects.delete(obj)

			return clonedObj
		}

		default: {
			throw new Error(`Cloning of type ${prototypeIdentifier} is not supported.`)
		}
	}
}

export function isPlainObject(val: any) {
	return val != null && typeof val === 'object' && toString.call(val) === '[object Object]'
}
