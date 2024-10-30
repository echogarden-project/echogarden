import { type AudioPlayerID } from "../audio/AudioPlayer.js"

export interface CLIOptions {
	play?: boolean
	player?: AudioPlayerID
	overwrite?: boolean
	debug?: boolean
	config?: string
}

export const CLIOptionsKeys: (keyof CLIOptions)[] = ['play', 'player', 'overwrite', 'debug', 'config']
