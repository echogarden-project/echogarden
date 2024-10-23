import { write, open, close } from "./FileSystem.js"

export class FileWriter {
	private fileHandle?: number
	private disposed = false
	private writeOffset = 0

	constructor(public readonly filePath: string) {
	}

	async write(chunk: Uint8Array) {
		if (this.isDisposed) {
			throw new Error(`FileWriter has been disposed`)
		}

		await this.openIfNeeded()

		let chunkReadOffset = 0

		while (chunkReadOffset < chunk.length) {
			let bytesWritten: number

			try {
				({ bytesWritten } = await write(this.fileHandle!, chunk, chunkReadOffset, undefined, this.writeOffset))
			} catch (e) {
				await this.dispose()

				throw e
			}

			chunkReadOffset += bytesWritten
			this.writeOffset += bytesWritten
		}
	}

	private async openIfNeeded() {
		if (this.isDisposed) {
			throw new Error(`FileWriter has been disposed`)
		}

		if (this.isOpened) {
			return
		}

		this.fileHandle = await open(this.filePath, 'w')
	}

	async dispose() {
		if (this.isDisposed) {
			return
		}

		if (this.isOpened) {
			try {
				await close(this.fileHandle!)
			} catch (e) {
			}
		}

		this.disposed = true
		this.writeOffset = 0
		this.fileHandle = undefined
	}

	get isOpened() {
		return this.fileHandle !== undefined
	}

	get isDisposed() {
		return this.disposed
	}
}
