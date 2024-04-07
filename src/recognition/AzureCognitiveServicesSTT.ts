import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk'

import { RawAudio, encodeRawAudioToWave } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'
import { Timeline } from '../utilities/Timeline.js'

export async function recognize(rawAudio: RawAudio, subscriptionKey: string, serviceRegion: string, languageCode: string, profanity: SpeechSDK.ProfanityOption = SpeechSDK.ProfanityOption.Raw) {
	const logger = new Logger()

	logger.start('Request recognition from Azure Cognitive Services')

	const result = await requestRecognition(rawAudio, subscriptionKey, serviceRegion, languageCode)

	logger.start('Process result')

	const transcript = result.text

	const resultObject = JSON.parse(result.json)
	const bestResult = resultObject.NBest[0]

	const timeline: Timeline = []

	for (const wordEntry of bestResult.Words) {
		const text = wordEntry.Word
		const startTime = wordEntry.Offset / 10000000
		const endTime = (wordEntry.Offset + wordEntry.Duration) / 10000000

		timeline.push({
			type: 'word',
			text,
			startTime,
			endTime
		})
	}

	logger.end()

	return { transcript, timeline }
}

async function requestRecognition(rawAudio: RawAudio, subscriptionKey: string, serviceRegion: string, languageCode: string, profanity: SpeechSDK.ProfanityOption = SpeechSDK.ProfanityOption.Raw) {
	const encodedAudio = encodeRawAudioToWave(rawAudio)

	return new Promise<SpeechSDK.SpeechRecognitionResult>((resolve, reject) => {
		const audioFormat = SpeechSDK.AudioStreamFormat.getWaveFormat(16000, 16, 1, SpeechSDK.AudioFormatTag.PCM)

		const inputStream = SpeechSDK.AudioInputStream.createPushStream(audioFormat)

		inputStream.write(encodedAudio)
		inputStream.close()

		const audioConfig = SpeechSDK.AudioConfig.fromStreamInput(inputStream)

		const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(subscriptionKey, serviceRegion)

		speechConfig.speechRecognitionLanguage = languageCode

		speechConfig.setProfanity(profanity)
		speechConfig.requestWordLevelTimestamps()

		speechConfig.outputFormat = SpeechSDK.OutputFormat.Detailed

		const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig)

		recognizer.recognizeOnceAsync(
			(result) => {
				recognizer.close()

				resolve(result)
			},

			(error) => {
				recognizer.close()

				reject(error)
			})
	})
}
