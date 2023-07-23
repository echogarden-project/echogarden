export const appName = "echogarden"

export interface EngineMetadata {
	id: string
	name: string
	description: string
	type: 'local' | 'server' | 'cloud'
}
