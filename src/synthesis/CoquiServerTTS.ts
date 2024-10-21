import { request } from 'gaxios'
import { decodeWaveToRawAudio } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'
import { logToStderr } from '../utilities/Utilities.js'
const log = logToStderr

export async function synthesize(text: string, speakerId: string | null, serverURL = 'http://[::1]:5002') {
	const logger = new Logger()
	logger.start('Request synthesis from Coqui Server')

	const response = await request<Uint8Array>({
		url: `${serverURL}/api/tts`,

		params: {
			'text': text,
			'speaker_id': speakerId
		},

		responseType: 'arraybuffer'
	})

	const waveData = new Uint8Array(response.data)

	const { rawAudio } = decodeWaveToRawAudio(waveData)

	logger.end()

	return { rawAudio }
}
