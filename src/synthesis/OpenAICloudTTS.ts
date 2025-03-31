import { ensureRawAudio } from '../audio/AudioUtilities.js';
import { SynthesisVoice } from '../api/Synthesis.js';
import { Logger } from '../utilities/Logger.js';
import { extendDeep } from '../utilities/ObjectUtilities.js';

export async function synthesize(text: string, voice: string, speed: number, options: OpenAICloudTTSOptions) {
	const logger = new Logger()

	logger.start('Request synthesis from OpenAI Cloud API')

	options = extendDeep(defaultOpenAICloudTTSOptions, options)

	if (!options.apiKey) {
		throw new Error(`No API key given`)
	}

	const { default: OpenAI } = await import('openai')

	const openai = new OpenAI(options)

	const result = await openai.audio.speech.create({
		input: text,
		model: options.model!,
		voice: voice as any,
		instructions: options.instructions,
		response_format: 'opus',
		speed,
	}, {
		maxRetries: 10
	})

	const resultBuffer = await result.buffer()

	logger.start('Decode returned audio')
	const resultRawAudio = ensureRawAudio(resultBuffer)

	logger.end()

	return resultRawAudio
}

export interface OpenAICloudTTSOptions {
	apiKey?: string
	organization?: string
	baseURL?: string

	model?: 'tts-1' | 'tts-1-hd' | 'gpt-4o-mini-tts'

	instructions?: string

	timeout?: number
	maxRetries?: number
}

export const defaultOpenAICloudTTSOptions: OpenAICloudTTSOptions = {
	apiKey: undefined,
	organization: undefined,
	baseURL: undefined,

	model: 'tts-1',

	instructions: undefined,

	timeout: undefined,
	maxRetries: 10,
}

// Reference: https://platform.openai.com/docs/guides/text-to-speech#supported-languages
export const supportedLanguages = [
	'en',
	'af',
	'ar',
	'hy',
	'az',
	'be',
	'bs',
	'bg',
	'ca',
	'zh',
	'hr',
	'cs',
	'da',
	'nl',
	'en',
	'et',
	'fi',
	'fr',
	'gl',
	'de',
	'el',
	'he',
	'hi',
	'hu',
	'is',
	'id',
	'it',
	'ja',
	'kn',
	'kk',
	'ko',
	'lv',
	'lt',
	'mk',
	'ms',
	'mr',
	'mi',
	'ne',
	'no',
	'fa',
	'pl',
	'pt',
	'ro',
	'ru',
	'sr',
	'sk',
	'sl',
	'es',
	'sw',
	'sv',
	'tl',
	'ta',
	'th',
	'tr',
	'uk',
	'ur',
	'vi',
	'cy',
]

export const voiceList: SynthesisVoice[] = [
	{
		name: 'alloy',
		languages: ['en-US', ...supportedLanguages],
		gender: 'male',
	},
	{
		name: 'ash',
		languages: ['en-US', ...supportedLanguages],
		gender: 'male',
	},
	{
		name: 'ballad',
		languages: ['en-GB', ...supportedLanguages],
		gender: 'male',
	},
	{
		name: 'coral',
		languages: ['en-US', ...supportedLanguages],
		gender: 'female',
	},
	{
		name: 'echo',
		languages: ['en-US', ...supportedLanguages],
		gender: 'male',
	},
	{
		name: 'fable',
		languages: ['en-GB', ...supportedLanguages],
		gender: 'male',
	},
	{
		name: 'onyx',
		languages: ['en-US', ...supportedLanguages],
		gender: 'male',
	},
	{
		name: 'nova',
		languages: ['en-US', ...supportedLanguages],
		gender: 'female',
	},
	{
		name: 'sage',
		languages: ['en-US', ...supportedLanguages],
		gender: 'female',
	},
	{
		name: 'shimmer',
		languages: ['en-US', ...supportedLanguages],
		gender: 'female',
	},
	{
		name: 'verse',
		languages: ['en-US', ...supportedLanguages],
		gender: 'male',
	},
]
