import { LogLevel } from '../utilities/Logger.js'

export const appName = 'echogarden'

export interface EngineMetadata {
	id: string
	name: string
	description: string
	type: 'local' | 'server' | 'cloud'
}

export interface PlainTextOptions {
	paragraphBreaks?: ParagraphBreakType
	whitespace?: WhitespaceProcessing
}

export type ParagraphBreakType = 'single' | 'double'
export type WhitespaceProcessing = 'preserve' | 'removeLineBreaks' | 'collapse'

export interface OperationOptions {
}

export interface OperationCallbacks {
	abortSignal?: AbortSignal
	logLevel?: LogLevel
}

