import chalk from 'chalk'

import * as API from './API.js'

import { extendDeep } from '../utilities/ObjectUtilities.js'

import { AudioSourceParam, RawAudio, ensureRawAudio, normalizeAudioLevelInPlace, trimAudioEnd } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'

import { Timeline, addWordTextOffsetsToTimelineInPlace, wordTimelineToSegmentSentenceTimeline } from '../utilities/Timeline.js'
import { formatLanguageCodeWithName, getShortLanguageCode, normalizeIdentifierToLanguageCode, parseLangIdentifier } from '../utilities/Locale.js'
import { type WhisperAlignmentOptions } from '../recognition/WhisperSTT.js'
import { type SubtitlesConfig } from '../subtitles/Subtitles.js'

export async function alignTranslation(input: AudioSourceParam, translatedTranscript: string, options: TranslationAlignmentOptions, callbacks?: TranslationAlignmentCallbacks): Promise<TranslationAlignmentResult> {
	options = extendDeep(defaultTranslationAlignmentOptions, options)
	callbacks = { logLevel: API.getGlobalLogLevel(), ...callbacks }

	const logger = new Logger(callbacks.logLevel)

	const startTimestamp = logger.getTimestamp()

	const inputRawAudio = await ensureRawAudio(input, undefined, undefined, callbacks)

	let sourceRawAudio: RawAudio
	let isolatedRawAudio: RawAudio | undefined
	let backgroundRawAudio: RawAudio | undefined

	if (options.isolate) {
		logger.logTitledMessage(`Isolate vocals`, '');

		({ isolatedRawAudio, backgroundRawAudio } = await API.isolate(
			inputRawAudio,
			options.sourceSeparation!,
			{ ...callbacks, logLevel: logger.logLevel }))

		logger.end()

		logger.start(`Resample audio to 16kHz mono`)
		sourceRawAudio = await ensureRawAudio(isolatedRawAudio, 16000, 1, callbacks)
	} else {
		logger.start(`Resample audio to 16kHz mono`)
		sourceRawAudio = await ensureRawAudio(inputRawAudio, 16000, 1, callbacks)
	}

	let sourceUncropTimeline: Timeline | undefined

	if (options.crop) {
		logger.start('Crop using voice activity detection');
		({ timeline: sourceUncropTimeline, croppedRawAudio: sourceRawAudio } = await API.detectVoiceActivity(
			sourceRawAudio,
			options.vad!,
			{ ...callbacks, logLevel: 'warning' }))

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
		const { detectedLanguage } = await API.detectSpeechLanguage(
			sourceRawAudio,
			options.languageDetection!,
			{ ...callbacks, logLevel: 'warning' })

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
			const WhisperCommon = await import('../recognition/WhisperCommon.js')

			const shortSourceLanguageCode = getShortLanguageCode(sourceLanguage)
			const shortTargetLanguageCode = getShortLanguageCode(targetLanguage)

			if (shortTargetLanguageCode != 'en') {
				throw new Error('Whisper translation only supports English as target language')
			}

			if (shortSourceLanguageCode == 'en' && shortTargetLanguageCode == 'en') {
				throw new Error('Both translation source and target languages are English')
			}

			const whisperAlignmnentOptions: WhisperAlignmentOptions = extendDeep(WhisperSTT.defaultWhisperAlignmentOptions, options.whisper!)

			const { modelId, modelPath } = await WhisperCommon.loadModelPackage(
				whisperAlignmnentOptions.model,
				shortSourceLanguageCode,
				callbacks,
			)

			const { libPath } = await WhisperSTT.loadLibraryPackages(
				whisperAlignmnentOptions.enableGPU,
				callbacks,
			)

			logger.end()

			if (modelId.endsWith('.en')) {
				throw new Error('Whisper translation tasks are only possible with a multilingual model')
			}

			mappedTimeline = await WhisperSTT.alignEnglishTranslation(
				sourceRawAudio,
				translatedTranscript,
				modelId,
				modelPath,
				libPath,
				shortSourceLanguageCode,
				whisperAlignmnentOptions,
				callbacks
			)

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
	addWordTextOffsetsToTimelineInPlace(mappedTimeline, translatedTranscript)

	// Make segment timeline
	const { segmentTimeline } = await wordTimelineToSegmentSentenceTimeline(mappedTimeline, translatedTranscript, sourceLanguage, options.plainText?.paragraphBreaks, options.plainText?.whitespace)

	logger.end()
	logger.logDuration(`Total translation alignment time`, startTimestamp, 'info', chalk.magentaBright)

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

export interface TranslationAlignmentOptions extends API.OperationOptions {
	engine?: TranslationAlignmentEngine

	sourceLanguage?: string
	targetLanguage?: string

	isolate?: boolean

	crop?: boolean

	languageDetection?: API.SpeechLanguageDetectionOptions

	vad?: API.VoiceActivityDetectionOptions

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
		whitespace: 'preserve'
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

export interface TranslationAlignmentCallbacks extends API.OperationCallbacks {
}

export const translationAlignmentEngines: API.EngineMetadata[] = [
	{
		id: 'whisper',
		name: 'OpenAI Whisper',
		description: 'Extracts timestamps by guiding the Whisper recognition model to recognize the translated transcript tokens.',
		type: 'local'
	}
]
