import chalk, { ChalkInstance } from 'chalk'
import { Timer } from './Timer.js'
import { logToStderr, writeToStderr, yieldToEventLoop } from './Utilities.js'

export class Logger {
	private timer = new Timer()
	private started = false

	constructor(
		public readonly logLevel: LogLevel = 'warning',
		public readonly timingMinimumLogLevel: LogLevel = 'info') {
	}

	start(title: string, titleColor = chalk.cyanBright) {
		this.startAsync(title, false, titleColor)
	}

	async startAsync(title: string, yieldBeforeStart = true, titleColor = chalk.cyanBright) {
		this.end()

		if (yieldBeforeStart) {
			await yieldToEventLoop()
		}

		if (this.logLevelGreaterOrEqualTo(this.timingMinimumLogLevel)) {
			writeToStderr(`${titleColor(title)}.. `)
		}

		this.started = true
		this.timer.restart()
	}

	end() {
		if (!this.started) {
			return
		}

		this.started = false

		if (this.logLevelGreaterOrEqualTo(this.timingMinimumLogLevel)) {
			const elapsedTime = this.timer.elapsedTime

			writeToStderr(`${elapsedTime.toFixed(1)}ms\n`)
		}
	}

	logDuration(message: any, startTime: number, logLevel: LogLevel = 'info', titleColor?: ChalkInstance) {
		const duration = Timer.currentTime - startTime

		titleColor = titleColor ?? Logger.getDefaultTitleColorForLogLevel(logLevel)

		this.log(`${titleColor(message)}: ${duration.toFixed(1)}ms`)
	}

	logTitledMessage(title: string, content: any, logLevel: LogLevel = 'info', titleColor?: ChalkInstance) {
		titleColor = titleColor ?? Logger.getDefaultTitleColorForLogLevel(logLevel)

		this.log(`${titleColor(title)}: ${content}`, logLevel)
	}

	log(message: any, logLevel: LogLevel = 'info') {
		if (this.logLevelSmallerThan(logLevel)) {
			return
		}

		logToStderr(message)
	}

	write(message: any, logLevel: LogLevel = 'info') {
		if (this.logLevelSmallerThan(logLevel)) {
			return
		}

		writeToStderr(message)
	}

	getTimestamp() {
		return Timer.currentTime
	}

	logLevelGreaterOrEqualTo(comparedLogLevel: LogLevel) {
		return logLevelGreaterOrEqualTo(this.logLevel, comparedLogLevel)
	}

	logLevelSmallerThan(comparedLogLevel: LogLevel) {
		return logLevelSmallerThan(this.logLevel, comparedLogLevel)
	}

	static getDefaultTitleColorForLogLevel(logLevel: LogLevel): ChalkInstance {
		if (logLevel === 'error') {
			return chalk.redBright
		} else if (logLevel === 'warning') {
			return chalk.yellow
		} else {
			return chalk.cyanBright
		}
	}
}

export function logLevelGreaterOrEqualTo(logLevel: LogLevel, comparedLogLevel: LogLevel) {
	return !logLevelSmallerThan(logLevel, comparedLogLevel)
}

export function logLevelSmallerThan(logLevel: LogLevel, comparedLogLevel: LogLevel) {
	return logLevelToNumber(logLevel) < logLevelToNumber(comparedLogLevel)
}

export function logLevelToNumber(logLevel: LogLevel) {
	return logLevels.indexOf(logLevel)
}

export const logLevels = ['silent', 'output', 'error', 'warning', 'info', 'trace'] as const

export type LogLevel = typeof logLevels[number]
