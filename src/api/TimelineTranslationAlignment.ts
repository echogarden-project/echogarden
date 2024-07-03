import chalk from 'chalk'
import { AudioSourceParam, RawAudio, ensureRawAudio } from '../audio/AudioUtilities.js'
import { SubtitlesConfig } from '../subtitles/Subtitles.js'
import { formatLanguageCodeWithName, getShortLanguageCode, parseLangIdentifier } from '../utilities/Locale.js'
import { Logger } from '../utilities/Logger.js'
import { extendDeep } from '../utilities/ObjectUtilities.js'
import { Timeline, addWordTextOffsetsToTimeline, wordTimelineToSegmentSentenceTimeline } from '../utilities/Timeline.js'
import * as API from './API.js'

export async function alignTimelineTranslation(inputTimeline: Timeline, translatedTranscript: string, options: TimelineTranslationAlignmentOptions): Promise<TimelineTranslationAlignmentResult> {
	const logger = new Logger()

	const startTimestamp = logger.getTimestamp()

	options = extendDeep(defaultTimelineTranslationAlignmentOptions, options)

	let rawAudio: RawAudio | undefined

	if (options.audio) {
		rawAudio = await ensureRawAudio(options.audio)
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
		const { detectedLanguage } = await API.detectTextLanguage(timelineText, options.languageDetection || {})

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
		const { detectedLanguage } = await API.detectTextLanguage(translatedTranscript, options.languageDetection || {})

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
				targetLanguage)

			break
		}

		default: {
			throw new Error(`Unsupported engine: ${options.engine}`)
		}
	}

	logger.start(`Postprocess timeline`)

	addWordTextOffsetsToTimeline(mappedWordTimeline, translatedTranscript)

	const { segmentTimeline: mappedTimeline } = await wordTimelineToSegmentSentenceTimeline(mappedWordTimeline, translatedTranscript, targetLanguage)

	logger.end()
	logger.logDuration(`Total timeline translation alignment time`, startTimestamp, chalk.magentaBright)

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

export interface TimelineTranslationAlignmentOptions {
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

	languageDetection: undefined,

	subtitles: undefined,

	e5: {
		model: 'small-fp16',
	}
}
