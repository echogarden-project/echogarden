import { extendDeep } from '../utilities/ObjectUtilities.js'

import { logToStderr } from '../utilities/Utilities.js'
import { AudioSourceParam, RawAudio, ensureRawAudio, normalizeAudioLevelInPlace, trimAudioEnd } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'

import * as API from './API.js'
import { Timeline, addWordTextOffsetsToTimeline, wordTimelineToSegmentSentenceTimeline } from '../utilities/Timeline.js'
import { formatLanguageCodeWithName, getShortLanguageCode, normalizeIdentifierToLanguageCode, parseLangIdentifier } from '../utilities/Locale.js'
import { type WhisperAlignmentOptions } from '../recognition/WhisperSTT.js'
import chalk from 'chalk'
import { type SubtitlesConfig } from '../subtitles/Subtitles.js'

const log = logToStderr

export async function alignTranslation(input: AudioSourceParam, translatedTranscript: string, options: TranslationAlignmentOptions): Promise<TranslationAlignmentResult> {
	const logger = new Logger()

	const startTimestamp = logger.getTimestamp()

	options = extendDeep(defaultTranslationAlignmentOptions, options)

	const inputRawAudio = await ensureRawAudio(input)

	let sourceRawAudio: RawAudio
	let isolatedRawAudio: RawAudio | undefined
	let backgroundRawAudio: RawAudio | undefined

	if (options.isolate) {
		logger.log(``)
		logger.end();

		({ isolatedRawAudio, backgroundRawAudio } = await API.isolate(inputRawAudio, options.sourceSeparation!))

		logger.end()
		logger.log(``)

		logger.start(`Resample audio to 16kHz mono`)
		sourceRawAudio = await ensureRawAudio(isolatedRawAudio, 16000, 1)
	} else {
		logger.start(`Resample audio to 16kHz mono`)
		sourceRawAudio = await ensureRawAudio(inputRawAudio, 16000, 1)
	}

	let sourceUncropTimeline: Timeline | undefined

	if (options.crop) {
		logger.start('Crop using voice activity detection');
		({ timeline: sourceUncropTimeline, croppedRawAudio: sourceRawAudio } = await API.detectVoiceActivity(sourceRawAudio, options.vad!))

		logger.end()
	}

	logger.start('Normalize and trim audio')

	normalizeAudioLevelInPlace(sourceRawAudio)
	sourceRawAudio.audioChannels[0] = trimAudioEnd(sourceRawAudio.audioChannels[0])

	logger.end()

	let sourceLanguage: string

	if (options.sourceLanguage) {
		const languageData = await parseLangIdentifier(options.sourceLanguage)

		sourceLanguage = languageData.Name

		logger.end()
		logger.logTitledMessage('Source language specified', formatLanguageCodeWithName(sourceLanguage))
	} else {
		logger.start('No source language specified. Detect speech language')
		const { detectedLanguage } = await API.detectSpeechLanguage(sourceRawAudio, options.languageDetection || {})

		sourceLanguage = detectedLanguage

		logger.end()
		logger.logTitledMessage('Source language detected', formatLanguageCodeWithName(detectedLanguage))
	}

	const targetLanguage = await normalizeIdentifierToLanguageCode(options.targetLanguage!)

	logger.logTitledMessage('Target language', formatLanguageCodeWithName(targetLanguage))

	let mappedTimeline: Timeline

	switch (options.engine) {
		case 'whisper': {
			const WhisperSTT = await import('../recognition/WhisperSTT.js')

			const shortSourceLanguageCode = getShortLanguageCode(sourceLanguage)
			const shortTargetLanguageCode = getShortLanguageCode(targetLanguage)

			if (shortTargetLanguageCode != 'en') {
				throw new Error('Whisper translation only supports English as target language')
			}

			if (shortSourceLanguageCode == 'en' && shortTargetLanguageCode == 'en') {
				throw new Error('Both translation source and target languages are English')
			}

			const whisperAlignmnentOptions = options.whisper!

			const { modelName, modelDir } = await WhisperSTT.loadPackagesAndGetPaths(whisperAlignmnentOptions.model, shortSourceLanguageCode)

			logger.end()

			if (modelName.endsWith('.en')) {
				throw new Error('Whisper translation tasks are only possible with a multilingual model')
			}

			mappedTimeline = await WhisperSTT.alignEnglishTranslation(sourceRawAudio, translatedTranscript, modelName, modelDir, shortSourceLanguageCode, whisperAlignmnentOptions)

			break
		}

		default: {
			throw new Error(`Engine '${options.engine}' is not supported`)
		}
	}

	// If the audio was cropped before recognition, map the timestamps back to the original audio
	if (sourceUncropTimeline && sourceUncropTimeline.length > 0) {
		API.convertCroppedToUncroppedTimeline(mappedTimeline, sourceUncropTimeline)
	}

	// Add text offsets
	addWordTextOffsetsToTimeline(mappedTimeline, translatedTranscript)

	// Make segment timeline
	const { segmentTimeline } = await wordTimelineToSegmentSentenceTimeline(mappedTimeline, translatedTranscript, sourceLanguage, options.plainText?.paragraphBreaks, options.plainText?.whitespace)

	logger.end()
	logger.logDuration(`Total translation alignment time`, startTimestamp, chalk.magentaBright)

	return {
		timeline: segmentTimeline,
		wordTimeline: mappedTimeline,

		translatedTranscript,
		sourceLanguage,
		targetLanguage,

		inputRawAudio,
		isolatedRawAudio,
		backgroundRawAudio,
	}
}

export interface TranslationAlignmentResult {
	timeline: Timeline
	wordTimeline: Timeline

	translatedTranscript: string
	sourceLanguage: string
	targetLanguage: string

	inputRawAudio: RawAudio
	isolatedRawAudio?: RawAudio
	backgroundRawAudio?: RawAudio
}

export type TranslationAlignmentEngine = 'whisper'

export interface TranslationAlignmentOptions {
	engine?: TranslationAlignmentEngine

	sourceLanguage?: string
	targetLanguage?: string

	isolate?: boolean

	crop?: boolean

	languageDetection?: API.SpeechLanguageDetectionOptions

	vad?: API.VADOptions

	plainText?: API.PlainTextOptions

	subtitles?: SubtitlesConfig

	sourceSeparation?: API.SourceSeparationOptions

	whisper?: WhisperAlignmentOptions
}

export const defaultTranslationAlignmentOptions: TranslationAlignmentOptions = {
	engine: 'whisper',

	sourceLanguage: undefined,
	targetLanguage: 'en',

	isolate: false,

	crop: true,

	languageDetection: {
	},

	plainText: {
		paragraphBreaks: 'double',
		whitespace: 'collapse'
	},

	subtitles: {
	},

	vad: {
		engine: 'adaptive-gate'
	},

	sourceSeparation: {
	},

	whisper: {
	}
}

export const translationAlignmentEngines: API.EngineMetadata[] = [
	{
		id: 'whisper',
		name: 'OpenAI Whisper',
		description: 'Extracts timestamps by guiding the Whisper recognition model to recognize the translated transcript tokens.',
		type: 'local'
	}
]
