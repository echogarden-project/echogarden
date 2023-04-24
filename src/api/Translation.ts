import { extendDeep } from "../utilities/ObjectUtilities.js"

import * as FFMpegTranscoder from "../codecs/FFMpegTranscoder.js"

import { logToStderr } from "../utilities/Utilities.js"
import { RawAudio, downmixToMonoAndNormalize, trimAudioEnd } from "../audio/AudioUtilities.js"
import { Logger } from "../utilities/Logger.js"
import { resampleAudioSpeex } from "../dsp/SpeexResampler.js"

import * as API from "./API.js"
import { Timeline } from "../utilities/Timeline.js"
import type { WhisperModelName } from "../recognition/WhisperSTT.js"
import { getShortLanguageCode, normalizeLanguageCode } from "../utilities/Locale.js"

const log = logToStderr

/////////////////////////////////////////////////////////////////////////////////////////////
// Speech translation
/////////////////////////////////////////////////////////////////////////////////////////////
export async function translateSpeechFile(filename: string, options: SpeechTranslationOptions) {
	const rawAudio = await FFMpegTranscoder.decodeToChannels(filename)
	return translateSpeech(rawAudio, options)
}

export async function translateSpeech(inputRawAudio: RawAudio, options: SpeechTranslationOptions) {
	const logger = new Logger()
	const startTimestamp = logger.getTimestamp()

	if (!options.sourceLanguage) {
		throw new Error(`Source language is not set`)
	}

	logger.start("Preprocess audio for translation")

	options = extendDeep(defaultSpeechTranslationOptions, options)

	const engine = options.engine!
	const sourceLanguage = normalizeLanguageCode(options.sourceLanguage!)
	const targetLanguage = options.targetLanguage!

	let transcript: string
	let timeline: Timeline | undefined

	let sourceRawAudio = await resampleAudioSpeex(inputRawAudio, 16000)
	sourceRawAudio = downmixToMonoAndNormalize(sourceRawAudio)
	sourceRawAudio.audioChannels[0] = trimAudioEnd(sourceRawAudio.audioChannels[0], 0, -40)

	logger.start(`Load ${engine} module`)

	switch (engine) {
		case "whisper": {
			const WhisperSTT = await import("../recognition/WhisperSTT.js")

			const whisperOptions = options.whisper!

			const shortSourceLanguageCode = getShortLanguageCode(sourceLanguage)
			const shortTargetLanguageCode = getShortLanguageCode(targetLanguage)

			const { modelName, modelDir, tokenizerDir } = await WhisperSTT.loadPackagesAndGetPaths(whisperOptions.model, shortSourceLanguageCode)

			if (shortTargetLanguageCode != "en") {
				throw new Error("Whisper translation only supports English as target language")
			}

			if (modelName.endsWith(".en")) {
				throw new Error("Whisper translation tasks are only possible with a multilingual model")
			}

			if (shortSourceLanguageCode == "en" && shortTargetLanguageCode == "en") {
				throw new Error("Both translation source and target language are English")
			}

			logger.end();

			({ transcript, timeline } = await WhisperSTT.recognize(sourceRawAudio, modelName, modelDir, tokenizerDir, "translate", sourceLanguage))

			break
		}

		default: {
			throw new Error(`Engine '${options.engine}' is not supported`)
		}
	}

	logger.end()
	logger.logDuration(`Total speech translation time`, startTimestamp)

	return { transcript, timeline, rawAudio: inputRawAudio, sourceLanguage }
}

export type SpeechTranslationEngine = "whisper"

export interface SpeechTranslationOptions {
	engine?: SpeechTranslationEngine

	sourceLanguage?: string
	targetLanguage?: string

	whisper?: {
		model?: WhisperModelName
	}
}

export const defaultSpeechTranslationOptions: SpeechTranslationOptions = {
	engine: "whisper",

	sourceLanguage: undefined,
	targetLanguage: "en",

	whisper: {
		model: "tiny",
	},
}
