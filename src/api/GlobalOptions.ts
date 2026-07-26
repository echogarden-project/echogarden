import { LogLevel, logLevelGreaterOrEqualTo } from "../utilities/Logger.js"

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

export function getGlobalLogLevel() {
	return getGlobalOption('logLevel') ?? 'info'
}

export interface GlobalOptions {
	ffmpegPath?: string
	packageBaseURL?: string
	logLevel?: LogLevel
}

const globalOptions: GlobalOptions = {
	ffmpegPath: undefined,
	packageBaseURL: 'https://huggingface.co/echogarden/echogarden-packages/resolve/main/',
	logLevel: 'info',
}
