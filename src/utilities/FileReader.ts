import { open, close, read } from "./FileSystem.js"

export class FileReader {
	private fileHandle?: number
	private finished = false
	private disposed = false
	private readOffset = 0

	constructor(public readonly filePath: string) {
	}

	async readChunk(buffer: Uint8Array): Promise<Uint8Array> {
		if (this.isDisposed) {
			throw new Error(`FileReader has been disposed`)
		}

		await this.openIfNeeded()

		let bufferWriteOffset = 0

		while (bufferWriteOffset < buffer.length) {
			const remainingSizeInBuffer = buffer.length - bufferWriteOffset

			let bytesRead: number

			try {
				({ bytesRead } = await read(this.fileHandle!, buffer, bufferWriteOffset, remainingSizeInBuffer, this.readOffset))
			} catch (e) {
				await this.dispose()

				throw e
			}

			if (bytesRead === 0) {
				this.finished = true

				await this.dispose()

				break
			}

			bufferWriteOffset += bytesRead
			this.readOffset += bytesRead
		}

		return buffer.subarray(0, bufferWriteOffset)
	}

	private async openIfNeeded() {
		if (this.isDisposed) {
			throw new Error(`FileWriter has been disposed`)
		}

		if (this.isOpened) {
			return
		}

		this.fileHandle = await open(this.filePath, 'r')
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
		this.readOffset = 0
		this.fileHandle = undefined
	}

	get isOpened() {
		return this.fileHandle !== undefined
	}

	get isDisposed() {
		return this.disposed
	}

	get isFinished() {
		return this.finished
	}
}
