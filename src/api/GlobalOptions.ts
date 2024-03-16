export function getGlobalOption<K extends keyof GlobalOptions>(key: K): GlobalOptions[K] {
	if (!Object.keys(globalOptions).includes(key)) {
		throw new Error(`Unknown global option key '${key}'`)
	}

	return globalOptions[key]
}

export function setGlobalOption<K extends keyof GlobalOptions>(key: K, value: GlobalOptions[K]) {
	if (!Object.keys(globalOptions).includes(key)) {
		throw new Error(`Unknown global option key '${key}'`)
	}

	globalOptions[key] = value as any
}

export interface GlobalOptions {
	ffmpegPath?: string
	soxPath?: string
}

const globalOptions = {
	ffmpegPath: undefined,
	soxPath: undefined
}
