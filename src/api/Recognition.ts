import chalk from 'chalk'

import * as API from './API.js'

import { extendDeep } from '../utilities/ObjectUtilities.js'

import { AudioSourceParam, RawAudio, ensureRawAudio, normalizeAudioLevelInPlace, trimAudioEnd } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'

import { Timeline, addWordTextOffsetsToTimelineInPlace, wordTimelineToSegmentSentenceTimeline } from '../utilities/Timeline.js'
import { formatLanguageCodeWithName, parseLangIdentifier } from '../utilities/Locale.js'

import { type WhisperOptions, type WhisperPartCallback, type WhisperTokenCallback } from '../recognition/WhisperSTT.js'
import { type SubtitlesConfig } from '../subtitles/Subtitles.js'
import { type OpenAICloudSTTOptions } from '../recognition/OpenAICloudSTT.js'
import { type WhisperCppCliOptions } from '../recognition/WhisperCppCliSTT.js'
import { type DeepgramSTTOptions } from '../recognition/DeepgramSTT.js'

export async function recognize(input: AudioSourceParam, options: RecognitionOptions, callbacks?: RecognitionCallbacks): Promise<RecognitionResult> {
	options = extendDeep(defaultRecognitionOptions, options)
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

	logger.end()

	let sourceUncropTimeline: Timeline | undefined

	if (options.crop) {
		logger.start('Crop using voice activity detection');

		({ timeline: sourceUncropTimeline, croppedRawAudio: sourceRawAudio } =
			await API.detectVoiceActivity(
				sourceRawAudio,
				options.vad!,
				{ ...callbacks, logLevel: 'warning' }))

		logger.end()
	}

	logger.start('Normalize and trim audio')

	normalizeAudioLevelInPlace(sourceRawAudio)
	sourceRawAudio.audioChannels[0] = trimAudioEnd(sourceRawAudio.audioChannels[0])

	const engine = options.engine!

	if (options.language) {
		const languageData = await parseLangIdentifier(options.language)

		options.language = languageData.Name

		logger.end()
		logger.logTitledMessage('Language specified', formatLanguageCodeWithName(options.language))
	} else {
		logger.start('No language specified. Detect speech language')
		const { detectedLanguage } = await API.detectSpeechLanguage(
			sourceRawAudio,
			options.languageDetection!,
			{ abortSignal: callbacks.abortSignal, logLevel: 'warning' })

		options.language = detectedLanguage

		logger.end()
		logger.logTitledMessage('Language detected', formatLanguageCodeWithName(detectedLanguage))
	}

	const languageData = await parseLangIdentifier(options.language)

	const languageCode = languageData.Name
	const shortLanguageCode = languageData.TwoLetterISOLanguageName

	let transcript: string
	let timeline: Timeline | undefined

	logger.start(`Load ${engine} module`)

	switch (engine) {
		case 'whisper': {
			const WhisperSTT = await import('../recognition/WhisperSTT.js')
			const WhisperCommon = await import('../recognition/WhisperCommon.js')

			const whisperOptions: WhisperOptions =
				extendDeep(WhisperSTT.defaultWhisperOptions, options.whisper)

			const { modelId, modelPath } = await WhisperCommon.loadModelPackage(
				whisperOptions.model,
				shortLanguageCode,
				callbacks,
			)

			const { libPath } = await WhisperSTT.loadLibraryPackages(
				whisperOptions.enableGPU,
				callbacks,
			)

			logger.end();

			({ transcript, timeline } = await WhisperSTT.recognize(
				sourceRawAudio,
				modelId,
				modelPath,
				libPath,
				'transcribe',
				shortLanguageCode,
				whisperOptions,
				callbacks,
			))

			break
		}

		case 'whisper.cpp': {
			const WhisperCppCliSTT = await import('../recognition/WhisperCppCliSTT.js')
			const WhisperCommon = await import('../recognition/WhisperCommon.js')

			const whisperCppOptions = options.whisperCpp!

			logger.end()

			const { modelId, modelPath } = await WhisperCommon.loadModelPackage(
				whisperCppOptions.model,
				shortLanguageCode,
				callbacks,
			)

			logger.end();

			({ transcript, timeline } = await WhisperCppCliSTT.recognize(
				sourceRawAudio,
				'transcribe',
				shortLanguageCode,
				modelId,
				modelPath,
				whisperCppOptions,
				callbacks,
			))

			break
		}

		case 'google-cloud': {
			const GoogleCloudSTT = await import('../recognition/GoogleCloudSTT.js')

			const apiKey = options.googleCloud!.apiKey

			if (!apiKey) {
				throw new Error(`No API key given`)
			}

			logger.end();

			({ transcript, timeline } = await GoogleCloudSTT.recognize(
				sourceRawAudio,
				apiKey,
				shortLanguageCode,
				callbacks
			))

			break
		}

		case 'microsoft-azure': {
			const AzureCognitiveServicesSTT = await import('../recognition/AzureCognitiveServicesSTT.js')

			const subscriptionKey = options.microsoftAzure!.subscriptionKey

			if (!subscriptionKey) {
				throw new Error(`No Microsoft Azure subscription key provided`)
			}

			const serviceRegion = options.microsoftAzure!.serviceRegion

			if (!serviceRegion) {
				throw new Error(`No Microsoft Azure service region provided`)
			}

			logger.end();

			({ transcript, timeline } = await AzureCognitiveServicesSTT.recognize(
				sourceRawAudio,
				subscriptionKey,
				serviceRegion,
				shortLanguageCode,
				undefined,
				callbacks
			))

			break
		}

		case 'amazon-transcribe': {
			const AmazonTranscribeSTT = await import('../recognition/AmazonTranscribeSTT.js')

			const region = options.amazonTranscribe!.region

			if (!region) {
				throw new Error(`No Amazon Transcribe region provided`)
			}

			const accessKeyId = options.amazonTranscribe!.accessKeyId

			if (!accessKeyId) {
				throw new Error(`No Amazon Transcribe access key id provided`)
			}

			const secretAccessKey = options.amazonTranscribe!.secretAccessKey

			if (!secretAccessKey) {
				throw new Error(`No Amazon Transcribe secret access key provided`)
			}

			logger.end();

			({ transcript, timeline } = await AmazonTranscribeSTT.recgonize(
				sourceRawAudio,
				languageCode,
				region,
				accessKeyId,
				secretAccessKey,
				callbacks
			))

			break
		}

		case 'openai-cloud': {
			const OpenAICloudSTT = await import('../recognition/OpenAICloudSTT.js')

			const openAICloudSTTOptions = options.openAICloud!

			if (!openAICloudSTTOptions.apiKey) {
				throw new Error(`No OpanAI Cloud API key provided`)
			}

			logger.end();

			({ transcript, timeline } = await OpenAICloudSTT.recognize(
				sourceRawAudio,
				shortLanguageCode,
				openAICloudSTTOptions,
				'transcribe',
				callbacks
			))

			break
		}

		case 'deepgram': {
			const DeepgramSTT = await import('../recognition/DeepgramSTT.js')

			const deepgramOptions = options.deepgram!

			if (!deepgramOptions.apiKey) {
				throw new Error(`No Deepgram API key provided`)
			}

			logger.end();

			({ transcript, timeline } = await DeepgramSTT.recognize(
				sourceRawAudio,
				options.language ? shortLanguageCode : undefined,
				deepgramOptions,
				callbacks,
			))

			break
		}

		default: {
			throw new Error(`Engine '${options.engine}' is not supported`)
		}
	}

	// If the engine didn't return a timeline, align to get it
	if (!timeline) {
		logger.start(`Align audio to transcript`)
		const alignmentOptions: API.AlignmentOptions = extendDeep(options.alignment, { language: languageCode })

		const { wordTimeline } = await API.align(
			sourceRawAudio,
			transcript,
			alignmentOptions,
			{ abortSignal: callbacks.abortSignal, logLevel: 'warning' },
		)

		timeline = wordTimeline
	}

	// If the audio was cropped before recognition, map the timestamps back to the original audio
	if (sourceUncropTimeline && sourceUncropTimeline.length > 0) {
		API.convertCroppedToUncroppedTimeline(timeline, sourceUncropTimeline)
	}

	// Add text offsets
	addWordTextOffsetsToTimelineInPlace(timeline, transcript)

	// Make segment timeline
	const { segmentTimeline } = await wordTimelineToSegmentSentenceTimeline(timeline, transcript, languageCode, 'single', 'preserve')

	logger.end()
	logger.logDuration('\nTotal recognition time', startTimestamp, 'info', chalk.magentaBright)

	return {
		transcript,

		timeline: segmentTimeline,
		wordTimeline: timeline,

		language: languageCode,

		inputRawAudio,
		isolatedRawAudio,
		backgroundRawAudio,
	}
}

