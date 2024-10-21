import { request } from 'gaxios'
import { SynthesisVoice } from '../api/API.js'
import { trimAudioEnd } from '../audio/AudioUtilities.js'
import * as FFMpegTranscoder from '../codecs/FFMpegTranscoder.js'
import { Phrase, splitToFragments } from '../nlp/Segmentation.js'
import { Logger } from '../utilities/Logger.js'
import { concatFloat32Arrays, logToStderr } from '../utilities/Utilities.js'
import { Timeline } from '../utilities/Timeline.js'

const log = logToStderr

const maxTextLengthPerRequest = 200

export async function synthesizeLongText(text: string, voice: string, languageCode: string, sentenceEndPause = 0.75, segmentEndPause = 1.0) {
	if (text.length == 0) {
		throw new Error('Text is empty')
	}

	const logger = new Logger()
	logger.start('Prepare and split text')

	const fragments = await splitToFragments(text, maxTextLengthPerRequest, languageCode)

	const audioFragments: Float32Array[] = []
	let fragmentsSampleRate = 0

	const timeline: Timeline = []

	for (let i = 0; i < fragments.length; i++) {
		const fragment = fragments[i]

		logger.start(`Request synthesis for text fragment ${i + 1}/${fragments.length} from Streamslabs Polly`)
		const fragmentMp3Stream = await synthesizeFragment(fragment.text, voice)

		if (fragmentMp3Stream.length == 0) {
			continue
		}

		const rawAudio = await FFMpegTranscoder.decodeToChannels(fragmentMp3Stream, 24000, 1)
		fragmentsSampleRate = rawAudio.sampleRate

		let targetEndingSilenceTime: number

		if (fragment.lastSegment?.isSentenceFinalizer) {
			targetEndingSilenceTime = sentenceEndPause
		} else if (fragment.lastSegment instanceof Phrase) {
			targetEndingSilenceTime = segmentEndPause
		} else {
			targetEndingSilenceTime = 0
		}

		const trimmedAudio = trimAudioEnd(rawAudio.audioChannels[0], targetEndingSilenceTime * rawAudio.sampleRate)

		audioFragments.push(trimmedAudio)

		const startTime = timeline.length == 0 ? 0 : timeline[timeline.length - 1].endTime
		const endTime = startTime + (trimmedAudio.length / fragmentsSampleRate)

		timeline.push({
			type: 'segment',
			text: fragment.text,
			startTime,
			endTime
		})
	}

	const rawAudio = { audioChannels: [concatFloat32Arrays(audioFragments)], sampleRate: fragmentsSampleRate }

	logger.end()

	return {
		rawAudio,
		timeline
	}
}

export async function synthesizeFragment(text: string, voice: string) {
	const response = await request<any>({
		url: `https://streamlabs.com/polly/speak`,

		method: 'POST',

		data: {
			voice,
			text,
		},

		responseType: 'json'
	})

	const responseObject = response.data
	const audioUrl = responseObject.speak_url
	const audioUrlResponse = await request<ArrayBuffer>({ url: audioUrl, responseType: 'arraybuffer' })

	return new Uint8Array(audioUrlResponse.data)
}

export const voiceList: SynthesisVoice[] = [
	{ name: 'Brian', languages: ['en-GB', 'en'], gender: 'male' },
	{ name: 'Emma', languages: ['en-GB', 'en'], gender: 'female' },
	{ name: 'Russell', languages: ['en-AU', 'en'], gender: 'male' },
	{ name: 'Joey', languages: ['en-US', 'en'], gender: 'male' },
	{ name: 'Matthew', languages: ['en-US', 'en'], gender: 'male' },
	{ name: 'Joanna', languages: ['en-US', 'en'], gender: 'female' },
	{ name: 'Kimberly', languages: ['en-US', 'en'], gender: 'female' },
	{ name: 'Amy', languages: ['en-GB', 'en'], gender: 'female' },
	{ name: 'Geraint', languages: ['en-GB-WLS', 'en-GB', 'en'], gender: 'male' },
	{ name: 'Nicole', languages: ['en-AU', 'en'], gender: 'female' },
	{ name: 'Justin', languages: ['en-US', 'en'], gender: 'male' },
	{ name: 'Ivy', languages: ['en-US', 'en'], gender: 'female' },
	{ name: 'Kendra', languages: ['en-US', 'en'], gender: 'female' },
	{ name: 'Salli', languages: ['en-US', 'en'], gender: 'female' },
	{ name: 'Raveena', languages: ['en-IN', 'en'], gender: 'female' },
]
