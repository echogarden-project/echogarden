import { request } from 'gaxios'
import { Logger } from '../utilities/Logger.js'
import { logToStderr } from '../utilities/Utilities.js'
import { decodeBase64 } from '../encodings/Base64.js'

const log = logToStderr

export async function synthesize(
	text: string,
	apiKey: string,
	languageCode = 'en-US',
	voice = 'en-US-Wavenet-C',
	speakingRate = 1.0,
	pitchDeltaSemitones = 0.0,
	volumeGainDecibels = 0.0,
	ssml = false,
	audioEncoding: AudioEncoding = 'MP3_64_KBPS',
	sampleRate = 24000) {

	const logger = new Logger()
	logger.start('Request synthesis from Google Cloud')

	const requestBody = {
		input: {
			text: undefined as (string | undefined),
			ssml: undefined as (string | undefined)
		},

		voice: {
			languageCode,
			name: voice
		},

		audioConfig: {
			audioEncoding,
			speakingRate,
			pitch: pitchDeltaSemitones,
			volumeGainDb: volumeGainDecibels,
			sampleRateHertz: sampleRate
		},

		enableTimePointing: ['SSML_MARK']
	}

	if (ssml) {
		requestBody.input.ssml = text
	} else {
		requestBody.input.text = text
	}

	const response = await request<any>({
		method: 'POST',

		url: `https://texttospeech.googleapis.com/v1beta1/text:synthesize`,

		params: {
			'key': apiKey
		},

		headers: {
			'User-Agent': ''
		},

		data: requestBody,

		responseType: 'json'
	})

	logger.start('Parse result')

	const result = parseResponseBody(response.data)

	logger.end()

	return result
}

function parseResponseBody(responseBody: any) {
	const audioData = decodeBase64(responseBody.audioContent)
	const timepoints: timePoint[] = responseBody.timepoints

	return { audioData, timepoints }
}

// Voices with audio samples: https://cloud.google.com/text-to-speech/docs/voices
export async function getVoiceList(apiKey: string) {
	const requestURL = `https://texttospeech.googleapis.com/v1beta1/voices`

	const response = await request<any>({
		method: 'GET',

		url: requestURL,

		params: {
			'key': apiKey
		},

		headers: {
			'User-Agent': ''
		},

		responseType: 'json'
	})

	const responseData = response.data

	const voices: GoogleCloudVoice[] = responseData.voices

	return voices
}

export type GoogleCloudVoice = {
	name: string
	languageCodes: string[]
	ssmlGender: 'MALE' | 'FEMALE'
	naturalSampleRateHertz: number
}

export type AudioEncoding = 'LINEAR16' | 'MP3' | 'MP3_64_KBPS' | 'OGG_OPUS' | 'MULAW' | 'ALAW'

export type timePoint = {
	markName: string,
	timeSeconds: number
}
