import { extendDeep } from '../utilities/ObjectUtilities.js'

import { logToStderr } from '../utilities/Utilities.js'
import { AudioSourceParam, RawAudio, ensureRawAudio, normalizeAudioLevel, trimAudioEnd } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'

import { Timeline, addWordTextOffsetsToTimeline, wordTimelineToSegmentSentenceTimeline } from '../utilities/Timeline.js'
import { defaultWhisperOptions, type WhisperOptions } from '../recognition/WhisperSTT.js'
import { formatLanguageCodeWithName, getShortLanguageCode, normalizeLanguageCode } from '../utilities/Locale.js'
import { EngineMetadata } from './Common.js'
import { SpeechLanguageDetectionOptions, detectSpeechLanguage } from './API.js'
import chalk from 'chalk'
import { SubtitlesConfig, defaultSubtitlesBaseConfig } from '../subtitles/Subtitles.js'

import * as API from './API.js'
import { OpenAICloudSTTOptions, defaultOpenAICloudSTTOptions } from '../recognition/OpenAICloudSTT.js'
import { WhisperCppOptions, defaultWhisperCppOptions } from '../recognition/WhisperCppSTT.js'

const log = logToStderr

/////////////////////////////////////////////////////////////////////////////////////////////
// Speech translation
/////////////////////////////////////////////////////////////////////////////////////////////
export async function translateSpeech(input: AudioSourceParam, options: SpeechTranslationOptions): Promise<SpeechTranslationResult> {
	const logger = new Logger()

	const startTimestamp = logger.getTimestamp()

	options = extendDeep(defaultSpeechTranslationOptions, options)

	const inputRawAudio = await ensureRawAudio(input)

	let sourceRawAudio: RawAudio
	let isolatedRawAudio: RawAudio | undefined
	let backgroundRawAudio: RawAudio | undefined

	if (options.isolate) {
		logger.log(``)
		logger.end();

		({ isolatedRawAudio, backgroundRawAudio } = await API.isolate(inputRawAudio, options.separation!))

		logger.end()
		logger.log(``)

		sourceRawAudio = await ensureRawAudio(isolatedRawAudio, 16000, 1)
	} else {
		sourceRawAudio = await ensureRawAudio(inputRawAudio, 16000, 1)
	}

	let sourceUncropTimeline: Timeline | undefined

	if (options.crop) {
		logger.start('Crop using voice activity detection');
		({ timeline: sourceUncropTimeline, croppedRawAudio: sourceRawAudio } = await API.detectVoiceActivity(sourceRawAudio, options.vad!))

		logger.end()
	}

	logger.start('Prepare for speech translation')

	sourceRawAudio = normalizeAudioLevel(sourceRawAudio)
	sourceRawAudio.audioChannels[0] = trimAudioEnd(sourceRawAudio.audioChannels[0])

	if (!options.sourceLanguage) {
		logger.start('No source language specified. Detecting speech language')
		const { detectedLanguage } = await detectSpeechLanguage(sourceRawAudio, options.languageDetection || {})

		logger.end()
		logger.logTitledMessage('Language detected', formatLanguageCodeWithName(detectedLanguage))

		options.sourceLanguage = detectedLanguage
	}

	logger.start('Preprocess audio for translation')

	const engine = options.engine!
	const sourceLanguage = normalizeLanguageCode(options.sourceLanguage!)
	const targetLanguage = options.targetLanguage!

	let transcript: string
	let wordTimeline: Timeline | undefined
	let segmentTimeline: Timeline | undefined

	logger.start(`Load ${engine} module`)

	switch (engine) {
		case 'whisper': {
			const WhisperSTT = await import('../recognition/WhisperSTT.js')

			const whisperOptions = options.whisper!

			const shortSourceLanguageCode = getShortLanguageCode(sourceLanguage)
			const shortTargetLanguageCode = getShortLanguageCode(targetLanguage)

			const { modelName, modelDir } = await WhisperSTT.loadPackagesAndGetPaths(whisperOptions.model, shortSourceLanguageCode)

			if (shortTargetLanguageCode != 'en') {
				throw new Error('Whisper translation only supports English as target language')
			}

			if (modelName.endsWith('.en')) {
				throw new Error('Whisper translation tasks are only possible with a multilingual model')
			}

			if (shortSourceLanguageCode == 'en' && shortTargetLanguageCode == 'en') {
				throw new Error('Both translation source and target languages are English')
			}

			logger.end();

			({ transcript, timeline: wordTimeline } = await WhisperSTT.recognize(sourceRawAudio, modelName, modelDir, 'translate', sourceLanguage, whisperOptions))

			addWordTextOffsetsToTimeline(wordTimeline, transcript);

			({ segmentTimeline } = await wordTimelineToSegmentSentenceTimeline(wordTimeline, transcript, targetLanguage, 'single', 'preserve'))

			break
		}

		case 'whisper.cpp': {
			const WhisperCppSTT = await import('../recognition/WhisperCppSTT.js')

			const whisperCppOptions = options.whisperCpp!

			const shortSourceLanguageCode = getShortLanguageCode(sourceLanguage)
			const shortTargetLanguageCode = getShortLanguageCode(targetLanguage)

			logger.end()

			const { modelName, modelPath } = await WhisperCppSTT.loadPackagesAndGetPaths(whisperCppOptions.model, shortSourceLanguageCode)

			if (shortTargetLanguageCode != 'en') {
				throw new Error('Whisper.cpp translation only supports English as target language')
			}

			if (modelName.endsWith('.en')) {
				throw new Error('Whisper.cpp translation tasks are only possible with a multilingual model')
			}

			const executablePath = await WhisperCppSTT.loadPackageAndGetExecutablePath(whisperCppOptions.executablePath)

			logger.end();

			({ transcript, timeline: wordTimeline } = await WhisperCppSTT.recognize(
				sourceRawAudio,
				'translate',
				shortSourceLanguageCode,
				executablePath,
				modelName,
				modelPath,
				whisperCppOptions,
			));

			({ segmentTimeline } = await wordTimelineToSegmentSentenceTimeline(wordTimeline, transcript, targetLanguage, 'single', 'preserve'))

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

			({ transcript, timeline: segmentTimeline } = await OpenAICloudSTT.recognize(sourceRawAudio, shortSourceLanguageCode, openAICloudSTTOptions, 'translate'))

			break
		}

		default: {
			throw new Error(`Engine '${options.engine}' is not supported`)
		}
	}

	logger.end()

	// If the audio was cropped before recognition, map the timestamps back to the original audio
	if (sourceUncropTimeline && sourceUncropTimeline.length > 0) {
		API.convertCroppedToUncroppedTimeline(segmentTimeline, sourceUncropTimeline)

		if (wordTimeline) {
			API.convertCroppedToUncroppedTimeline(wordTimeline, sourceUncropTimeline)
		}
	}

	logger.log('')
	logger.logDuration(`Total speech translation time`, startTimestamp, chalk.magentaBright)

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

export interface SpeechTranslationOptions {
	engine?: SpeechTranslationEngine

	sourceLanguage?: string
	targetLanguage?: string

	crop?: boolean
	isolate?: boolean

	languageDetection?: SpeechLanguageDetectionOptions
	subtitles?: SubtitlesConfig
	vad?: API.VADOptions
	separation?: API.SourceSeparationOptions

	whisper?: WhisperOptions
	whisperCpp?: WhisperCppOptions
	openAICloud?: OpenAICloudSTTOptions
}

export const defaultSpeechTranslationOptions: SpeechTranslationOptions = {
	engine: 'whisper',

	sourceLanguage: undefined,
	targetLanguage: 'en',

	crop: true,
	isolate: false,

	languageDetection: undefined,

	subtitles: defaultSubtitlesBaseConfig,

	vad: {
		engine: 'adaptive-gate'
	},

	whisper: defaultWhisperOptions,
	whisperCpp: defaultWhisperCppOptions,
	openAICloud: defaultOpenAICloudSTTOptions,
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
		name: 'OpenAI Whisper (C++ port)',
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
