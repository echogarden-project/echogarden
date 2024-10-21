import { Readable } from 'stream'
import { EventEmitter } from 'events'
import { ReadStream as FsReadStream } from 'fs'

export function createVirtualFileReadStreamForBuffer(buffer: Uint8Array, path?: string) {
	const bufferReadStream = new VirtualFileReadStream(buffer, path)

	const proxyStream = new Proxy<FsReadStream>(bufferReadStream, {
		get(target, prop) {
			if (prop === Symbol.toStringTag) {
				return 'ReadStream'
			}

			return (target as any)[prop]
		},

		getPrototypeOf() {
			return FsReadStream.prototype
		}
	})

	return proxyStream
}

export class VirtualFileReadStream extends Readable {
	private readonly buffer: Uint8Array

	position: number
	bytesRead: number
	readonly path: string
	pending: boolean
	readonly emitter: EventEmitter

	constructor(buffer: Uint8Array, virtualPath?: string) {
		super({ autoDestroy: false })

		this.buffer = buffer

		this.position = 0
		this.bytesRead = 0
		this.path = virtualPath || ''
		this.pending = true
		this.emitter = new EventEmitter()

		this.emitter.emit('open', 0)

		this.pending = false
		this.emitter.emit('ready')
	}

	_read(size: number): void {
		if (this.position >= this.buffer.length) {
			this.push(null)

			this.emitter.emit('end')
			this.emitter.emit('finish')
			this.emitter.emit('close')

			return
		}

		const chunkSize = Math.min(size, this.buffer.length - this.position)

		const chunk = this.buffer.subarray(this.position, this.position + chunkSize)

		this.position += chunkSize
		this.bytesRead = this.position

		this.push(chunk)
	}

	close(callback?: (err?: NodeJS.ErrnoException | null) => void): void {
		this.emitter.emit('close')

		if (callback) {
			callback(null)
		}
	}

	addListener(event: string | symbol, listener: (...args: any[]) => void): this {
		this.emitter.addListener(event, listener)

		return this
	}

	on(event: string | symbol, listener: (...args: any[]) => void): this {
		this.emitter.on(event, listener)

		return this
	}

	once(event: string | symbol, listener: (...args: any[]) => void): this {
		this.emitter.once(event, listener)

		return this
	}

	prependListener(event: string | symbol, listener: (...args: any[]) => void): this {
		this.emitter.prependListener(event, listener)

		return this
	}

	prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): this {
		this.emitter.prependOnceListener(event, listener)

		return this
	}
}
