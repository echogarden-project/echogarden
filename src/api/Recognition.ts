import { extendDeep } from '../utilities/ObjectUtilities.js'

import { logToStderr } from '../utilities/Utilities.js'
import { AudioSourceParam, RawAudio, ensureRawAudio, normalizeAudioLevelInPlace, trimAudioEnd } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'

import * as API from './API.js'
import { Timeline, addWordTextOffsetsToTimeline, wordTimelineToSegmentSentenceTimeline } from '../utilities/Timeline.js'
import { formatLanguageCodeWithName, parseLangIdentifier } from '../utilities/Locale.js'
import { loadPackage } from '../utilities/PackageManager.js'
import chalk from 'chalk'

import { type WhisperOptions } from '../recognition/WhisperSTT.js'
import { type SubtitlesConfig } from '../subtitles/Subtitles.js'
import { type OpenAICloudSTTOptions } from '../recognition/OpenAICloudSTT.js'
import { type WhisperCppOptions } from '../recognition/WhisperCppSTT.js'
import { type SileroRecognitionOptions } from '../recognition/SileroSTT.js'
import { OnnxExecutionProvider } from '../utilities/OnnxUtilities.js'

const log = logToStderr

export async function recognize(input: AudioSourceParam, options: RecognitionOptions): Promise<RecognitionResult> {
	const logger = new Logger()

	const startTimestamp = logger.getTimestamp()

	options = extendDeep(defaultRecognitionOptions, options)

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

	const engine = options.engine!

	if (options.language) {
		const languageData = await parseLangIdentifier(options.language)

		options.language = languageData.Name

		logger.end()
		logger.logTitledMessage('Language specified', formatLanguageCodeWithName(options.language))
	} else {
		logger.start('No language specified. Detect speech language')
		const { detectedLanguage } = await API.detectSpeechLanguage(sourceRawAudio, options.languageDetection!)

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

			const whisperOptions = options.whisper!

			logger.end()

			const { modelName, modelDir } = await WhisperSTT.loadPackagesAndGetPaths(whisperOptions.model, shortLanguageCode)

			logger.end();

			({ transcript, timeline } = await WhisperSTT.recognize(
				sourceRawAudio,
				modelName,
				modelDir,
				'transcribe',
				shortLanguageCode,
				whisperOptions
			))

			break
		}

		case 'whisper.cpp': {
			const WhisperCppSTT = await import('../recognition/WhisperCppSTT.js')

			const whisperCppOptions = options.whisperCpp!

			logger.end()

			const { modelName, modelPath } = await WhisperCppSTT.loadModelPackage(whisperCppOptions.model, shortLanguageCode)

			logger.end();

			({ transcript, timeline } = await WhisperCppSTT.recognize(
				sourceRawAudio,
				'transcribe',
				shortLanguageCode,
				modelName,
				modelPath,
				whisperCppOptions,
			))

			break
		}

		case 'vosk': {
			const VoskSTT = await import('../recognition/VoskSTT.js')

			try {
				await import('@echogarden/vosk')
			} catch (e) {
				log(e)
				throw new Error(`The vosk npm package, which is required for Vosk support, was not found, or had an error loading. If missing, you can install it by running 'npm install @echogarden/vosk -g'.`)
			}

			const voskOptions = options.vosk!

			const modelPath = voskOptions.modelPath

			if (!modelPath) {
				throw new Error(`Vosk models are not currently auto-downloaded. You'll need to download a model manually and set a model path in 'vosk.modelPath'.`)
			}

			logger.end();

			({ transcript, timeline } = await VoskSTT.recognize(sourceRawAudio, modelPath, true))

			break
		}

		case 'silero': {
			const SileroSTT = await import('../recognition/SileroSTT.js')

			const sileroOptions = options.silero!

			let modelPath = sileroOptions.modelPath

			if (!modelPath) {
				const packageName = SileroSTT.languageCodeToPackageName[shortLanguageCode]

				if (!packageName) {
					throw new Error(`Language '${shortLanguageCode}' is not supported by Silero`)
				}

				modelPath = await loadPackage(packageName)
			}

			const onnxExecutionProviders: OnnxExecutionProvider[] = sileroOptions.provider ? [sileroOptions.provider] : []

			logger.end();

			({ transcript, timeline } = await SileroSTT.recognize(
				sourceRawAudio,
				modelPath,
				onnxExecutionProviders))

			break
		}

		case 'google-cloud': {
			const GoogleCloudSTT = await import('../recognition/GoogleCloudSTT.js')

			const apiKey = options.googleCloud!.apiKey

			if (!apiKey) {
				throw new Error(`No API key given`)
			}

			logger.end();

			({ transcript, timeline } = await GoogleCloudSTT.recognize(sourceRawAudio, apiKey, shortLanguageCode))

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

			({ transcript, timeline } = await AzureCognitiveServicesSTT.recognize(sourceRawAudio, subscriptionKey, serviceRegion, shortLanguageCode))

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

			({ transcript, timeline } = await AmazonTranscribeSTT.recgonize(sourceRawAudio, shortLanguageCode, region, accessKeyId, secretAccessKey))

			break
		}

		case 'openai-cloud': {
			const OpenAICloudSTT = await import('../recognition/OpenAICloudSTT.js')

			const openAICloudSTTOptions = options.openAICloud!

			if (!openAICloudSTTOptions.apiKey) {
				throw new Error(`No OpanAI Cloud API key provided`)
			}

			logger.end();

			({ transcript, timeline } = await OpenAICloudSTT.recognize(sourceRawAudio, shortLanguageCode, openAICloudSTTOptions))

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

		const { wordTimeline } = await API.align(sourceRawAudio, transcript, alignmentOptions)

		timeline = wordTimeline
	}

	// If the audio was cropped before recognition, map the timestamps back to the original audio
	if (sourceUncropTimeline && sourceUncropTimeline.length > 0) {
		API.convertCroppedToUncroppedTimeline(timeline, sourceUncropTimeline)
	}

	// Add text offsets
	addWordTextOffsetsToTimeline(timeline, transcript)

	// Make segment timeline
	const { segmentTimeline } = await wordTimelineToSegmentSentenceTimeline(timeline, transcript, languageCode, 'single', 'preserve')

	logger.end()
	logger.logDuration('Total recognition time', startTimestamp, chalk.magentaBright)

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

export type RecognitionEngine = 'whisper' | 'whisper.cpp' | 'vosk' | 'silero' | 'google-cloud' | 'microsoft-azure' | 'amazon-transcribe' | 'openai-cloud'

export interface RecognitionOptions {
	engine?: RecognitionEngine

	language?: string

	maxAlternatives?: number

	isolate?: boolean

	crop?: boolean

	alignment?: API.AlignmentOptions

	languageDetection?: API.SpeechLanguageDetectionOptions

	subtitles?: SubtitlesConfig

	vad?: API.VADOptions

	sourceSeparation?: API.SourceSeparationOptions

	whisper?: WhisperOptions

	whisperCpp?: WhisperCppOptions

	vosk?: {
		modelPath?: string
	}

	silero?: SileroRecognitionOptions

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

	vosk: {
		modelPath: undefined
	},

	silero: {
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
}

export const recognitionEngines: API.EngineMetadata[] = [
	{
		id: 'whisper',
		name: 'OpenAI Whisper',
		description: 'A high accuracy transformer-based speech recognition architecture by OpenAI.',
		type: 'local'
	},
	{
		id: 'whisper.cpp',
		name: 'OpenAI Whisper (C++ port)',
		description: 'A C++ port of the Whisper speech recognition architecture.',
		type: 'local'
	},
	{
		id: 'vosk',
		name: 'Vosk',
		description: 'A speech recognition toolkit.',
		type: 'local'
	},
	{
		id: 'silero',
		name: 'Silero',
		description: 'Speech recognition models.',
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
]
