export class Queue<T> {
	list: T[] = []

	constructor() {
	}

	enqueue(item: T) {
		this.list.push(item)
	}

	dequeue(): T | undefined {
		return this.list.shift()
	}

	get isEmpty() { return this.list.length == 0 }
	get isNonempty() { return !this.isEmpty }
}
