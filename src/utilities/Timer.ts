import { logToStderr, roundToDigits } from './Utilities.js'

export class Timer {
	startTime = 0

	constructor() {
		this.restart()
	}

	restart() {
		this.startTime = Timer.currentTime
	}

	get elapsedTime(): number {
		// Elapsed time (milliseconds)
		return Timer.currentTime - this.startTime
	}

	get elapsedTimeSeconds(): number {
		// Elapsed time (seconds)
		return this.elapsedTime / 1000
	}

	getElapsedTimeAndRestart(): number {
		const elapsedTime = this.elapsedTime
		this.restart()

		return elapsedTime
	}

	logAndRestart(title: string, timePrecision = 3): number {
		const elapsedTime = this.elapsedTime

		//
		const message = `${title}: ${roundToDigits(elapsedTime, timePrecision)}ms`

		logToStderr(message)
		//

		this.restart()

		return elapsedTime
	}

	static get currentTime(): number {
		if (!this.getTimestamp) {
			this.createTimestampFunction()
		}

		return this.getTimestamp()
	}

	static get microsecondTimestamp(): number {
		return Math.floor(Timer.currentTime * 1000)
	}

	private static createTimestampFunction() {
		if (typeof process === 'object' && typeof process.hrtime === 'function') {
			let baseTimestamp = 0

			this.getTimestamp = () => {
				const nodeTimeNanoSeconds = process.hrtime.bigint()
				const nodeTimeMilliseconds = Number(nodeTimeNanoSeconds) / 1_000_000

				return baseTimestamp + nodeTimeMilliseconds
			}

			baseTimestamp = Date.now() - this.getTimestamp()
		} else if (typeof performance === 'object' && performance.now) {
			const baseTimestamp = Date.now() - performance.now()

			this.getTimestamp = () => baseTimestamp + performance.now()
		} else {
			this.getTimestamp = () => Date.now()
		}
	}

	private static getTimestamp: () => number
}
