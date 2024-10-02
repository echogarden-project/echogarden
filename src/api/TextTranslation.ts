import chalk from 'chalk'
import { formatLanguageCodeWithName, normalizeIdentifierToLanguageCode, parseLangIdentifier } from '../utilities/Locale.js'
import { Logger } from '../utilities/Logger.js'
import { extendDeep } from '../utilities/ObjectUtilities.js'
import * as API from './API.js'

export async function translateText(inputText: string, options: TextTranslationOptions): Promise<TextTranslationResult> {
	const logger = new Logger()

	const startTimestamp = logger.getTimestamp()

	options = extendDeep(defaultTextTranslationOptions, options)

	if (options.sourceLanguage) {
		const languageData = await parseLangIdentifier(options.sourceLanguage)

		options.sourceLanguage = languageData.Name

		logger.end()
		logger.logTitledMessage('Source language specified', formatLanguageCodeWithName(options.sourceLanguage))
	} else {
		logger.start('No source language specified. Detect text language')
		const { detectedLanguage } = await API.detectTextLanguage(inputText, options.languageDetection || {})

		options.sourceLanguage = detectedLanguage

		logger.end()
		logger.logTitledMessage('Source language detected', formatLanguageCodeWithName(detectedLanguage))
	}

	options.targetLanguage = await normalizeIdentifierToLanguageCode(options.targetLanguage!)

	logger.logTitledMessage('Target language', formatLanguageCodeWithName(options.targetLanguage))

	logger.start(`Load ${options.engine} module`)

	let translationPairs: TranslationPair[]

	switch (options.engine) {
		case 'nllb': {
			const NLLBTextTranslation = await import('../text-translation/NLLBTextTranslation.js')

			logger.end()

			logger.logTitledMessage(`Warning`, `The nllb engine is currently an early prototype implementation and doesn't work correctly.`, chalk.yellow, 'warning')

			translationPairs = await NLLBTextTranslation.translateText(inputText, options.sourceLanguage, options.targetLanguage)

			break
		}

		case 'google-translate': {
			const GoogleTranslateTextTranslation = await import('../text-translation/GoogleTranslateTextTranslation.js')

			logger.end()

			translationPairs = await GoogleTranslateTextTranslation.translateText(inputText, options.sourceLanguage, options.targetLanguage)

			break
		}

		case 'deepl': {
			const DeepLTextTranslation = await import('../text-translation/DeepLTextTranslation.js')

			logger.end()

			logger.logTitledMessage(`Warning`, `The deepl engine is currently an early prototype implementation and doesn't work correctly.`, chalk.yellow, 'warning')

			translationPairs = await DeepLTextTranslation.translateText(inputText, options.sourceLanguage, options.targetLanguage)

			break
		}

		default: {
			throw new Error(`'${options.engine}' is not a supported text translation engine.`)
		}
	}

	const translatedText = translationPairs.map(pair => {
		const translated = pair.translatedText

		if (translated.endsWith(' ') || translated.endsWith('\n')) {
			return pair.translatedText
		} else {
			return pair.translatedText + ' '
		}
	}).join('').trim()

	logger.end()

	logger.log('')
	logger.logDuration(`Total text translation time`, startTimestamp, chalk.magentaBright)

	return {
		text: inputText,
		translatedText,

		translationPairs,

		sourceLanguage: options.sourceLanguage!,
		targetLanguage: options.targetLanguage!,
	}
}

export interface TextTranslationOptions {
	engine?: TextTranslationEngine

	sourceLanguage?: string
	targetLanguage?: string

	languageDetection?: API.TextLanguageDetectionOptions

	nllb?: {
	},

	googleTranslate?: {
	},

	deepl?: {
	},
}

export interface TextTranslationResult {
	text: string
	translatedText: string

	translationPairs: TranslationPair[]

	sourceLanguage: string
	targetLanguage: string
}

export type TextTranslationEngine = 'nllb' | 'google-translate' | 'deepl'

export interface TranslationPair {
	sourceText: string
	translatedText: string
}

export const defaultTextTranslationOptions: TextTranslationOptions = {
	engine: 'google-translate',

	sourceLanguage: undefined,
	targetLanguage: 'en',

	languageDetection: undefined,

	nllb: {
	},

	googleTranslate: {
	},

	deepl: {
	},
}

export const textTranslationEngines: API.EngineMetadata[] = [
	{
		id: 'nllb',
		name: 'NLLB',
		description: 'No Language Left Behind (NLLB) is a deep learning machine translation model by Facebook Research (early prototype implementation).',
		type: 'local'
	},
	{
		id: 'google-translate',
		name: 'Google Translate',
		description: 'Unoffical text translation API used by the Google Translate web interface.',
		type: 'cloud'
	},
	{
		id: 'deepl',
		name: 'DeepL',
		description: 'Unoffical text translation API used by the DeepL web interface (early prototype implementation).',
		type: 'cloud'
	},
]
