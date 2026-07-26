import chalk from 'chalk'

import * as API from './API.js'

import { AudioSourceParam, RawAudio, ensureRawAudio } from '../audio/AudioUtilities.js'
import { SubtitlesConfig } from '../subtitles/Subtitles.js'
import { formatLanguageCodeWithName, getShortLanguageCode, parseLangIdentifier } from '../utilities/Locale.js'
import { Logger } from '../utilities/Logger.js'
import { extendDeep } from '../utilities/ObjectUtilities.js'
import { Timeline, addWordTextOffsetsToTimelineInPlace, wordTimelineToSegmentSentenceTimeline } from '../utilities/Timeline.js'

export async function alignTimelineTranslation(inputTimeline: Timeline, translatedTranscript: string, options: TimelineTranslationAlignmentOptions, callbacks?: TimelineTranslationAlignmentCallbacks): Promise<TimelineTranslationAlignmentResult> {
	options = extendDeep(defaultTimelineTranslationAlignmentOptions, options)
	callbacks = { logLevel: API.getGlobalLogLevel(), ...callbacks }

	const logger = new Logger(callbacks.logLevel)

	const startTimestamp = logger.getTimestamp()

	let rawAudio: RawAudio | undefined

	if (options.audio) {
		rawAudio = await ensureRawAudio(options.audio, undefined, undefined, callbacks)
	}

	let sourceLanguage = options.sourceLanguage

	if (options.sourceLanguage) {
		const languageData = await parseLangIdentifier(options.sourceLanguage)

		sourceLanguage = languageData.Name

		logger.end()
		logger.logTitledMessage('Source language specified', formatLanguageCodeWithName(sourceLanguage))
	} else {
		logger.start('No source language specified. Detect source language')

		const timelineText = inputTimeline.map(entry => entry.text).join(' ')
		const { detectedLanguage } = await API.detectTextLanguage(
			timelineText,
			options.languageDetection!,
			{ abortSignal: callbacks.abortSignal, logLevel: 'warning' },
		)

		sourceLanguage = detectedLanguage

		logger.end()
		logger.logTitledMessage('Source language detected', formatLanguageCodeWithName(detectedLanguage))
	}

	let targetLanguage: string

	if (options.targetLanguage) {
		const languageData = await parseLangIdentifier(options.targetLanguage)

		targetLanguage = languageData.Name

		logger.end()
		logger.logTitledMessage('Target language specified', formatLanguageCodeWithName(targetLanguage))
	} else {
		logger.start('No target language specified. Detect target language')

		const { detectedLanguage } = await API.detectTextLanguage(
			translatedTranscript,
			options.languageDetection!,
			{ abortSignal: callbacks.abortSignal, logLevel: 'warning' },
		)

		targetLanguage = detectedLanguage

		logger.end()
		logger.logTitledMessage('Target language detected', formatLanguageCodeWithName(detectedLanguage))
	}

	logger.start(`Load ${options.engine} module`)

	let mappedWordTimeline: Timeline

	switch (options.engine) {
		case 'e5': {
			const { alignTimelineToTextSemantically, e5SupportedLanguages } = await import('../alignment/SemanticTextAlignment.js')

			const shortSourceLanguageCode = getShortLanguageCode(sourceLanguage)
			if (!e5SupportedLanguages.includes(shortSourceLanguageCode)) {
				throw new Error(`Source language ${formatLanguageCodeWithName(sourceLanguage)} is not supported by the E5 embedding model.`)
			}

			const shortTargetLanguageCode = getShortLanguageCode(targetLanguage)
			if (!e5SupportedLanguages.includes(shortTargetLanguageCode)) {
				throw new Error(`Target language ${formatLanguageCodeWithName(targetLanguage)} is not supported by the E5 embedding model.`)
			}

			logger.end()

			mappedWordTimeline = await alignTimelineToTextSemantically(
				inputTimeline,
				translatedTranscript,
				targetLanguage,
				callbacks,
			)

			break
		}

		default: {
			throw new Error(`Unsupported engine: ${options.engine}`)
		}
	}

	logger.start(`Postprocess timeline`)

	addWordTextOffsetsToTimelineInPlace(mappedWordTimeline, translatedTranscript)

	const { segmentTimeline: mappedTimeline } = await wordTimelineToSegmentSentenceTimeline(mappedWordTimeline, translatedTranscript, targetLanguage)

	logger.end()
	logger.logDuration(`Total timeline translation alignment time`, startTimestamp, 'info', chalk.magentaBright)

	logger.end()

	return {
		timeline: mappedTimeline,
		wordTimeline: mappedWordTimeline,

		sourceLanguage,
		targetLanguage,

		rawAudio,
	}
}

// Types
export interface TimelineTranslationAlignmentResult {
	timeline: Timeline
	wordTimeline: Timeline

	sourceLanguage?: string
	targetLanguage: string

	rawAudio?: RawAudio
}

export interface TimelineTranslationAlignmentOptions extends API.OperationOptions {
	engine?: 'e5'

	sourceLanguage?: string
	targetLanguage?: string

	audio?: AudioSourceParam

	languageDetection?: API.TextLanguageDetectionOptions

	subtitles?: SubtitlesConfig

	e5?: {
		model: 'small-fp16'
	}
}

// Constants
const defaultTimelineTranslationAlignmentOptions: TimelineTranslationAlignmentOptions = {
	engine: 'e5',

	sourceLanguage: undefined,
	targetLanguage: undefined,

	audio: undefined,

	languageDetection: {
	},

	subtitles: {
	},

	e5: {
		model: 'small-fp16',
	}
}

export interface TimelineTranslationAlignmentCallbacks extends API.OperationCallbacks {
}

export const timelineTranslationAlignmentEngines: API.EngineMetadata[] = [
	{
		id: 'e5',
		name: 'E5',
		description: 'E5 embedding model.',
		type: 'local'
	},
]
