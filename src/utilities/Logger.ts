import { Timer } from "./Timer.js"
import { delay, logToStderr, roundToDigits, writeToStderr } from "./Utilities.js"

let currentActiveLogger: Logger | null = null

export class Logger {
	private timer = new Timer()
	active = false

	start(title: string) {
		this.startAsync(title, false)
	}

	async startAsync(title: string, wait = true) {
		if (currentActiveLogger != null && currentActiveLogger != this) {
			return
		}

		this.end()

		if (wait) {
			await delay(0)
		}

		writeToStderr(`${title}.. `)
		this.active = true
		currentActiveLogger = this
		this.timer.restart()
	}

	end() {
		if (this.active && currentActiveLogger == this) {
			const elapsedTime = this.timer.elapsedTime

			writeToStderr(`${roundToDigits(elapsedTime, 1)}ms\n`)
			currentActiveLogger = null
		}

		this.active = false
	}

	log(message: any) {
		if (currentActiveLogger == this || currentActiveLogger == null) {
			logToStderr(message)
		}
	}

	write(message: any) {
		if (currentActiveLogger == this || currentActiveLogger == null) {
			writeToStderr(message)
		}
	}

	logDuration(message: any, startTime: number) {
		const duration = Timer.currentTime - startTime

		this.log(`${message}: ${roundToDigits(duration, 1)}ms`)
	}

	getTimestamp() {
		return Timer.currentTime
	}
}
