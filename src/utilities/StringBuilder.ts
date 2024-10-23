import { DynamicUint16Array, createDynamicUint16Array } from '../data-structures/DynamicTypedArray.js'
import { decodeUtf16 } from '../encodings/Utf16.js'

export class StringBuilder {
	private outputBuffer: DynamicUint16Array

	constructor(initialCapacity = 8) {
		this.outputBuffer = createDynamicUint16Array(initialCapacity)
	}

	appendCharCode(charCode: number) {
		this.outputBuffer.add(charCode)
	}

	appendCharCodes(...charCodes: number[]) {
		this.outputBuffer.addArray(charCodes)
	}

	appendCharCodeArray(charCodes: ArrayLike<number>) {
		this.outputBuffer.addArray(charCodes)
	}

	appendString(str: string) {
		const length = str.length

		for (let i = 0; i < length; i++) {
			this.appendCharCode(str.charCodeAt(i))
		}
	}

	appendCodePoint(codePoint: number) {
		if (codePoint <= 0xffff) {
			this.appendCharCode(codePoint)
		} else if (codePoint <= 0x10ffff) {
			this.appendCharCode(0xd800 + ((codePoint - 0x10000) >>> 10))
			this.appendCharCode(0xdc00 + ((codePoint - 0x10000) & 1023))
		} else {
			throw new Error(`appendCodePoint: A code point of ${codePoint} cannot be encoded in UTF-16`)
		}
	}

	toString() {
		return decodeUtf16(this.outputBuffer.toTypedArray())
	}
}
