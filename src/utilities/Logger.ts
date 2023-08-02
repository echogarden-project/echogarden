import chalk from "chalk"
import { Timer } from "./Timer.js"
import { logToStderr, writeToStderr, yieldToEventLoop } from "./Utilities.js"

let currentActiveLogger: Logger | null = null

export class Logger {
	private timer = new Timer()
	active = false

	start(title: string, titleColor = chalk.cyanBright) {
		this.startAsync(title, false, titleColor)
	}

	async startAsync(title: string, yieldBeforeStart = true, titleColor = chalk.cyanBright) {
		if (currentActiveLogger != null && currentActiveLogger != this) {
			return
		}

		this.end()

		if (yieldBeforeStart) {
			await yieldToEventLoop()
		}

		writeToStderr(`${titleColor(title)}.. `)
		this.active = true
		currentActiveLogger = this
		this.timer.restart()
	}

	end() {
		if (this.active && currentActiveLogger == this) {
			const elapsedTime = this.timer.elapsedTime

			writeToStderr(`${elapsedTime.toFixed(1)}ms\n`)
			currentActiveLogger = null
		}

		this.active = false
	}

	logDuration(message: any, startTime: number, titleColor = chalk.cyanBright) {
		const duration = Timer.currentTime - startTime

		this.log(`${titleColor(message)}: ${duration.toFixed(1)}ms`)
	}

	logTitledMessage(title: string, content: string, titleColor = chalk.cyanBright) {
		this.log(`${titleColor(title)}: ${content}`)
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

	getTimestamp() {
		return Timer.currentTime
	}
}

export function resetActiveLogger() {
	currentActiveLogger = null
}
