import chalk from 'chalk'

import * as API from './API.js'

import { extendDeep } from '../utilities/ObjectUtilities.js'

import { logToStderr } from '../utilities/Utilities.js'
import { AudioSourceParam, RawAudio, ensureRawAudio, normalizeAudioLevelInPlace, trimAudioEnd } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'

import { Timeline, addWordTextOffsetsToTimelineInPlace, wordTimelineToSegmentSentenceTimeline } from '../utilities/Timeline.js'
import { type WhisperOptions, type WhisperPartCallback, type WhisperTokenCallback  } from '../recognition/WhisperSTT.js'
import { formatLanguageCodeWithName, getShortLanguageCode, normalizeIdentifierToLanguageCode, parseLangIdentifier } from '../utilities/Locale.js'
import { type EngineMetadata } from './Common.js'
import { type SpeechLanguageDetectionOptions, detectSpeechLanguage } from './API.js'
import { type SubtitlesConfig } from '../subtitles/Subtitles.js'

import { type OpenAICloudSTTOptions } from '../recognition/OpenAICloudSTT.js'
import { type WhisperCppCliOptions } from '../recognition/WhisperCppCliSTT.js'

const log = logToStderr

/////////////////////////////////////////////////////////////////////////////////////////////
// Speech translation
/////////////////////////////////////////////////////////////////////////////////////////////
export async function translateSpeech(input: AudioSourceParam, options: SpeechTranslationOptions, callbacks?: SpeechTranslationCallbacks): Promise<SpeechTranslationResult> {
	options = extendDeep(defaultSpeechTranslationOptions, options)
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

	if (options.sourceLanguage) {
		const languageData = await parseLangIdentifier(options.sourceLanguage)

		options.sourceLanguage = languageData.Name

		logger.end()
		logger.logTitledMessage('Source language specified', formatLanguageCodeWithName(options.sourceLanguage))
	} else {
		logger.start('No source language specified. Detect speech language')
		const { detectedLanguage } = await detectSpeechLanguage(
			sourceRawAudio,
			options.languageDetection!,
			{ abortSignal: callbacks.abortSignal, logLevel: 'warning' }
		)

		options.sourceLanguage = detectedLanguage

		logger.end()
		logger.logTitledMessage('Source language detected', formatLanguageCodeWithName(detectedLanguage))
	}

	options.targetLanguage = await normalizeIdentifierToLanguageCode(options.targetLanguage!)

	logger.logTitledMessage('Target language', formatLanguageCodeWithName(options.targetLanguage))

	logger.start('Preprocess audio for translation')

	const engine = options.engine!
	const sourceLanguage = options.sourceLanguage!
	const targetLanguage = options.targetLanguage!

	let transcript: string
	let wordTimeline: Timeline | undefined
	let segmentTimeline: Timeline | undefined

	logger.start(`Load ${engine} module`)

	switch (engine) {
		case 'whisper': {
			const WhisperSTT = await import('../recognition/WhisperSTT.js')
			const WhisperCommon = await import('../recognition/WhisperCommon.js')

			const whisperOptions: WhisperOptions =  extendDeep(WhisperSTT.defaultWhisperOptions, options.whisper!)

			const shortSourceLanguageCode = getShortLanguageCode(sourceLanguage)
			const shortTargetLanguageCode = getShortLanguageCode(targetLanguage)

			if (shortTargetLanguageCode != 'en') {
				throw new Error('Whisper translation only supports English as target language')
			}

			if (shortSourceLanguageCode == 'en' && shortTargetLanguageCode == 'en') {
				throw new Error('Both translation source and target languages are English')
			}

			const { modelId, modelPath } = await WhisperCommon.loadModelPackage(
				whisperOptions.model,
				shortSourceLanguageCode,
				callbacks,
			)

			const { libPath } = await WhisperSTT.loadLibraryPackages(
				whisperOptions.enableGPU,
				callbacks,
			)

			if (modelId.endsWith('.en')) {
				throw new Error(`Whisper translation task is not supported with model '${modelId}', since it's not multilingual model.`)
			}

			logger.end();

			({ transcript, timeline: wordTimeline } = await WhisperSTT.recognize(
				sourceRawAudio,
				modelId,
				modelPath,
				libPath,
				'translate',
				sourceLanguage,
				whisperOptions,
				callbacks,
			))

			break
		}

		case 'whisper.cpp': {
			const WhisperCppCliSTT = await import('../recognition/WhisperCppCliSTT.js')
			const WhisperCommon = await import('../recognition/WhisperCommon.js')

			const whisperCppCliOptions = options.whisperCpp!

			const shortSourceLanguageCode = getShortLanguageCode(sourceLanguage)
			const shortTargetLanguageCode = getShortLanguageCode(targetLanguage)

			logger.end()

			const { modelId, modelPath } = await WhisperCommon.loadModelPackage(
				whisperCppCliOptions.model,
				shortSourceLanguageCode,
				callbacks,
			)

			if (shortTargetLanguageCode != 'en') {
				throw new Error('Whisper.cpp translation only supports English as target language')
			}

			if (modelId.endsWith('.en')) {
				throw new Error('Whisper.cpp translation tasks are only possible with a multilingual model')
			}

			logger.end();

			({ transcript, timeline: wordTimeline } = await WhisperCppCliSTT.recognize(
				sourceRawAudio,
				'translate',
				shortSourceLanguageCode,
				modelId,
				modelPath,
				whisperCppCliOptions,
				callbacks,
			))

			break
		}

		case 'openai-cloud': {
			const OpenAICloudSTT = await import('../recognition/OpenAICloudSTT.js')

			const openAICloudSTTOptions = options.openAICloud!

			if (!openAICloudSTTOptions.apiKey) {
				throw new Error(`No OpenAI Cloud API key provided`)
			}

			const shortSourceLanguageCode = getShortLanguageCode(sourceLanguage)
			const shortTargetLanguageCode = getShortLanguageCode(targetLanguage)

			if (shortTargetLanguageCode != 'en') {
				throw new Error('OpenAI cloud speech translation only supports English as target language')
			}

			logger.end();

			({ transcript, timeline: segmentTimeline } = await OpenAICloudSTT.recognize(
				sourceRawAudio,
				shortSourceLanguageCode,
				openAICloudSTTOptions,
				'translate',
				callbacks,
			))

			break
		}

		default: {
			throw new Error(`Engine '${options.engine}' is not supported`)
		}
	}

	logger.end()

	// If the audio was cropped before recognition, map the timestamps back to the original audio
	if (sourceUncropTimeline && sourceUncropTimeline.length > 0) {
		if (wordTimeline) {
			API.convertCroppedToUncroppedTimeline(wordTimeline, sourceUncropTimeline)
		} else if (segmentTimeline) {
			API.convertCroppedToUncroppedTimeline(segmentTimeline, sourceUncropTimeline)
		}
	}

	if (wordTimeline) {
		addWordTextOffsetsToTimelineInPlace(wordTimeline, transcript)
	}

	if (!segmentTimeline) {
		({ segmentTimeline } = await wordTimelineToSegmentSentenceTimeline(wordTimeline!, transcript, targetLanguage, 'single', 'preserve'))
	}

	logger.log('')
	logger.logDuration(`Total speech translation time`, startTimestamp, 'info', chalk.magentaBright)

	return {
		transcript,
		timeline: segmentTimeline,
		wordTimeline,

		sourceLanguage,
		targetLanguage,

		inputRawAudio,
		isolatedRawAudio,
		backgroundRawAudio,
	}
}

