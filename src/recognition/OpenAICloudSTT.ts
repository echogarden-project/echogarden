import { RawAudio } from '../audio/AudioUtilities.js';
import * as FFMpegTranscoder from '../codecs/FFMpegTranscoder.js'
import { Logger } from '../utilities/Logger.js';
import { extendDeep } from '../utilities/ObjectUtilities.js';
import { Timeline, TimelineEntry } from '../utilities/Timeline.js';

export async function recognize(rawAudio: RawAudio, languageCode: string, options: OpenAICloudSTTOptions, task: Task = 'transcribe') {
	const logger = new Logger()

	logger.start('Load OpenAI module')

	options = extendDeep(defaultOpenAICloudSTTOptions, options)

	const { default: OpenAI } = await import('openai')
	const openai = new OpenAI(options)

	logger.start('Encode audio to send')
	const ffmpegOptions = FFMpegTranscoder.getDefaultFFMpegOptionsForSpeech('mp3')
	const encodedAudio = await FFMpegTranscoder.encodeFromChannels(rawAudio, ffmpegOptions)
	const audioAsWaveBlob = new FileLikeBlob([encodedAudio], 'audio', Date.now(), { type: 'audio/mpeg' })

	logger.start('Request recognition from OpenAI Cloud API')

	let response: VerboseResponse

	if (task =='transcribe') {
		response = await openai.audio.transcriptions.create({
			file: audioAsWaveBlob,
			model: options.model!,
			language: languageCode,
			prompt: options.prompt,
			response_format: 'verbose_json',
			temperature: options.temperature,
			timestamp_granularities: ['word', 'segment']
		}) as VerboseResponse
	} else if (task == 'translate') {
		response = await openai.audio.translations.create({
			file: audioAsWaveBlob,
			model: options.model!,
			prompt: options.prompt,
			response_format: 'verbose_json',
			temperature: options.temperature,
		}) as VerboseResponse
	} else {
		throw new Error(`Invalid task`)
	}

	const transcript = response.text

	let timeline: Timeline

	if (response.words) {
		timeline = response.words.map<TimelineEntry>(entry => ({
			type: 'word',
			text: entry.word,
			startTime: entry.start,
			endTime: entry.end
		}))
	} else {
		timeline = response.segments.map<TimelineEntry>(entry => ({
			type: 'segment',
			text: entry.text,
			startTime: entry.start,
			endTime: entry.end
		}))
	}

	logger.end()

	return { transcript, timeline }
}

class FileLikeBlob extends Blob {
	constructor(
		public readonly parts: BlobPart[],
		public readonly name: string,
		public readonly lastModified: number,
		options: BlobPropertyBag,
	) {
		super(parts, options)
	}
}

interface VerboseResponse {
	task: string
	language: string
	duration: number

	text: string

	segments: {
		text: string

		start: number
		end: number

		id: number
		no_speech_prob: number
		compression_ratio: number
		avg_logprob: number
		seek: number
		temperature: number

		tokens: number[]
	}[]

	words: {
		word: string

		start: number
		end: number
	}[]
}

type Task = 'transcribe' | 'translate'

export interface OpenAICloudSTTOptions {
	model?: 'whisper-1'

	apiKey?: string
	organization?: string
	baseURL?: string

	temperature?: number
	prompt?: string

	timeout?: number
	maxRetries?: number
}

export const defaultOpenAICloudSTTOptions: OpenAICloudSTTOptions = {
	apiKey: undefined,
	organization: undefined,
	baseURL: undefined,

	model: 'whisper-1',
	temperature: 0,
	prompt: undefined,

	timeout: undefined,
	maxRetries: 10,
}
