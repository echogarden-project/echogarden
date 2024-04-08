import { deepClone, extendDeep } from '../utilities/ObjectUtilities.js'

import { AudioSourceParam, RawAudio, ensureRawAudio, getRawAudioDuration, normalizeAudioLevel, sliceRawAudioByTime, trimAudioEnd } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'

import * as API from './API.js'
import { logToStderr } from '../utilities/Utilities.js'
import path from 'path'
import { WhisperModelName } from '../recognition/WhisperSTT.js'
import { formatLanguageCodeWithName, languageCodeToName } from '../utilities/Locale.js'
import { loadPackage } from '../utilities/PackageManager.js'
import chalk from 'chalk'

const log = logToStderr

/////////////////////////////////////////////////////////////////////////////////////////////
// Speech language detection
/////////////////////////////////////////////////////////////////////////////////////////////
export async function detectSpeechLanguage(input: AudioSourceParam, options: SpeechLanguageDetectionOptions): Promise<SpeechLanguageDetectionResult> {
	const logger = new Logger()

	const startTime = logger.getTimestamp()

	options = extendDeep(defaultSpeechLanguageDetectionOptions, options)

	const inputRawAudio = await ensureRawAudio(input)

	let sourceRawAudio = await ensureRawAudio(inputRawAudio, 16000, 1)
	sourceRawAudio = normalizeAudioLevel(sourceRawAudio)
	sourceRawAudio.audioChannels[0] = trimAudioEnd(sourceRawAudio.audioChannels[0])

	if (options.crop) {
		logger.start('Crop using voice activity detection');
		({ croppedRawAudio: sourceRawAudio } = await API.detectVoiceActivity(sourceRawAudio, options.vad!))

		logger.end()
	}

	logger.start('Prepare for speech language detection')

	const defaultLanguage = options.defaultLanguage!
	const fallbackThresholdProbability = options.fallbackThresholdProbability!

	logger.start(`Initialize ${options.engine} module`)

	let detectedLanguageProbabilities: LanguageDetectionResults

	switch (options.engine) {
		case 'silero': {
			const SileroLanguageDetection = await import('../speech-language-detection/SileroLanguageDetection.js')

			logger.end()

			const sileroOptions = options.silero!

			const modelDir = await loadPackage('silero-lang-classifier-95')

			const modelPath = path.join(modelDir, 'lang_classifier_95.onnx')
			const languageDictionaryPath = path.join(modelDir, 'lang_dict_95.json')
			const languageGroupDictionaryPath = path.join(modelDir, 'lang_group_dict_95.json')

			const languageResults = await SileroLanguageDetection.detectLanguage(
				sourceRawAudio,
				modelPath,
				languageDictionaryPath,
				languageGroupDictionaryPath)

			detectedLanguageProbabilities = languageResults

			break
		}

		case 'whisper': {
			const WhisperSTT = await import('../recognition/WhisperSTT.js')

			const whisperOptions = options.whisper!

			const { modelName, modelDir } = await WhisperSTT.loadPackagesAndGetPaths(whisperOptions.model, undefined)

			logger.end()

			detectedLanguageProbabilities = await WhisperSTT.detectLanguage(sourceRawAudio, modelName, modelDir, whisperOptions.temperature!)

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
	logger.logDuration('\nTotal detection time', startTime, chalk.magentaBright)

	return {
		detectedLanguage,
		detectedLanguageName: languageCodeToName(detectedLanguage),
		detectedLanguageProbabilities,

		inputRawAudio,
	}
}

export interface SpeechLanguageDetectionResult {
	detectedLanguage: string
	detectedLanguageName: string
	detectedLanguageProbabilities: LanguageDetectionResults
	inputRawAudio: RawAudio
}

export async function detectSpeechLanguageByParts(sourceRawAudio: RawAudio, getResultsForAudioPart: (audioPart: RawAudio) => Promise<LanguageDetectionResults>, audioPartDuration = 30, hopDuration = 15) {
	const logger = new Logger()

	const audioDuration = getRawAudioDuration(sourceRawAudio)

	if (audioDuration === 0) {
		return []
	}

	const resultsForParts: LanguageDetectionResults[] = []

	for (let audioTimeOffset = 0; audioTimeOffset < audioDuration; audioTimeOffset += hopDuration) {
		const startOffset = audioTimeOffset
		const endOffset = Math.min(audioTimeOffset + audioPartDuration, audioDuration)
		const audioPartLength = endOffset - startOffset

		logger.logTitledMessage(`\nDetecting speech language starting at audio offset`, `${startOffset.toFixed(1)}`, chalk.magentaBright)
		const audioPart = sliceRawAudioByTime(sourceRawAudio, startOffset, endOffset)

		const resultsForPart = await getResultsForAudioPart(audioPart)

		resultsForParts.push(resultsForPart)

		const sortedResultsForPart = deepClone(resultsForPart).sort((a, b) => b.probability - a.probability)

		logger.logTitledMessage(`Top candidates`, `${formatLanguageCodeWithName(sortedResultsForPart[0].language)}: ${sortedResultsForPart[0].probability.toFixed(3)}, ${formatLanguageCodeWithName(sortedResultsForPart[1].language)}: ${sortedResultsForPart[1].probability.toFixed(3)}, ${formatLanguageCodeWithName(sortedResultsForPart[3].language)}: ${sortedResultsForPart[3].probability.toFixed(3)}`)

		if (audioPartLength < audioPartDuration) {
			break
		}
	}

	const averagedResults: LanguageDetectionResults = deepClone(resultsForParts[0])
	averagedResults.forEach(entry => { entry.probability = 0.0 })

	for (const partResults of resultsForParts) {
		for (let i = 0; i < partResults.length; i++) {
			averagedResults[i].probability += partResults[i].probability
		}
	}

	for (const result of averagedResults) {
		result.probability /= resultsForParts.length
	}

	return averagedResults
}

export type SpeechLanguageDetectionEngine = 'silero' | 'whisper'

export interface SpeechLanguageDetectionOptions {
	engine?: SpeechLanguageDetectionEngine
	defaultLanguage?: string,
	fallbackThresholdProbability?: number

	crop?: boolean

	silero?: {
	}

	whisper?: {
		model?: WhisperModelName
		temperature?: number
	}

	vad?: API.VADOptions
}

export const defaultSpeechLanguageDetectionOptions: SpeechLanguageDetectionOptions = {
	engine: 'whisper',
	defaultLanguage: 'en',
	fallbackThresholdProbability: 0.05,

	crop: true,

	silero: {
	},

	whisper: {
		model: 'tiny',
		temperature: 1.0
	},

	vad: {
		engine: 'adaptive-gate'
	}
}

/////////////////////////////////////////////////////////////////////////////////////////////
// Text language detection
/////////////////////////////////////////////////////////////////////////////////////////////
export async function detectTextLanguage(input: string, options: TextLanguageDetectionOptions): Promise<TextLanguageDetectionResult> {
	const logger = new Logger()

	options = extendDeep(defaultTextLanguageDetectionOptions, options)

	const defaultLanguage = options.defaultLanguage!
	const fallbackThresholdProbability = options.fallbackThresholdProbability!

	let detectedLanguageProbabilities: LanguageDetectionResults

	logger.start(`Initialize ${options.engine} module`)

	switch (options.engine) {
		case 'tinyld': {
			const { detectLanguage } = await import('../text-language-detection/TinyLDLanguageDetection.js')

			logger.start('Detecting text language using tinyld')

			detectedLanguageProbabilities = await detectLanguage(input)

			break
		}

		case 'fasttext': {
			const { detectLanguage } = await import('../text-language-detection/FastTextLanguageDetection.js')

			logger.start('Detecting text language using FastText')

			detectedLanguageProbabilities = await detectLanguage(input)

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

	return {
		detectedLanguage,
		detectedLanguageName: languageCodeToName(detectedLanguage),
		detectedLanguageProbabilities
	}
}

/////////////////////////////////////////////////////////////////////////////////////////////
// Types
/////////////////////////////////////////////////////////////////////////////////////////////

export interface TextLanguageDetectionResult {
	detectedLanguage: string
	detectedLanguageName: string
	detectedLanguageProbabilities: LanguageDetectionResults
}

export type LanguageDetectionResults = LanguageDetectionResultsEntry[]
export interface LanguageDetectionResultsEntry {
	language: string
	languageName: string
	probability: number
}

export type LanguageDetectionGroupResults = LanguageDetectionGroupResultsEntry[]
export interface LanguageDetectionGroupResultsEntry {
	languageGroup: string
	probability: number
}

export type TextLanguageDetectionEngine = 'tinyld' | 'fasttext'

export interface TextLanguageDetectionOptions {
	engine?: TextLanguageDetectionEngine
	defaultLanguage?: string
	fallbackThresholdProbability?: number
}

/////////////////////////////////////////////////////////////////////////////////////////////
// Constants
/////////////////////////////////////////////////////////////////////////////////////////////

export const defaultTextLanguageDetectionOptions: TextLanguageDetectionOptions = {
	engine: 'tinyld',
	defaultLanguage: 'en',
	fallbackThresholdProbability: 0.05,
}

export const speechLanguageDetectionEngines: API.EngineMetadata[] = [
	{
		id: 'silero',
		name: 'Silero',
		description: 'A speech language classification model by Silero.',
		type: 'local'
	},
	{
		id: 'whisper',
		name: 'OpenAI Whisper',
		description: 'Uses the language tokens produced by the Whisper model classify the spoken langauge.',
		type: 'local'
	},
]

export const textLanguageDetectionEngines: API.EngineMetadata[] = [
	{
		id: 'tinyld',
		name: 'TinyLD',
		description: 'A simple language detection library.',
		type: 'local'
	},
	{
		id: 'fasttext',
		name: 'FastText',
		description: 'A library for word representations and sentence classification by Facebook research.',
		type: 'local'
	},
]
