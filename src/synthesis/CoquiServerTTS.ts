import { SynthesisCallbacks } from '../api/API.js'
import { decodeWaveToRawAudio } from '../audio/AudioUtilities.js'
import { requestHttp } from 'easier-http-request'
import { Logger } from '../utilities/Logger.js'
import { logToStderr } from '../utilities/Utilities.js'

export async function synthesize(text: string, speakerId: string | null, serverURL = 'http://[::1]:5002', callbacks: SynthesisCallbacks) {
	const logger = new Logger(callbacks.logLevel)
	logger.start('Request synthesis from Coqui Server')

	const response = await requestHttp({
		url: `${serverURL}/api/tts`,

		params: {
			'text': text,
			'speaker_id': speakerId
		},

		abortSignal: callbacks?.abortSignal
	})

	const responseBody = await response.arrayBuffer()
	const waveData = new Uint8Array(responseBody)

	const { rawAudio } = decodeWaveToRawAudio(waveData)

	logger.end()

	return { rawAudio }
}
