import { logToStderr } from './Utilities.js'

export class Timer {
	private readonly logger: TimerLogger

	private startTime = 0

	constructor(logger?: TimerLogger) {
		if (logger) {
			this.logger = logger
		} else {
			this.logger = logToStderr
		}

		this.restart()
	}

	// Resets the timer to the current time.
	restart(): void {
		this.startTime = Timer.currentTime
	}

	// Elapsed time in milliseconds (monotonic where supported).
	get elapsedTime(): number {
		return Timer.currentTime - this.startTime
	}

	// Elapsed time in seconds.
	get elapsedTimeSeconds(): number {
		return this.elapsedTime / 1000
	}

	// Returns elapsed ms and restarts the timer.
	getElapsedTimeAndRestart(): number {
		const elapsed = this.elapsedTime
		this.restart()

		return elapsed
	}

	// Logs elapsed time (in ms) and restarts the timer.
	logAndRestart(title: string, timePrecision = 3): number {
		const elapsedMs = this.elapsedTime
		this.logger(`${title}: ${roundToDigits(elapsedMs, timePrecision)}ms`)
		this.restart()

		return elapsedMs
	}

	// Current high-resolution timestamp in milliseconds since Unix epoch.
	static get currentTime(): number {
		return this.timestampFunc()
	}

	// Current timestamp in microseconds (integer).
	static get microsecondTimestamp(): number {
		return Math.floor(Timer.currentTime * 1000)
	}

	// Clock setup
	private static timestampFunc: () => number = Timer.createTimestampFunction()

	private static createTimestampFunction(): () => number {
		const g = globalThis as any

		// 1. Modern standard: performance.now() (Browsers & Node 16+)
		if (typeof g.performance === 'object' && typeof g.performance.now === 'function') {
			const timeOrigin =
				g.performance.timeOrigin ?? (Date.now() - g.performance.now())

			return () => timeOrigin + g.performance.now()
		}

		// 2. Node.js high resolution timer (BigInt variant, Node 10.4+)
		if (typeof g.process === 'object' && typeof g.process.hrtime === 'function') {
			const startNs = g.process.hrtime.bigint()

			const epochBaseMs = Date.now() - (Number(startNs) / 1e6)

			return () =>
				epochBaseMs + Number(g.process.hrtime.bigint()) / 1e6
		}

		// 3. Last-resort fallback (non-monotonic)
		if (typeof Date.now === 'function') {
			return () => Date.now()
		}

		return () => new Date().getTime()
	}
}

export function roundToDigits(value: number, digits: number): number {
	const factor = 10 ** digits

	return Math.round(value * factor) / factor
}

type TimerLogger = (msg: string) => void
