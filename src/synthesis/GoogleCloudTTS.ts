import { Logger } from '../utilities/Logger.js'
import { logToStderr } from '../utilities/Utilities.js'
import { decodeBase64 } from '../encodings/Base64.js'
import * as FFMpegTranscoder from '../codecs/FFMpegTranscoder.js'
import { requestHttp } from 'easier-http-request'
import { VoiceListRequestCallbacks, SynthesisCallbacks } from '../api/API.js'

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
	audioEncoding: AudioEncoding = 'MP3',
	sampleRate = 24000,
	callbacks: SynthesisCallbacks) {

	const logger = new Logger(callbacks.logLevel)
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

	const response = await requestHttp({
		method: 'POST',

		url: `https://texttospeech.googleapis.com/v1beta1/text:synthesize`,

		params: {
			'key': apiKey
		},

		headers: {
			'User-Agent': ''
		},

		body: requestBody,

		abortSignal: callbacks?.abortSignal
	})

	const responseObject = await response.json()

	logger.start('Parse result')

	const result = parseResponseObject(responseObject)

	logger.start('Decode to raw audio')

	const rawAudio = await FFMpegTranscoder.decodeToChannels(
		result.audioData,
		undefined,
		undefined,
		{ abortSignal: callbacks.abortSignal, logLevel: 'warning' },
	)
	const timepoints = result.timepoints

	logger.end()

	return { rawAudio, timepoints }
}

function parseResponseObject(responseBody: any) {
	const audioData = decodeBase64(responseBody.audioContent)
	const timepoints: timePoint[] = responseBody.timepoints

	return { audioData, timepoints }
}

// Voices with audio samples: https://cloud.google.com/text-to-speech/docs/voices
export async function getVoiceList(apiKey: string, callbacks: VoiceListRequestCallbacks) {
	const requestURL = `https://texttospeech.googleapis.com/v1beta1/voices`

	const response = await requestHttp({
		method: 'GET',

		url: requestURL,

		params: {
			'key': apiKey
		},

		headers: {
			'User-Agent': ''
		},

		abortSignal: callbacks?.abortSignal
	})

	const responseObject = await response.json()

	const voices: GoogleCloudVoice[] = responseObject.voices

	return voices
}

export type GoogleCloudVoice = {
	name: string
	languageCodes: string[]
	ssmlGender: 'MALE' | 'FEMALE'
	naturalSampleRateHertz: number
}

export type AudioEncoding =
	'AUDIO_ENCODING_UNSPECIFIED' |
	'LINEAR16' |
	'MP3' |
	'OGG_OPUS' |
	'MULAW' |
	'ALAW'

export type timePoint = {
	markName: string,
	timeSeconds: number
}