export interface RecognitionResult {
	transcript: string

	timeline: Timeline
	wordTimeline: Timeline

	language: string

	inputRawAudio: RawAudio
	isolatedRawAudio?: RawAudio
	backgroundRawAudio?: RawAudio
}

export type RecognitionEngine = 'whisper' | 'whisper.cpp' | 'google-cloud' | 'microsoft-azure' | 'amazon-transcribe' | 'openai-cloud' | 'deepgram'

export interface RecognitionOptions extends API.OperationOptions {
	engine?: RecognitionEngine

	language?: string

	maxAlternatives?: number

	isolate?: boolean

	crop?: boolean

	alignment?: API.AlignmentOptions

	languageDetection?: API.SpeechLanguageDetectionOptions

	subtitles?: SubtitlesConfig

	vad?: API.VoiceActivityDetectionOptions

	sourceSeparation?: API.SourceSeparationOptions

	whisper?: WhisperOptions

	whisperCpp?: WhisperCppCliOptions

	googleCloud?: {
		apiKey?: string
		alternativeLanguageCodes?: string[]
		profanityFilter?: boolean
		autoPunctuation?: boolean
		useEnhancedModel?: boolean
	}

	microsoftAzure?: {
		subscriptionKey?: string
		serviceRegion?: string
	}

