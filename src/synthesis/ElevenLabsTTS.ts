import { GaxiosResponse, request } from "gaxios"
import { SynthesisVoice } from "../api/API.js"
import * as FFMpegTranscoder from "../codecs/FFMpegTranscoder.js"
import { Logger } from "../utilities/Logger.js"
import { logToStderr } from "../utilities/Utilities.js"

const log = logToStderr

export async function synthesize(text: string, voiceId: string, apiKey: string, modelId: string, stability = 0, similarityBoost = 0) {
	const logger = new Logger()
	logger.start("Request synthesis from ElevenLabs")

	let response: GaxiosResponse<any>

	try {
		response = await request<any>({
			url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,

			method: "POST",

			headers: {
				"accept": "audio/mpeg",
				"xi-api-key": apiKey,
			},

			data: {
				text,

				model_id: modelId,

				voice_setting: {
					stability,
					similarity_boost: similarityBoost
				}
			},

			responseType: "arraybuffer"
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

	logger.start("Decode synthesized audio")
	const rawAudio = await FFMpegTranscoder.decodeToChannels(Buffer.from(response.data))

	logger.end()

	return { rawAudio }
}

export async function getVoiceList(apiKey: string) {
	const response = await request<any>({
		method: "GET",

		url: "https://api.elevenlabs.io/v1/voices",

		headers: {
			"accept": "accept: application/json",
			"xi-api-key": apiKey
		},

		responseType: "json"
	})

	const elevenLabsVoices: any[] = response.data.voices

	const voices: SynthesisVoice[] = elevenLabsVoices.map(elevenLabsVoice => ({
		name: elevenLabsVoice.name,
		languages: ['en-US', 'en'],
		gender: "unknown",

		elevenLabsVoiceId: elevenLabsVoice.voice_id
	}))

	return voices
}
