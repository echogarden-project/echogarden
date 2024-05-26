import { extendDeep } from '../utilities/ObjectUtilities.js'

import { Logger } from '../utilities/Logger.js'

import * as API from './API.js'
import { logToStderr } from '../utilities/Utilities.js'
import { languageCodeToName } from '../utilities/Locale.js'
import { LanguageDetectionResults } from './LanguageDetectionCommon.js'

const log = logToStderr

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

			logger.start('Detect text language using tinyld')

			detectedLanguageProbabilities = await detectLanguage(input)

			break
		}

		case 'fasttext': {
			const { detectLanguage } = await import('../text-language-detection/FastTextLanguageDetection.js')

			logger.start('Detect text language using FastText')

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
