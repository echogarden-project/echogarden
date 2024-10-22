export class WindowedList<T> {
	elements: T[] = []
	startOffset = 0

	constructor(public readonly maxWindowLength: number) {
	}

	add(value: T) {
		if (this.elements.length === this.maxWindowLength) {
			this.elements.shift()
			
			this.startOffset += 1
		}

		this.elements.push(value)
	}

	get(index: number) {
		if (index < this.startOffset) {
			throw new Error(`Index is smaller than to window start offset.`)
		}

		if (index >= this.endOffset) {
			throw new Error(`Index is beyond window end offset.`)
		}

		return this.elements[index - this.startOffset]
	}

	slice(startIndex: number, endIndex: number) {
		const result: T[] = []

		endIndex = Math.min(endIndex, this.endOffset)

		for (let i = startIndex; i < endIndex; i++) {
			result.push(this.get(i))
		}

		return result
	}

	get endOffset() {
		return this.startOffset + this.elements.length
	}
}
