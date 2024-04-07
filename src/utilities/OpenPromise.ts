export class OpenPromise<T = void>
{
	promise: Promise<T>
	resolve: (value: T) => void = () => { throw new Error('Open promise resolved before initialization') }
	reject: (reason?: any) => void = () => { throw new Error('Open promise rejected before initialization') }

	constructor() {
		this.promise = new Promise<T>((resolve, reject) => {
			this.resolve = resolve
			this.reject = reject
		})
	}
}
