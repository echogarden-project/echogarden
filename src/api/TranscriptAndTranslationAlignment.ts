import chalk from 'chalk'

import * as API from './API.js'

import { extendDeep } from '../utilities/ObjectUtilities.js'

import { AudioSourceParam, RawAudio } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'

import { Timeline } from '../utilities/Timeline.js'
import { type SubtitlesConfig } from '../subtitles/Subtitles.js'

export async function alignTranscriptAndTranslation(input: AudioSourceParam, transcript: string, translatedTranscript: string, options: TranscriptAndTranslationAlignmentOptions, callbacks?: TranscriptAndTranslationAlignmentCallbacks): Promise<TranscriptAndTranslationAlignmentResult> {
	options = extendDeep(defaultTranscriptAndTranslationAlignmentOptions, options)
	callbacks = { logLevel: API.getGlobalLogLevel(), ...callbacks }

	const logger = new Logger(callbacks.logLevel)

	const startTimestamp = logger.getTimestamp()

	if (options.sourceLanguage && !options.alignment?.language) {
		options.alignment = extendDeep(options.alignment || {}, { language: options.sourceLanguage })
	}

	if (options.targetLanguage && !options.timelineAlignment?.targetLanguage) {
		options.timelineAlignment = extendDeep(options.timelineAlignment || {}, { targetLanguage: options.targetLanguage })
	}

	let alignmentResult: API.AlignmentResult
	let timelineAlignmentResult: API.TimelineTranslationAlignmentResult

	switch (options.engine) {
		case 'two-stage': {
			logger.logTitledMessage(`Start stage 1`, `Align speech to transcript`, 'info', chalk.magentaBright)
			logger.end()

			alignmentResult = await API.align(
				input,
				transcript,
				options.alignment!,
				callbacks
			)

			logger.log(``)
			logger.logTitledMessage(`Start stage 2`, `Align timeline to translated transcript`, 'info', chalk.magentaBright)
			logger.end()

			timelineAlignmentResult = await API.alignTimelineTranslation(
				alignmentResult.timeline,
				translatedTranscript,
				options.timelineAlignment!,
				callbacks,
			)

			break
		}

		default: {
			throw new Error(`Engine '${options.engine}' is not supported`)
		}
	}

	logger.end()

	logger.log(``)
	logger.logDuration(`Total transcript and translation alignment time`, startTimestamp, 'info', chalk.magentaBright)

	return {
		timeline: alignmentResult.timeline,
		wordTimeline: alignmentResult.wordTimeline,

		translatedTimeline: timelineAlignmentResult.timeline,
		translatedWordTimeline: timelineAlignmentResult.wordTimeline,

		transcript,
		translatedTranscript,

		sourceLanguage: alignmentResult.language,
		targetLanguage: timelineAlignmentResult.targetLanguage,

		inputRawAudio: alignmentResult.inputRawAudio,
		isolatedRawAudio: alignmentResult.isolatedRawAudio,
		backgroundRawAudio: alignmentResult.backgroundRawAudio,
	}
}

export interface TranscriptAndTranslationAlignmentResult {
	timeline: Timeline
	wordTimeline: Timeline

	translatedTimeline: Timeline
	translatedWordTimeline: Timeline

	transcript: string
	translatedTranscript: string

	sourceLanguage: string
	targetLanguage: string

	inputRawAudio: RawAudio
	isolatedRawAudio?: RawAudio
	backgroundRawAudio?: RawAudio
}

export type TranscriptAndTranslationAlignmentEngine = 'two-stage'

export interface TranscriptAndTranslationAlignmentOptions extends API.OperationOptions {
	engine?: TranscriptAndTranslationAlignmentEngine

	sourceLanguage?: string
	targetLanguage?: string

	isolate?: boolean

	crop?: boolean

	alignment?: API.AlignmentOptions

	timelineAlignment?: API.TimelineTranslationAlignmentOptions

	languageDetection?: API.TextLanguageDetectionOptions

	vad?: API.VoiceActivityDetectionOptions

	plainText?: API.PlainTextOptions

	subtitles?: SubtitlesConfig

	sourceSeparation?: API.SourceSeparationOptions
}

export const defaultTranscriptAndTranslationAlignmentOptions: TranscriptAndTranslationAlignmentOptions = {
	engine: 'two-stage',

	sourceLanguage: undefined,
	targetLanguage: undefined,

	isolate: false,

	crop: true,

	alignment: {
	},

	timelineAlignment: {
	},

	languageDetection: {
	},

	plainText: {
		paragraphBreaks: 'double',
		whitespace: 'preserve'
	},

	subtitles: {
	},

	vad: {
		engine: 'adaptive-gate'
	},

	sourceSeparation: {
	},
}

export interface TranscriptAndTranslationAlignmentCallbacks extends API.OperationCallbacks {
}

export const TranscriptAndTranslationAlignmentEngines: API.EngineMetadata[] = [
	{
		id: 'two-stage',
		name: 'Two-stage translation alignment',
		description: 'Applies two-stage translation alignment to the spoken audio. First stage aligns the speech to the native language transcript. Second stage aligns the resulting timeline with the translated transcript.',
		type: 'local'
	}
]
