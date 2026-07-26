import { SynthesisCallbacks, SynthesisVoice } from '../api/API.js'
import * as FFMpegTranscoder from '../codecs/FFMpegTranscoder.js'
import { Logger } from '../utilities/Logger.js'
import { logToStderr } from '../utilities/Utilities.js'
import { extendDeep } from '../utilities/ObjectUtilities.js'
import { EasierHttpRequestError, requestHttp } from 'easier-http-request'

const log = logToStderr

export async function synthesize(text: string, modelId: string, options: DeepgramTTSOptions, callbacks: SynthesisCallbacks) {
	const logger = new Logger(callbacks.logLevel)

	logger.start('Request synthesis from Deepgram')

	options = extendDeep(defaultDeepgramTTSOptions, options)

	let responseBody: ArrayBuffer

	try {
		const response = await requestHttp({
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

			body: {
				text,
			},

			abortSignal: callbacks?.abortSignal,
		})

		responseBody = await response.arrayBuffer()
	} catch (e: any) {
		if (e instanceof EasierHttpRequestError) {
			logger.log(`Request failed with status code ${e.statusCode}: ${e.statusText}.`)

			if (e.errorBody) {
				logger.log(`Server responded with:`)
				logger.log(e.errorBody)
			}
		}

		throw e
	}

	logger.start('Decode synthesized audio')
	const rawAudio = await FFMpegTranscoder.decodeToChannels(
		new Uint8Array(responseBody),
		undefined,
		undefined,
		{ abortSignal: callbacks.abortSignal, logLevel: 'warning' }
	)

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