	amazonTranscribe?: {
		region?: string
		accessKeyId?: string
		secretAccessKey?: string
	}

	openAICloud?: OpenAICloudSTTOptions

	deepgram?: DeepgramSTTOptions
}

export const defaultRecognitionOptions: RecognitionOptions = {
	engine: 'whisper',

	language: undefined,

	maxAlternatives: 1,

	isolate: false,

	crop: true,

	alignment: {
	},

	languageDetection: {
	},

	subtitles: {
	},

	vad: {
		engine: 'adaptive-gate'
	},

	whisper: {
	},

	whisperCpp: {
	},

	googleCloud: {
		apiKey: undefined,
		alternativeLanguageCodes: [],
		profanityFilter: false,
		autoPunctuation: true,
		useEnhancedModel: true,
	},

	microsoftAzure: {
		subscriptionKey: undefined,
		serviceRegion: undefined
	},

	amazonTranscribe: {
		region: undefined,
		accessKeyId: undefined,
		secretAccessKey: undefined,
	},

	openAICloud: {
	},

	deepgram: {
	}
}

export interface RecognitionCallbacks extends API.OperationCallbacks {
	onPart?: WhisperPartCallback
	onToken?: WhisperTokenCallback
}

export const recognitionEngines: API.EngineMetadata[] = [
	{
		id: 'whisper',
		name: 'OpenAI Whisper',
		description: 'High accuracy transformer-based speech recognition architecture by OpenAI.',
		type: 'local'
	},
	{
		id: 'whisper.cpp',
		name: 'OpenAI Whisper (C++ port) CLI',
		description: 'Invokes the CLI version of the whisper.cpp port of OpenAI Whisper.',
		type: 'local'
	},
	{
		id: 'google-cloud',
		name: 'Google Cloud',
		description: 'Google Cloud speech-to-text service.',
		type: 'cloud'
	},
	{
		id: 'microsoft-azure',
		name: 'Azure Cognitive Services',
		description: 'Microsoft Azure speech-to-text service.',
		type: 'cloud'
	},
	{
		id: 'amazon-transcribe',
		name: 'Amazon Transcribe',
		description: 'Amazon cloud speech-to-text service.',
		type: 'cloud'
	},
	{
		id: 'openai-cloud',
		name: 'OpenAI Cloud',
		description: 'OpenAI cloud speech-to-text service.',
		type: 'cloud'
	},
	{
		id: 'deepgram',
		name: 'Deepgram',
		description: 'Deepgram cloud speech-to-text service.',
		type: 'cloud'
	},
]
