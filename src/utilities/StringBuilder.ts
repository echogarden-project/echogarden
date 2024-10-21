export class StringBuilder {
	private outputBuffer: Uint16Array
	private outputPosition = 0
	private outputString = ""

	constructor(private outputBufferCapacity = 256) {
		this.outputBuffer = new Uint16Array(this.outputBufferCapacity)
	}

	appendCharCode(charCode: number) {
		this.outputBuffer[this.outputPosition++] = charCode

		if (this.outputPosition === this.outputBufferCapacity) {
			this.flushBufferToOutputString()
		}
	}

	appendCharCodes(...charCodes: number[]) {
		for (let i = 0, length = charCodes.length; i < length; i++) {
			this.appendCharCode(charCodes[i])
		}
	}

	appendString(str: string) {
		for (let i = 0, length = str.length; i < length; i++) {
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

	getOutputString(): string {
		this.flushBufferToOutputString()

		return this.outputString
	}

	private flushBufferToOutputString() {
		if (this.outputPosition === 0) {
			return
		}

		const charCodes = this.outputBuffer.subarray(0, this.outputPosition)

		this.outputString += String.fromCharCode(...charCodes)

		this.outputPosition = 0
	}
}
