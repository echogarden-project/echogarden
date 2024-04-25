export function getGlobalOption<K extends keyof GlobalOptions>(key: K): GlobalOptions[K] {
	if (!listGlobalOptions().includes(key)) {
		throw new Error(`Unknown global option key '${key}'`)
	}

	return globalOptions[key]
}

export function setGlobalOption<K extends keyof GlobalOptions>(key: K, value: GlobalOptions[K]) {
	if (!listGlobalOptions().includes(key)) {
		throw new Error(`Unknown global option key '${key}'`)
	}

	globalOptions[key] = value
}

export function listGlobalOptions() {
	return Object.keys(globalOptions)
}

export function logLevelToNumber(logLevel: LogLevel) {
	return logLevels.indexOf(logLevel)
}

export function getLogLevel() {
	return globalOptions.logLevel ?? 'info'
}

export function logLevelGreaterOrEqualTo(referenceLevel: LogLevel) {
	return !logLevelSmallerThan(referenceLevel)
}

export function logLevelSmallerThan(referenceLevel: LogLevel) {
	return logLevelToNumber(getLogLevel()) < logLevelToNumber(referenceLevel)
}

const logLevels = ['silent', 'output', 'error', 'warning', 'info', 'trace'] as const

export type LogLevel = typeof logLevels[number]

export interface GlobalOptions {
	ffmpegPath?: string
	soxPath?: string
	packageBaseURL?: string
	logLevel?: LogLevel
}

const globalOptions: GlobalOptions = {
	ffmpegPath: undefined,
	soxPath: undefined,
	packageBaseURL: 'https://huggingface.co/echogarden/echogarden-packages/resolve/main/',
	logLevel: 'info',
}
