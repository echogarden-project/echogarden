import { request } from "gaxios"
import { SynthesisVoice } from "../api/API.js"
import * as FFMpegTranscoder from "../codecs/FFMpegTranscoder.js"
import { Logger } from "../utilities/Logger.js"
import { logToStderr } from "../utilities/Utilities.js"

const log = logToStderr

export async function synthesize(text: string, voiceId: string, apiKey: string, stability = 0, similarityBoost = 0) {
	const logger = new Logger()
	logger.start("Request synthesis from ElevenLabs")

	const response = await request<any>({
		url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,

		method: "POST",

		data: {
			text,

			voice_setting: {
				stability,
				similarity_boost: similarityBoost
			}
		},

		headers: {
			"dnt": "1",
			"xi-api-key": apiKey,
		},

		responseType: "arraybuffer"
	})

	logger.start("Decode synthesized audio")
	const rawAudio = await FFMpegTranscoder.decodeToChannels(Buffer.from(response.data))

	logger.end()

	return { rawAudio }
}

export async function getVoiceList() {
	const response = await request<any>({
		method: "GET",

		url: "https://api.elevenlabs.io/v1/voices",
		headers: {
			"dnt": "1",
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
