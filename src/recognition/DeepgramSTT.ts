import { request } from 'gaxios'
import { RawAudio } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'
import { extendDeep } from '../utilities/ObjectUtilities.js'
import { Timeline, TimelineEntry } from '../utilities/Timeline.js'
import * as FFMpegTranscoder from '../codecs/FFMpegTranscoder.js'

export async function recognize(rawAudio: RawAudio, languageCode: string | undefined, options: DeepgramSTTOptions) {
	const logger = new Logger()

	logger.start('Initialize Deepgram recognition')

	options = extendDeep(defaultDeepgramSTTOptions, options)

	if (!options.apiKey) {
		throw new Error('No Deepgram API key provided')
	}

	// Prepare API request
	const params: Record<string, string> = {
		model: options.model || 'whisper-large',
		encoding: 'flac',
		//punctuate: 'true', // Problem when enabled: words in timeline are not capitalized, causing errors
	}

	// Set language or enable auto-detection
	if (languageCode) {
		params.language = languageCode
	} else {
		params.detect_language = 'true'
	}

	// Set audio encoding parameters
	logger.start('Convert audio to FLAC format')

	const audioData = await FFMpegTranscoder.encodeFromChannels(
		rawAudio,
		FFMpegTranscoder.getDefaultFFMpegOptionsForSpeech('flac')
	)

	logger.start('Send request to Deepgram API')

	const response = await request<any>({
		method: 'POST',

		url: 'https://api.deepgram.com/v1/listen',

		params,

		headers: {
			'Authorization': `Token ${options.apiKey}`,
			'Content-Type': 'audio/flac',
			'Accept': 'application/json'
		},

		body: audioData,

		responseType: 'json',
	})

	const deepgramResponse: DeepgramResponse = response.data

	const firstAlternative = deepgramResponse.results?.channels[0]?.alternatives[0]

	// Extract transcript and create timeline
	const transcript = firstAlternative?.transcript || ''

	let timeline: Timeline = []

	// Extract word-level timing information if available
	const words = firstAlternative?.words || []

	if (words.length > 0) {
		timeline = words.map((word: DeepgramWordEntry): TimelineEntry => ({
			type: 'word',
			text: word.word,
			startTime: word.start,
			endTime: word.end,
			confidence: word.confidence,
		}))
	}

	logger.end()

	return { transcript, timeline }
}

export interface DeepgramSTTOptions {
	apiKey?: string
	model?: string
}

export const defaultDeepgramSTTOptions: DeepgramSTTOptions = {
	apiKey: undefined,
	model: 'nova-2'
}

interface DeepgramWordEntry {
	word: string
	start: number
	end: number
	confidence: number
}

interface DeepgramAlternative {
	transcript: string
	confidence: number
	words: DeepgramWordEntry[]
}

interface DeepgramChannel {
	alternatives: DeepgramAlternative[]
}

interface DeepgramResponse {
	metadata?: {
		transaction_key: string
		request_id: string
		sha256: string
		created: string
		duration: number
		channels: number
		models: string[]

		model_info?: {
			name: string
			version: string
		}
	}

	results?: {
		channels: DeepgramChannel[]

		detected_language?: string
	}
}
