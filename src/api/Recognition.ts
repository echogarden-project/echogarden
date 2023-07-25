import { extendDeep } from "../utilities/ObjectUtilities.js"

import * as FFMpegTranscoder from "../codecs/FFMpegTranscoder.js"

import { logToStderr } from "../utilities/Utilities.js"
import { RawAudio, downmixToMonoAndNormalize, trimAudioEnd } from "../audio/AudioUtilities.js"
import { Logger } from "../utilities/Logger.js"
import { resampleAudioSpeex } from "../dsp/SpeexResampler.js"

import * as API from "./API.js"
import { Timeline } from "../utilities/Timeline.js"
import { whisperOptionsDefaults, type WhisperOptions } from "../recognition/WhisperSTT.js"
import { formatLanguageCodeWithName, getShortLanguageCode, normalizeLanguageCode } from "../utilities/Locale.js"
import { loadPackage } from "../utilities/PackageManager.js"
import chalk from "chalk"

const log = logToStderr

export async function recognizeFile(filename: string, options: RecognitionOptions) {
	const rawAudio = await FFMpegTranscoder.decodeToChannels(filename)
	return recognize(rawAudio, options)
}

export async function recognize(inputRawAudio: RawAudio, options: RecognitionOptions): Promise<RecognitionResult> {
	const logger = new Logger()
	const startTimestamp = logger.getTimestamp()

	logger.start("Prepare for recognition")

	options = extendDeep(defaultRecognitionOptions, options)

	const engine = options.engine!

	let sourceRawAudio = await resampleAudioSpeex(inputRawAudio, 16000)
	sourceRawAudio = downmixToMonoAndNormalize(sourceRawAudio)
	sourceRawAudio.audioChannels[0] = trimAudioEnd(sourceRawAudio.audioChannels[0], 0, -40)

	if (!options.language) { // && options.engine != "whisper") {
		logger.start("No language specified. Detecting speech language")
		const { detectedLanguage } = await API.detectSpeechLanguage(inputRawAudio, options.languageDetection || {})

		logger.end()
		logger.logTitledMessage('Language detected', formatLanguageCodeWithName(detectedLanguage))

		options.language = detectedLanguage
	}

	let language = normalizeLanguageCode(options.language)

	let transcript: string
	let timeline: Timeline | undefined

	logger.start(`Load ${engine} module`)

	switch (engine) {
		case "whisper": {
			const WhisperSTT = await import("../recognition/WhisperSTT.js")

			const whisperOptions = options.whisper!

			const shortLanguageCode = getShortLanguageCode(language)

			const { modelName, modelDir, tokenizerDir } = await WhisperSTT.loadPackagesAndGetPaths(whisperOptions.model, shortLanguageCode)

			if (shortLanguageCode != "en" && modelName.endsWith(".en")) {
				throw new Error(`The model '${modelName}' is English only and cannot transcribe language '${shortLanguageCode}'`)
			}

			logger.end();

			({ transcript, timeline } = await WhisperSTT.recognize(sourceRawAudio, modelName, modelDir, tokenizerDir, "transcribe", language, whisperOptions))

			break
		}

		case "vosk": {
			const VoskSTT = await import("../recognition/VoskSTT.js")

			try {
				await import('@echogarden/vosk')
			} catch (e) {
				log(e)
				throw new Error(`The vosk npm package, which is required for Vosk support, was not found, or had an error loading. If missing, you can install it by running 'npm install @echogarden/vosk -g'.`)
			}

			const voskOptions = options.vosk!

			const modelPath = voskOptions.modelPath

			if (!modelPath) {
				throw new Error("Vosk models are not currently auto-downloaded. You'll need to download a model manually and set a model path in 'vosk.modelPath'.")
			}

			logger.end();

			({ transcript, timeline } = await VoskSTT.recognize(sourceRawAudio, modelPath, true))

			break
		}

		case "silero": {
			const SileroSTT = await import("../recognition/SileroSTT.js")

			const sileroOptions = options.silero!

			let modelPath = sileroOptions.modelPath

			if (!modelPath) {
				const shortLanguageCode = getShortLanguageCode(language)
				const packageName = SileroSTT.languageCodeToPackageName[shortLanguageCode]

				if (!packageName) {
					throw new Error(`Language '${shortLanguageCode}' is not supported by Silero`)
				}

				modelPath = await loadPackage(packageName)
			}

			logger.end();

			({ transcript, timeline } = await SileroSTT.recognize(sourceRawAudio, modelPath))

			break
		}

		case "google-cloud": {
			const GoogleCloudSTT = await import("../recognition/GoogleCloudSTT.js")

			const apiKey = options.googleCloud!.apiKey

			if (!apiKey) {
				throw new Error(`No API key given`)
			}

			logger.end();

			({ transcript, timeline } = await GoogleCloudSTT.recognize(sourceRawAudio, apiKey, language))

			break
		}

		case "microsoft-azure": {
			const AzureCognitiveServicesSTT = await import("../recognition/AzureCognitiveServicesSTT.js")

			const subscriptionKey = options.microsoftAzure!.subscriptionKey

			if (!subscriptionKey) {
				throw new Error(`No subscription key given`)
			}

			const serviceRegion = options.microsoftAzure!.serviceRegion

			if (!serviceRegion) {
				throw new Error(`No service region given`)
			}

			logger.end();

			({ transcript, timeline } = await AzureCognitiveServicesSTT.recognize(sourceRawAudio, subscriptionKey, serviceRegion, language))

			break
		}

		case "amazon-transcribe": {
			const AmazonTranscribeSTT = await import("../recognition/AmazonTranscribeSTT.js")

			const region = options.amazonTranscribe!.region

			if (!region) {
				throw new Error(`No region given`)
			}

			const accessKeyId = options.amazonTranscribe!.accessKeyId

			if (!accessKeyId) {
				throw new Error(`No access key id given`)
			}

			const secretAccessKey = options.amazonTranscribe!.secretAccessKey

			if (!secretAccessKey) {
				throw new Error(`No secret access key given`)
			}

			logger.end();

			({ transcript, timeline } = await AmazonTranscribeSTT.recgonize(sourceRawAudio, language, region, accessKeyId, secretAccessKey))

			break
		}

		default: {
			throw new Error(`Engine '${options.engine}' is not supported`)
		}
	}

	if (!timeline) {
		logger.start(`Align audio to transcript`)
		const alignmentOptions: API.AlignmentOptions = extendDeep(options.alignment, { language: language })

		const { wordTimeline } = await API.align(sourceRawAudio, transcript, alignmentOptions)

		timeline = wordTimeline
	}

	logger.end()
	logger.logDuration('Total recognition time', startTimestamp, chalk.magentaBright)

	return { transcript, timeline, rawAudio: inputRawAudio, language }
}

export interface RecognitionResult {
	transcript: string
	timeline: Timeline
	rawAudio: RawAudio
	language: string
}

export type RecognitionEngine = "whisper" | "vosk" | "silero" | "google-cloud" | "microsoft-azure" | "amazon-transcribe"

export interface RecognitionOptions {
	engine?: RecognitionEngine

	language?: string

	maxAlternatives?: number

	alignment?: API.AlignmentOptions

	languageDetection?: API.SpeechLanguageDetectionOptions

	whisper?: WhisperOptions

	vosk?: {
		modelPath?: string
	}

	silero?: {
		modelPath?: string
	}

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
}

export const defaultRecognitionOptions: RecognitionOptions = {
	engine: "whisper",

	language: undefined,

	maxAlternatives: 1,

	alignment: undefined,

	languageDetection: undefined,

	whisper: whisperOptionsDefaults,

	vosk: {
		modelPath: undefined
	},

	silero: {
		modelPath: undefined
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
	}
}

export const recognitionEngines: API.EngineMetadata[] = [
	{
		id: 'whisper',
		name: 'OpenAI Whisper',
		description: 'A high accuracy transformer-based architecture by OpenAI.',
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
]