export interface SpeechTranslationResult {
	transcript: string
	timeline: Timeline
	wordTimeline?: Timeline

	sourceLanguage: string
	targetLanguage: string

	inputRawAudio: RawAudio
	isolatedRawAudio?: RawAudio
	backgroundRawAudio?: RawAudio
}

export type SpeechTranslationEngine = 'whisper' | 'whisper.cpp' | 'openai-cloud'

export interface SpeechTranslationOptions extends API.OperationOptions {
	engine?: SpeechTranslationEngine

	sourceLanguage?: string
	targetLanguage?: string

	crop?: boolean
	isolate?: boolean

	languageDetection?: SpeechLanguageDetectionOptions
	subtitles?: SubtitlesConfig
	vad?: API.VoiceActivityDetectionOptions
	sourceSeparation?: API.SourceSeparationOptions

	whisper?: WhisperOptions
	whisperCpp?: WhisperCppCliOptions
	openAICloud?: OpenAICloudSTTOptions
}

export const defaultSpeechTranslationOptions: SpeechTranslationOptions = {
	engine: 'whisper',

	sourceLanguage: undefined,
	targetLanguage: 'en',

	crop: true,
	isolate: false,

	languageDetection: undefined,

	subtitles: {
	},

	vad: {
		engine: 'adaptive-gate'
	},

	whisper: {
	},

	whisperCpp: {
	},

	openAICloud: {
	},
}

export interface SpeechTranslationCallbacks extends API.OperationCallbacks {
	onPart?: WhisperPartCallback
	onToken?: WhisperTokenCallback
}

export const speechTranslationEngines: EngineMetadata[] = [
	{
		id: 'whisper',
		name: 'OpenAI Whisper',
		description: `Uses Whisper's speech translation capability to produce an English transcript from speech in a different language.`,
		type: 'local'
	},
	{
		id: 'whisper.cpp',
		name: 'OpenAI Whisper (C++ port) CLI',
		description: `Uses Whisper's speech translation capability to produce an English transcript from speech in a different language.`,
		type: 'local'
	},
	{
		id: 'openai-cloud',
		name: 'OpenAI Cloud',
		description: 'Speech translation cloud service provided by OpenAI. Only support English as target language.',
		type: 'cloud'
	}
]
