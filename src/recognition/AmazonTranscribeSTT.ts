import type { Item, LanguageCode, StartStreamTranscriptionCommandInput } from '@aws-sdk/client-transcribe-streaming'
import { wordCharacterPattern } from '../nlp/Segmentation.js'
import * as FFMpegTranscoder from '../codecs/FFMpegTranscoder.js'
import { Logger } from '../utilities/Logger.js'
import { Timeline } from '../utilities/Timeline.js'
import { RawAudio } from '../audio/AudioUtilities.js'

export async function recgonize(rawAudio: RawAudio, languageCode: string, region: string, accessKeyId: string, secretAccessKey: string) {
	const flac16Khz16bitMonoAudio = await FFMpegTranscoder.encodeFromChannels(rawAudio, { format: 'flac', sampleRate: 16000, sampleFormat: 's16', channelCount: 1 })

	const logger = new Logger()

	if (!supportedLanguageCodes.includes(languageCode)) {
		let matchingLanguageCode: string | undefined = undefined

		if (languageCode.length === 2) {
			matchingLanguageCode = languageCodeDefaultDialects.find(value => value.startsWith(languageCode))
		}

		if (matchingLanguageCode) {
			logger.log(`Short language code '${languageCode}' has been extended to the default dialect '${matchingLanguageCode}'`)

			languageCode = matchingLanguageCode
		} else {
			throw new Error(`Language code ${languageCode} is not supported by Amazon Transcribe`)
		}
	}

	logger.start('Initialize Amazon Transcribe streaming client module')

	const streamingTranscribeSdk = await import('@aws-sdk/client-transcribe-streaming')

	const streamingTranscribeClient = new streamingTranscribeSdk.TranscribeStreamingClient({
		region,
		credentials: {
			accessKeyId,
			secretAccessKey
		}
	})

	const audioStream = async function* () {
		const chunkSize = 2 ** 12

		for (let i = 0; i < flac16Khz16bitMonoAudio.length; i += chunkSize) {
			const chunk = flac16Khz16bitMonoAudio.subarray(i, i + chunkSize)

			yield { AudioEvent: { AudioChunk: chunk } }
		}
	}

	const params: StartStreamTranscriptionCommandInput = {
		LanguageCode: languageCode as LanguageCode,
		MediaSampleRateHertz: rawAudio.sampleRate,
		MediaEncoding: 'flac',
		AudioStream: audioStream(),
	}

	logger.start('Request recognition from Amazon Transcribe')

	const command = new streamingTranscribeSdk.StartStreamTranscriptionCommand(params)

	const response = await streamingTranscribeClient.send(command)

	let transcript = ''
	let events: Item[] = []

	for await (const event of response.TranscriptResultStream!) {
		if (!event.TranscriptEvent) {
			continue
		}

		const transcriptEvent = event.TranscriptEvent

		const results = transcriptEvent.Transcript!.Results!

		if (results.length == 0) {
			continue
		}

		const firstResult = results[0]
		const alternatives = firstResult.Alternatives

		if (!alternatives || alternatives.length == 0) {
			continue
		}

		const firstAlternative = alternatives[0]
		//logger.log(firstAlternative.Transcript!)

		if (firstResult.IsPartial === false) {
			events = [...events, ...firstAlternative.Items!]
			transcript += ' ' + firstAlternative.Transcript!
		}
	}

	logger.start('Process result')

	transcript = transcript.replace(/ +/g, ' ').trim()

	const timeline: Timeline = []

	for (const event of events) {
		const text = event.Content!

		if (!wordCharacterPattern.test(text)) {
			continue
		}

		const startTime = event.StartTime!
		const endTime = event.EndTime!
		const confidence = event.Confidence

		timeline[timeline.length - 1].endTime = startTime

		timeline.push(
			{
				type: 'word',
				text,
				startTime,
				endTime,
				confidence
			})
	}

	logger.end()

	return { transcript, timeline }
}

export const supportedLanguageCodes: string[] = [
	'af-ZA',
	'ar-AE',
	'ar-SA',
	'ca-ES',
	'cs-CZ',
	'da-DK',
	'de-CH',
	'de-DE',
	'el-GR',
	'en-AB',
	'en-AU',
	'en-GB',
	'en-IE',
	'en-IN',
	'en-NZ',
	'en-US',
	'en-WL',
	'en-ZA',
	'es-ES',
	'es-US',
	'eu-ES',
	'fa-IR',
	'fi-FI',
	'fr-CA',
	'fr-FR',
	'gl-ES',
	'he-IL',
	'hi-IN',
	'hr-HR',
	'id-ID',
	'it-IT',
	'ja-JP',
	'ko-KR',
	'lv-LV',
	'ms-MY',
	'nl-NL',
	'no-NO',
	'pl-PL',
	'pt-BR',
	'pt-PT',
	'ro-RO',
	'ru-RU',
	'sk-SK',
	'so-SO',
	'sr-RS',
	'sv-SE',
	'th-TH',
	'tl-PH',
	'uk-UA',
	'vi-VN',
	'zh-CN',
	'zh-HK',
	'zh-TW',
	'zu-ZA',
]

export const languageCodeDefaultDialects: string[] = [
	'af-ZA',
	'ar-SA',
	'ca-ES',
	'cs-CZ',
	'da-DK',
	'de-DE',
	'el-GR',
	'en-US',
	'es-ES',
	'eu-ES',
	'fa-IR',
	'fi-FI',
	'fr-FR',
	'gl-ES',
	'he-IL',
	'hi-IN',
	'hr-HR',
	'id-ID',
	'it-IT',
	'ja-JP',
	'ko-KR',
	'lv-LV',
	'ms-MY',
	'nl-NL',
	'no-NO',
	'pl-PL',
	'pt-BR',
	'ro-RO',
	'ru-RU',
	'sk-SK',
	'so-SO',
	'sr-RS',
	'sv-SE',
	'th-TH',
	'tl-PH',
	'uk-UA',
	'vi-VN',
	'zh-CN',
]
