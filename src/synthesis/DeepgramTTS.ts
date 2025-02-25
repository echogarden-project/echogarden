import { GaxiosResponse, request } from 'gaxios'
import { SynthesisVoice } from '../api/API.js'
import * as FFMpegTranscoder from '../codecs/FFMpegTranscoder.js'
import { Logger } from '../utilities/Logger.js'
import { logToStderr } from '../utilities/Utilities.js'
import { extendDeep } from '../utilities/ObjectUtilities.js'

const log = logToStderr

export async function synthesize(text: string, modelId: string, options: DeepgramTTSOptions) {
	const logger = new Logger()
	logger.start('Request synthesis from Deepgram')

	options = extendDeep(defaultDeepgramTTSOptions, options)

	let response: GaxiosResponse<any>

	try {
		response = await request<any>({
			url: `https://api.deepgram.com/v1/speak`,

			params: {
				model: modelId,
				encoding: 'mp3',
				bit_rate: 48000,
			},

			method: 'POST',

			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Token ${options.apiKey}`,
			},

			data: {
				text,
			},

			responseType: 'arraybuffer'
		})
	} catch (e: any) {
		const response = e.response

		if (response) {
			logger.log(`Request failed with status code ${response.status}`)

			if (response.data) {
				logger.log(`Server responded with:`)
				logger.log(response.data)
			}
		}

		throw e
	}

	logger.start('Decode synthesized audio')
	const rawAudio = await FFMpegTranscoder.decodeToChannels(new Uint8Array(response.data))

	logger.end()

	return { rawAudio }
}

export async function getVoiceList() {
	return voiceList
}

export interface DeepgramTTSOptions {
	apiKey?: string
}

export const defaultDeepgramTTSOptions = {
	apiKey: undefined,
}

export const voiceList: SynthesisVoice[] = [
	{
		name: 'Asteria',
		deepgramModelId: 'aura-asteria-en',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'Luna',
		deepgramModelId: 'aura-luna-en',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'Stella',
		deepgramModelId: 'aura-stella-en',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'Athena',
		deepgramModelId: 'aura-athena-en',
		languages: ['en-GB', 'en'],
		gender: 'female',
	},
	{
		name: 'Hera',
		deepgramModelId: 'aura-hera-en',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'Orion',
		deepgramModelId: 'aura-orion-en',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'Arcas',
		deepgramModelId: 'aura-arcas-en',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'Perseus',
		deepgramModelId: 'aura-perseus-en',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'Angus',
		deepgramModelId: 'aura-angus-en',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'Orpheus',
		deepgramModelId: 'aura-orpheus-en',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'Helios',
		deepgramModelId: 'aura-helios-en',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'Zeus',
		deepgramModelId: 'aura-zeus-en',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
]
