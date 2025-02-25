import { GaxiosResponse, request } from 'gaxios'
import { SynthesisVoice, VoiceGender } from '../api/API.js'
import * as FFMpegTranscoder from '../codecs/FFMpegTranscoder.js'
import { Logger } from '../utilities/Logger.js'
import { logToStderr } from '../utilities/Utilities.js'
import { extendDeep } from '../utilities/ObjectUtilities.js'
import { decodeBase64 } from '../encodings/Base64.js'
import { isWordOrSymbolWord, splitToWords } from '../nlp/Segmentation.js'
import { Timeline } from '../utilities/Timeline.js'

const log = logToStderr

export async function synthesize(text: string, voiceId: string, language: string, options: ElevenLabsTTSOptions) {
	const logger = new Logger()
	logger.start('Request synthesis from ElevenLabs')

	options = extendDeep(defaultElevenLabsTTSOptions, options)

	let response: GaxiosResponse<any>

	try {
		response = await request<any>({
			url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,

			method: 'POST',

			headers: {
				'accept': 'audio/mpeg',
				'xi-api-key': options.apiKey,
			},

			params: {
				output_format: 'mp3_44100_64',
			},

			data: {
				text,

				model_id: options.modelId,

				voice_setting: {
					stability: options.stability,
					similarity_boost: options.similarityBoost,
					style: options.style,
					use_speaker_boost: options.useSpeakerBoost,
				},

				seed: options.seed
			},

			responseType: 'json'
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
	const audioData = decodeBase64(response.data.audio_base64)
	const rawAudio = await FFMpegTranscoder.decodeToChannels(audioData)

	let timeline: Timeline | undefined

	const characters: string[] = response.data.alignment?.characters
	const characterStartTimes: number[] = response.data.alignment?.character_start_times_seconds
	const characterEndTimes: number[] = response.data.alignment?.character_end_times_seconds

	if (characters && characterStartTimes && characterEndTimes) {
		logger.start('Create timeline from returned character timings')

		const referenceText = characters.join('')
		const words = (await splitToWords(referenceText, language)).filter(w => isWordOrSymbolWord(w))

		timeline = []

		let offset = 0

		for (const word of words) {
			const wordStartIndex = referenceText.indexOf(word, offset)
			const wordEndIndex = wordStartIndex + word.length

			timeline.push({
				type: 'word',
				text: word,
				startTime: characterStartTimes[wordStartIndex],
				endTime: characterEndTimes[wordEndIndex] ?? characterEndTimes[wordEndIndex - 1]
			})

			offset = wordEndIndex
		}
	}

	logger.end()

	return { rawAudio, timeline }
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

	const elevenLabsVoices: any[] = response.data.voices

	const voices: SynthesisVoice[] = elevenLabsVoices.map(elevenLabsVoice => {
		const gender: VoiceGender = elevenLabsVoice?.labels?.gender ?? 'unknown'

		const supportedLanguages: string[] = []

		let accent: string | undefined = elevenLabsVoice?.labels?.accent
		accent = accent?.toLowerCase() ?? ''

		if (accent.startsWith('american')) {
			supportedLanguages.push('en-US')
		} else if (accent.startsWith('british')) {
			supportedLanguages.push('en-GB')
		} else if (accent === 'irish') {
			supportedLanguages.push('en-IE')
		} else if (accent == 'australian') {
			supportedLanguages.push('en-AU')
		} else {
			supportedLanguages.push('en')
		}

		supportedLanguages.push(...supportedLanguagesInMultilingualModels)

		return {
			name: elevenLabsVoice.name,
			languages: supportedLanguages,
			gender,

			elevenLabsVoiceId: elevenLabsVoice.voice_id,
		}
	})

	return voices
}

export interface ElevenLabsTTSOptions {
	apiKey?: string
	modelId?: string

	stability?: number
	similarityBoost?: number
	style?: number
	useSpeakerBoost?: boolean

	seed?: number
}

export const defaultElevenLabsTTSOptions = {
	apiKey: undefined,
	modelId: 'eleven_multilingual_v2',

	stability: 0.5,
	similarityBoost: 0.5,
	style: 0,
	useSpeakerBoost: true,

	seed: undefined,
}

export const supportedLanguagesInMultilingualModels = [
	'ja',
	'zh',
	'de',
	'hi',
	'fr',
	'ko',
	'pt',
	'it',
	'es',
	'id',
	'nl',
	'tr',
	'fil',
	'pl',
	'sv',
	'bg',
	'ro',
	'ar',
	'cs',
	'el',
	'fi',
	'hr',
	'ms',
	'sk',
	'da',
	'ta',
	'uk',
	'ru',
	'hu',
	'no',
	'vi',
]
