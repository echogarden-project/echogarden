export class DynamicUint8Array {
	data = new Uint8Array(4)
	length = 0

	add(element: number) {
		this.ensureCapacity(this.length + 1)

		this.data[this.length] = element
		this.length += 1
	}

	addMany(...elements: number[]) {
		this.ensureCapacity(this.length + elements.length)

		for (const element of elements) {
			this.data[this.length] = element
			this.length += 1
		}
	}

	ensureCapacity(requiredCapacity: number) {
		if (requiredCapacity > this.data.length) {
			const newCapacity = requiredCapacity * 2

			const newData = new Uint8Array(newCapacity)
			newData.set(this.toUint8Array())

			this.data = newData
		}
	}

	toUint8Array() {
		return this.data.subarray(0, this.length)
	}

	clear() {
		this.length = 0
	}
}
