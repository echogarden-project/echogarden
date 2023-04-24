import { extendDeep } from "../utilities/ObjectUtilities.js"

import * as FFMpegTranscoder from "../codecs/FFMpegTranscoder.js"

import { RawAudio, downmixToMonoAndNormalize } from "../audio/AudioUtilities.js"
import { Logger } from "../utilities/Logger.js"
import { resampleAudioSpeex } from "../dsp/SpeexResampler.js"

import * as API from "./API.js"
import { logToStderr } from "../utilities/Utilities.js"
import path from "path"
import type { WhisperModelName } from "../recognition/WhisperSTT.js"
import { languageCodeToName } from "../utilities/Locale.js"
import { loadPackage } from "../utilities/PackageManager.js"

const log = logToStderr

/////////////////////////////////////////////////////////////////////////////////////////////
// Speech language detection
/////////////////////////////////////////////////////////////////////////////////////////////
export async function detectSpeechFileLanguage(filename: string, options: SpeechLanguageDetectionOptions) {
	const rawAudio = await FFMpegTranscoder.decodeToChannels(filename)

	return detectSpeechLanguage(rawAudio, options)
}

export async function detectSpeechLanguage(rawAudio: RawAudio, options: SpeechLanguageDetectionOptions) {
	const logger = new Logger()
	logger.start("Prepare for speech language detection")

	options = extendDeep(defaultSpeechLanguageDetectionOptions, options)

	const defaultLanguage = options.defaultLanguage!
	const fallbackThresholdProbability = options.fallbackThresholdProbability!

	rawAudio = await resampleAudioSpeex(rawAudio, 16000)
	rawAudio = downmixToMonoAndNormalize(rawAudio)

	logger.start(`Initialize ${options.engine} module`)

	let detectedLanguageProbabilities: LanguageDetectionResults
	let detectedLanguageGroupProbabilities: LanguageDetectionGroupResults

	switch (options.engine) {
		case "silero": {
			const SileroLanguageDetection = await import("../speech-language-detection/SileroLanguageDetection.js")

			logger.end()

			const sileroOptions = options.silero!

			const modelDir = await loadPackage("silero-lang-classifier-95")

			const modelPath = path.join(modelDir, "lang_classifier_95.onnx")
			const languageDictionaryPath = path.join(modelDir, "lang_dict_95.json")
			const languageGroupDictionaryPath = path.join(modelDir, "lang_group_dict_95.json")

			const { languageResults, languageGroupResults } = await SileroLanguageDetection.detectLanguage(
				rawAudio,
				modelPath,
				languageDictionaryPath,
				languageGroupDictionaryPath)

			detectedLanguageProbabilities = languageResults
			detectedLanguageGroupProbabilities = languageGroupResults

			break
		}

		case "whisper": {
			const WhisperSTT = await import("../recognition/WhisperSTT.js")

			const whisperOptions = options.whisper!

			const { modelName, modelDir, tokenizerDir } = await WhisperSTT.loadPackagesAndGetPaths(whisperOptions.model, undefined)

			logger.end()

			detectedLanguageProbabilities = await WhisperSTT.detectLanguage(rawAudio, modelName, modelDir, tokenizerDir)
			detectedLanguageGroupProbabilities = []

			break
		}

		default: {
			throw new Error(`Engine '${options.engine}' is not supported`)
		}
	}

	let detectedLanguage: string
	let detectedLanguageName: string

	if (detectedLanguageProbabilities.length == 0 ||
		detectedLanguageProbabilities[0].probability < fallbackThresholdProbability) {

		detectedLanguage = defaultLanguage
	} else {
		detectedLanguage = detectedLanguageProbabilities[0].language
	}

	logger.end()

	return { detectedLanguage, detectedLanguageName: languageCodeToName(detectedLanguage), detectedLanguageProbabilities, detectedLanguageGroupProbabilities }
}

export type SpeechLanguageDetectionEngine = "silero" | "whisper"

export interface SpeechLanguageDetectionOptions {
	engine?: SpeechLanguageDetectionEngine
	defaultLanguage?: string,
	fallbackThresholdProbability?: number

	silero?: {
	}

	whisper?: {
		model: WhisperModelName
	}
}

export const defaultSpeechLanguageDetectionOptions: SpeechLanguageDetectionOptions = {
	engine: "silero",

	silero: {
	},

	whisper: {
		model: "tiny",
	}
}

/////////////////////////////////////////////////////////////////////////////////////////////
// Text language detection
/////////////////////////////////////////////////////////////////////////////////////////////
export async function detectTextLanguage(text: string, options: TextLanguageDetectionOptions) {
	const logger = new Logger()

	options = extendDeep(defaultTextLanguageDetectionOptions, options)

	const defaultLanguage = options.defaultLanguage!
	const fallbackThresholdProbability = options.fallbackThresholdProbability!

	let detectedLanguageProbabilities: LanguageDetectionResults

	logger.start(`Initialize ${options.engine} module`)

	switch (options.engine) {
		case "tinyld": {
			const { detectLanguage } = await import("../text-language-detection/TinyLDLanguageDetection.js")

			logger.start("Detecting text language using tinyld")

			detectedLanguageProbabilities = await detectLanguage(text)

			break
		}

		case "fasttext": {
			const { detectLanguage } = await import("../text-language-detection/FastTextLanguageDetection.js")

			logger.start("Detecting text language using FastText")

			detectedLanguageProbabilities = await detectLanguage(text)

			break
		}

		default: {
			throw new Error(`Engine '${options.engine}' is not supported`)
		}
	}

	let detectedLanguage: string

	if (detectedLanguageProbabilities.length == 0 ||
		detectedLanguageProbabilities[0].probability < fallbackThresholdProbability) {

		detectedLanguage = defaultLanguage
	} else {
		detectedLanguage = detectedLanguageProbabilities[0].language
	}

	logger.end()

	return { detectedLanguage, detectedLanguageName: languageCodeToName(detectedLanguage), detectedLanguageProbabilities }
}

export type LanguageDetectionResults = LanguageDetectionResultsEntry[]
export type LanguageDetectionResultsEntry = { language: string, languageName: string, probability: number }

export type LanguageDetectionGroupResults = LanguageDetectionGroupResultsEntry[]
export type LanguageDetectionGroupResultsEntry = { languageGroup: string, probability: number }

export type TextLanguageDetectionEngine = "tinyld" | "fasttext"

export type TextLanguageDetectionOptions = {
	engine?: TextLanguageDetectionEngine,
	defaultLanguage?: string,
	fallbackThresholdProbability?: number
}

export const defaultTextLanguageDetectionOptions: TextLanguageDetectionOptions = {
	engine: "tinyld",
	defaultLanguage: "en",
	fallbackThresholdProbability: 0.05
}

