export interface CLIOptions {
	play?: boolean
	overwrite?: boolean
	debug?: boolean
	config?: string
}

export const CLIOptionsKeys: (keyof CLIOptions)[] = ['play', 'overwrite', 'debug', 'config']
