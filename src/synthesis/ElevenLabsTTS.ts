import { GaxiosResponse, request } from 'gaxios'
import { SynthesisVoice, VoiceGender } from '../api/API.js'
import * as FFMpegTranscoder from '../codecs/FFMpegTranscoder.js'
import { Logger } from '../utilities/Logger.js'
import { logToStderr } from '../utilities/Utilities.js'
import { extendDeep } from '../utilities/ObjectUtilities.js'

const log = logToStderr

export async function synthesize(text: string, voiceId: string, modelId: string, options: ElevenlabsTTSOptions) {
	const logger = new Logger()
	logger.start('Request synthesis from ElevenLabs')

	options = extendDeep(defaultElevenlabsTTSOptions, options)

	let response: GaxiosResponse<any>

	try {
		response = await request<any>({
			url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,

			method: 'POST',

			headers: {
				'accept': 'audio/mpeg',
				'xi-api-key': options.apiKey,
			},

			data: {
				text,

				model_id: modelId,

				voice_setting: {
					stability: options.stability,
					similarity_boost: options.similarityBoost,
					style: options.style,
					use_speaker_boost: options.useSpeakerBoost
				}
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

export async function getVoiceList(apiKey: string) {
	const response = await request<any>({
		method: 'GET',

		url: 'https://api.elevenlabs.io/v1/voices',

		headers: {
			'accept': 'accept: application/json',
			'xi-api-key': apiKey
		},

		responseType: 'json'
	})

	const elevenlabsVoices: any[] = response.data.voices

	const voices: SynthesisVoice[] = elevenlabsVoices.map(elevenlabsVoice => {
		const modelId: string = elevenlabsVoice?.high_quality_base_model_ids?.[0] ?? 'eleven_monolingual_v1'
		const accent: string | undefined = elevenlabsVoice?.labels?.accent
		const gender: VoiceGender = elevenlabsVoice?.labels?.gender ?? 'unknown'

		const supportedLanguages: string[] = []

		if (accent) {
			if (accent.startsWith('american')) {
				supportedLanguages.push('en-US')
			} else if (accent.startsWith('british')) {
				supportedLanguages.push('en-GB')
			} else if (accent === 'irish') {
				supportedLanguages.push('en-IE')
			} else if (accent == 'australian') {
				supportedLanguages.push('en-AU')
			}
		}

		if (modelId.includes('multilingual')) {
			supportedLanguages.push('en', ...supporteMultilingualLanguages)
		} else {
			supportedLanguages.push('en')
		}

		return {
			name: elevenlabsVoice.name,
			languages: supportedLanguages,
			gender,

			elevenLabsVoiceId: elevenlabsVoice.voice_id,
			elevenLabsModelId: modelId
		}
	})

	return voices
}

export interface ElevenlabsTTSOptions {
	apiKey?: string
	stability?: number
	similarityBoost?: number
	style?: number
	useSpeakerBoost?: boolean
}

export const defaultElevenlabsTTSOptions = {
	apiKey: undefined,
	stability: 0.5,
	similarityBoost: 0.5,
	style: 0,
	useSpeakerBoost: true
}

export const supporteMultilingualLanguages = ['zh', 'ko', 'nl', 'tr', 'sv', 'id', 'tl', 'ja', 'uk', 'el', 'cs', 'fi', 'ro', 'ru', 'da', 'bg', 'ms', 'sk', 'hr', 'ar', 'ta', 'pl', 'de', 'es', 'fr', 'it', 'hi', 'pt']
