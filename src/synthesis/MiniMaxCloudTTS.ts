import { GaxiosResponse, request } from 'gaxios'
import { SynthesisVoice } from '../api/Synthesis.js'
import * as FFMpegTranscoder from '../codecs/FFMpegTranscoder.js'
import { Logger } from '../utilities/Logger.js'
import { extendDeep } from '../utilities/ObjectUtilities.js'

export async function synthesize(text: string, voiceId: string, speed: number, options: MiniMaxCloudTTSOptions) {
	const logger = new Logger()
	logger.start('Request synthesis from MiniMax Cloud API')

	options = extendDeep(defaultMiniMaxCloudTTSOptions, options)

	const apiKey = options.apiKey || process.env['MINIMAX_API_KEY']

	if (!apiKey) {
		throw new Error(`No MiniMax API key given. Set the apiKey option or the MINIMAX_API_KEY environment variable.`)
	}

	// Clamp speed: MiniMax accepts (0.5, 2.0]
	const clampedSpeed = Math.max(0.5, Math.min(2.0, speed))

	let response: GaxiosResponse<any>

	try {
		response = await request<any>({
			url: `${options.baseURL}/v1/t2a_v2`,

			method: 'POST',

			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`,
			},

			data: {
				model: options.model,
				text,
				voice_setting: {
					voice_id: voiceId,
					speed: clampedSpeed,
					vol: 1.0,
					pitch: 0,
				},
				audio_setting: {
					format: 'mp3',
				},
			},

			responseType: 'json',
		})
	} catch (e: any) {
		const resp = e.response

		if (resp) {
			logger.log(`Request failed with status code ${resp.status}`)

			if (resp.data) {
				logger.log(`Server responded with:`)
				logger.log(JSON.stringify(resp.data))
			}
		}

		throw e
	}

	const responseData = response.data

	if (!responseData?.data?.audio) {
		throw new Error(`MiniMax TTS API returned unexpected response: ${JSON.stringify(responseData)}`)
	}

	const hexAudio: string = responseData.data.audio
	const audioBuffer = Buffer.from(hexAudio, 'hex')

	logger.start('Decode synthesized audio')
	const rawAudio = await FFMpegTranscoder.decodeToChannels(new Uint8Array(audioBuffer))

	logger.end()

	return { rawAudio }
}

export interface MiniMaxCloudTTSOptions {
	apiKey?: string
	baseURL?: string
	model?: 'speech-2.8-hd' | 'speech-2.8-turbo'
}

export const defaultMiniMaxCloudTTSOptions: MiniMaxCloudTTSOptions = {
	apiKey: undefined,
	baseURL: 'https://api.minimax.io',
	model: 'speech-2.8-hd',
}

// Verified English voice IDs from MiniMax TTS API
export const voiceList: SynthesisVoice[] = [
	{
		name: 'English_Graceful_Lady',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'English_Insightful_Speaker',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'English_radiant_girl',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'English_Persuasive_Man',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'English_Lucky_Robot',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'Wise_Woman',
		languages: ['en', 'zh'],
		gender: 'female',
	},
	{
		name: 'cute_boy',
		languages: ['en', 'zh'],
		gender: 'male',
	},
	{
		name: 'lovely_girl',
		languages: ['en', 'zh'],
		gender: 'female',
	},
	{
		name: 'Friendly_Person',
		languages: ['en', 'zh'],
		gender: 'unknown',
	},
	{
		name: 'Inspirational_girl',
		languages: ['en', 'zh'],
		gender: 'female',
	},
	{
		name: 'Deep_Voice_Man',
		languages: ['en', 'zh'],
		gender: 'male',
	},
	{
		name: 'sweet_girl',
		languages: ['en', 'zh'],
		gender: 'female',
	},
]
