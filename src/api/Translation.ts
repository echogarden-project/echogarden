import { extendDeep } from "../utilities/ObjectUtilities.js"

import * as FFMpegTranscoder from "../codecs/FFMpegTranscoder.js"

import { logToStderr } from "../utilities/Utilities.js"
import { RawAudio, downmixToMonoAndNormalize, trimAudioEnd } from "../audio/AudioUtilities.js"
import { Logger } from "../utilities/Logger.js"
import { resampleAudioSpeex } from "../dsp/SpeexResampler.js"

import { Timeline } from "../utilities/Timeline.js"
import type { WhisperModelName } from "../recognition/WhisperSTT.js"
import { formatLanguageCodeWithName, getShortLanguageCode, normalizeLanguageCode } from "../utilities/Locale.js"
import { EngineMetadata } from "./Common.js"
import { SpeechLanguageDetectionOptions, detectSpeechLanguage } from "./API.js"
import chalk from "chalk"

const log = logToStderr

/////////////////////////////////////////////////////////////////////////////////////////////
// Speech translation
/////////////////////////////////////////////////////////////////////////////////////////////
export async function translateSpeechFile(filename: string, options: SpeechTranslationOptions) {
	const rawAudio = await FFMpegTranscoder.decodeToChannels(filename)
	return translateSpeech(rawAudio, options)
}

export async function translateSpeech(inputRawAudio: RawAudio, options: SpeechTranslationOptions): Promise<SpeechTranslationResult> {
	const logger = new Logger()
	const startTimestamp = logger.getTimestamp()

	options = extendDeep(defaultSpeechTranslationOptions, options)

	if (!options.sourceLanguage) {
		logger.start("No language specified. Detecting speech language")
		const { detectedLanguage } = await detectSpeechLanguage(inputRawAudio, options.languageDetection || {})

		logger.end()
		logger.logTitledMessage('Language detected', formatLanguageCodeWithName(detectedLanguage))

		options.sourceLanguage = detectedLanguage
	}

	logger.start("Preprocess audio for translation")

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

			({ transcript, timeline } = await WhisperSTT.recognize(sourceRawAudio, modelName, modelDir, tokenizerDir, "translate", sourceLanguage, whisperOptions.temperature!, whisperOptions.prompt))

			break
		}

		default: {
			throw new Error(`Engine '${options.engine}' is not supported`)
		}
	}

	logger.end()
	logger.log('')
	logger.logDuration(`Total speech translation time`, startTimestamp, chalk.magentaBright)

	return { transcript, timeline, rawAudio: inputRawAudio, sourceLanguage }
}

export interface SpeechTranslationResult {
	transcript: string
	timeline: Timeline
	rawAudio: RawAudio
	sourceLanguage: string
}

export type SpeechTranslationEngine = "whisper"

export interface SpeechTranslationOptions {
	engine?: SpeechTranslationEngine

	sourceLanguage?: string
	targetLanguage?: string
	languageDetection?: SpeechLanguageDetectionOptions

	whisper?: {
		model?: WhisperModelName
		temperature?: number
		prompt?: string
	}
}

export const defaultSpeechTranslationOptions: SpeechTranslationOptions = {
	engine: "whisper",

	sourceLanguage: undefined,
	targetLanguage: "en",

	languageDetection: undefined,

	whisper: {
		model: "tiny",
		temperature: 0.0,
		prompt: undefined
	},
}

export const speechTranslationEngines: EngineMetadata[] = [
	{
		id: 'whisper',
		name: 'OpenAI Whisper',
		description: "Uses Whisper's speech translation capability to produce an English transcript from speech in a different language.",
		type: 'local'
	}
]
