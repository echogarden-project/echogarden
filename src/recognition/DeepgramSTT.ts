import { GaxiosResponse, request } from 'gaxios'
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
		model: options.model!,
		encoding: 'opus',
		punctuate: options.punctuate ? 'true' : 'false',
	}

	// Set language or enable auto-detection
	if (languageCode) {
		params.language = languageCode
	} else {
		params.detect_language = 'true'
	}

	// Set audio encoding parameters
	logger.start('Convert audio to Opus format')

	const audioData = await FFMpegTranscoder.encodeFromChannels(
		rawAudio,
		FFMpegTranscoder.getDefaultFFMpegOptionsForSpeech('opus')
	)

	logger.start('Send request to Deepgram API')

	let response: GaxiosResponse<any>

	try {
		response = await request<any>({
			method: 'POST',

			url: 'https://api.deepgram.com/v1/listen',

			params,

			headers: {
				'Authorization': `Token ${options.apiKey}`,
				'Content-Type': 'audio/ogg',
				'Accept': 'application/json'
			},

			body: audioData,

			responseType: 'json',
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

	const deepgramResponse: DeepgramResponse = response.data

	const firstAlternative = deepgramResponse.results?.channels[0]?.alternatives[0]

	// Extract transcript and create timeline
	const transcript = firstAlternative?.transcript || ''

	// Extract word-level timing information if available
	const words = firstAlternative?.words || []

	const timeline = words.map((wordEntry: DeepgramWordEntry) => ({
		type: 'word',
		text: wordEntry.word,
		startTime: wordEntry.start,
		endTime: wordEntry.end,
		confidence: wordEntry.confidence,
	} as TimelineEntry))

	// If `punctuate` is set to `true`, modify the text of all words to match their exact case in the transcript.
	// This is required, otherwise it would later fail deriving word offsets.
	if (options.punctuate) {
		const lowerCaseTranscript = transcript.toLocaleLowerCase()

		let readOffset = 0

		for (const wordEntry of timeline) {
			const wordEntryTextLowercase = wordEntry.text.toLocaleLowerCase()

			const matchPosition = lowerCaseTranscript.indexOf(wordEntryTextLowercase, readOffset)

			if (matchPosition === -1) {
				throw new Error(`Couldn't match the word '${wordEntry.text}' in the lowercase transcript`)
			}

			wordEntry.text = transcript.substring(matchPosition, matchPosition + wordEntryTextLowercase.length)

			readOffset = matchPosition + wordEntry.text.length
		}
	}

	logger.end()

	return { transcript, timeline }
}

export interface DeepgramSTTOptions {
	apiKey?: string
	model?: string
	punctuate?: boolean
}

export const defaultDeepgramSTTOptions: DeepgramSTTOptions = {
	apiKey: undefined,
	model: 'nova-2',
	punctuate: true,
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
