import { extendDeep } from "../utilities/ObjectUtilities.js"

import { logToStderr } from "../utilities/Utilities.js"
import { AudioSourceParam, RawAudio, ensureRawAudio, normalizeAudioLevel, trimAudioEnd } from "../audio/AudioUtilities.js"
import { Logger } from "../utilities/Logger.js"

import { Timeline, addWordTextOffsetsToTimeline, wordTimelineToSegmentSentenceTimeline } from "../utilities/Timeline.js"
import { whisperOptionsDefaults, type WhisperOptions } from "../recognition/WhisperSTT.js"
import { formatLanguageCodeWithName, getShortLanguageCode, normalizeLanguageCode } from "../utilities/Locale.js"
import { EngineMetadata } from "./Common.js"
import { SpeechLanguageDetectionOptions, detectSpeechLanguage } from "./API.js"
import chalk from "chalk"
import { SubtitlesConfig, defaultSubtitlesBaseConfig } from "../subtitles/Subtitles.js"

const log = logToStderr

/////////////////////////////////////////////////////////////////////////////////////////////
// Speech translation
/////////////////////////////////////////////////////////////////////////////////////////////
export async function translateSpeech(input: AudioSourceParam, options: SpeechTranslationOptions): Promise<SpeechTranslationResult> {
	const logger = new Logger()
	const startTimestamp = logger.getTimestamp()

	logger.start("Prepare for speech translation")

	const inputRawAudio = await ensureRawAudio(input)

	let sourceRawAudio = await ensureRawAudio(inputRawAudio, 16000, 1)
	sourceRawAudio = normalizeAudioLevel(sourceRawAudio)
	sourceRawAudio.audioChannels[0] = trimAudioEnd(sourceRawAudio.audioChannels[0])

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

			({ transcript, timeline } = await WhisperSTT.recognize(sourceRawAudio, modelName, modelDir, tokenizerDir, "translate", sourceLanguage, whisperOptions))

			break
		}

		default: {
			throw new Error(`Engine '${options.engine}' is not supported`)
		}
	}

	addWordTextOffsetsToTimeline(timeline, transcript)

	const { segmentTimeline } = await wordTimelineToSegmentSentenceTimeline(timeline, transcript, targetLanguage, 'single', 'preserve')

	logger.end()
	logger.log('')
	logger.logDuration(`Total speech translation time`, startTimestamp, chalk.magentaBright)

	return { transcript, timeline: segmentTimeline, wordTimeline: timeline, sourceLanguage, targetLanguage, inputRawAudio }
}

export interface SpeechTranslationResult {
	transcript: string
	timeline: Timeline
	wordTimeline: Timeline
	sourceLanguage: string
	targetLanguage: string
	inputRawAudio: RawAudio
}

export type SpeechTranslationEngine = "whisper"

export interface SpeechTranslationOptions {
	engine?: SpeechTranslationEngine

	sourceLanguage?: string
	targetLanguage?: string
	languageDetection?: SpeechLanguageDetectionOptions
	subtitles?: SubtitlesConfig

	whisper?: WhisperOptions
}

export const defaultSpeechTranslationOptions: SpeechTranslationOptions = {
	engine: "whisper",

	sourceLanguage: undefined,
	targetLanguage: "en",

	languageDetection: undefined,

	subtitles: defaultSubtitlesBaseConfig,

	whisper: whisperOptionsDefaults,
}

export const speechTranslationEngines: EngineMetadata[] = [
	{
		id: 'whisper',
		name: 'OpenAI Whisper',
		description: "Uses Whisper's speech translation capability to produce an English transcript from speech in a different language.",
		type: 'local'
	}
]
