import chalk from 'chalk'
import * as API from './API.js'

import { deepClone, extendDeep } from '../utilities/ObjectUtilities.js'

import { AudioSourceParam, RawAudio, ensureRawAudio, getRawAudioDuration, normalizeAudioLevelInPlace, sliceRawAudioByTime, trimAudioEnd } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'

import { type WhisperLanguageDetectionOptions } from '../recognition/WhisperSTT.js'
import { formatLanguageCodeWithName, languageCodeToName } from '../utilities/Locale.js'
import { loadPackage } from '../utilities/PackageManager.js'
import { type WhisperCppCliOptions } from '../recognition/WhisperCppCliSTT.js'
import { type SileroLanguageDetectionOptions } from '../speech-language-detection/SileroLanguageDetection.js'
import { OnnxExecutionProvider } from '../utilities/OnnxUtilities.js'
import { LanguageDetectionResults } from './LanguageDetectionCommon.js'
import { joinPath } from '../utilities/PathUtilities.js'

export async function detectSpeechLanguage(input: AudioSourceParam, options: SpeechLanguageDetectionOptions, callbacks?: SpeechLanguageDetectionCallbacks): Promise<SpeechLanguageDetectionResult> {
	options = extendDeep(defaultSpeechLanguageDetectionOptions, options)
	callbacks = { logLevel: API.getGlobalLogLevel(), ...callbacks }

	const logger = new Logger(callbacks.logLevel)

	const startTime = logger.getTimestamp()

	const inputRawAudio = await ensureRawAudio(input, undefined, undefined, callbacks)

	logger.start(`Resample audio to 16kHz mono`)
	let sourceRawAudio = await ensureRawAudio(inputRawAudio, 16000, 1, callbacks)
	normalizeAudioLevelInPlace(sourceRawAudio)
	sourceRawAudio.audioChannels[0] = trimAudioEnd(sourceRawAudio.audioChannels[0])

	if (options.crop) {
		logger.start('Crop using voice activity detection');
		({ croppedRawAudio: sourceRawAudio } = await API.detectVoiceActivity(
			sourceRawAudio,
			options.vad!,
			{ ...callbacks, logLevel: 'warning' }))

		logger.end()
	}

	logger.start(`Initialize ${options.engine} module`)

	const defaultLanguage = options.defaultLanguage!
	const fallbackThresholdProbability = options.fallbackThresholdProbability!

	let detectedLanguageProbabilities: LanguageDetectionResults

	switch (options.engine) {
		case 'silero': {
			const SileroLanguageDetection = await import('../speech-language-detection/SileroLanguageDetection.js')

			logger.end()

			const sileroOptions = options.silero!

			const modelDir = await loadPackage('silero-lang-classifier-95', callbacks)

			const modelPath = joinPath(modelDir, 'lang_classifier_95.onnx')
			const languageDictionaryPath = joinPath(modelDir, 'lang_dict_95.json')
			const languageGroupDictionaryPath = joinPath(modelDir, 'lang_group_dict_95.json')
			const onnxExecutionProviders: OnnxExecutionProvider[] = sileroOptions.provider ? [sileroOptions.provider] : []

			const languageResults = await SileroLanguageDetection.detectLanguage(
				sourceRawAudio,
				modelPath,
				languageDictionaryPath,
				languageGroupDictionaryPath,
				onnxExecutionProviders,
				callbacks,
			)

			detectedLanguageProbabilities = languageResults

			break
		}

		case 'whisper': {
			const WhisperSTT = await import('../recognition/WhisperSTT.js')
			const WhisperCommon = await import('../recognition/WhisperCommon.js')

			const whisperOptions = extendDeep(WhisperSTT.defaultWhisperLanguageDetectionOptions, options.whisper!)

			const { modelId, modelPath } = await WhisperCommon.loadModelPackage(
				whisperOptions.model,
				undefined,
				callbacks,
			)

			const { libPath } = await WhisperSTT.loadLibraryPackages(
				whisperOptions.enableGPU,
				callbacks,
			)

			logger.end()

			detectedLanguageProbabilities = await WhisperSTT.detectLanguage(
				sourceRawAudio,
				modelId,
				modelPath,
				libPath,
				whisperOptions,
				callbacks,
			)

			break
		}

		case 'whisper.cpp': {
			const WhisperCppCliSTT = await import('../recognition/WhisperCppCliSTT.js')
			const WhisperCommon = await import('../recognition/WhisperCommon.js')

			const whisperCppCliOptions = options.whisperCpp!

			logger.end()

			const { modelId, modelPath } = await WhisperCommon.loadModelPackage(
				whisperCppCliOptions.model,
				undefined,
				callbacks,
			)

			logger.end();

			detectedLanguageProbabilities = await WhisperCppCliSTT.detectLanguage(
				sourceRawAudio,
				modelId,
				modelPath,
				callbacks,
			)

			break
		}

		default: {
			throw new Error(`Engine '${options.engine}' is not supported`)
		}
	}

	let detectedLanguage: string

	if (detectedLanguageProbabilities.length == 0 ||
		detectedLanguageProbabilities[0].probability < fallbackThresholdProbability) {

		detectedLanguage = defaultLanguage
	} else {
		detectedLanguage = detectedLanguageProbabilities[0].language
	}

	logger.end()
	logger.logDuration('\nTotal language detection time', startTime, 'info', chalk.magentaBright)

	return {
		detectedLanguage,
		detectedLanguageName: languageCodeToName(detectedLanguage),
		detectedLanguageProbabilities,

		inputRawAudio,
	}
}

export interface SpeechLanguageDetectionResult {
	detectedLanguage: string
	detectedLanguageName: string
	detectedLanguageProbabilities: LanguageDetectionResults
	inputRawAudio: RawAudio
}

export async function detectSpeechLanguageByParts(sourceRawAudio: RawAudio, getResultsForAudioPart: (audioPart: RawAudio) => Promise<LanguageDetectionResults>, maxAudioPartDuration = 30, hopDuration = 25, callbacks?: SpeechLanguageDetectionCallbacks) {
	callbacks = { logLevel: API.getGlobalLogLevel(), ...callbacks }
	const logger = new Logger(callbacks.logLevel)

	const audioDuration = getRawAudioDuration(sourceRawAudio)

	if (audioDuration === 0) {
		return []
	}

	const resultsForParts: LanguageDetectionResults[] = []

	for (let audioTimeOffset = 0; audioTimeOffset < audioDuration; audioTimeOffset += hopDuration) {
		callbacks?.abortSignal?.throwIfAborted()

		const startTimeOffset = audioTimeOffset
		const endTimeOffset = Math.min(audioTimeOffset + maxAudioPartDuration, audioDuration)
		const audioPartDuration = endTimeOffset - startTimeOffset

		logger.logTitledMessage(`\nDetect speech language starting at audio offset`, `${startTimeOffset.toFixed(1)}`, 'info', chalk.magentaBright)
		const audioPart = sliceRawAudioByTime(sourceRawAudio, startTimeOffset, endTimeOffset)

		const resultsForPart = await getResultsForAudioPart(audioPart)

		resultsForParts.push(resultsForPart)

		const sortedResultsForPart = deepClone(resultsForPart).sort((a, b) => b.probability - a.probability)

		let topCandidatesStrings: string[] = []

		for (let i = 0; i < Math.min(3, sortedResultsForPart.length); i++) {
			topCandidatesStrings.push(`${formatLanguageCodeWithName(sortedResultsForPart[i].language)}: ${sortedResultsForPart[i].probability.toFixed(3)}`)
		}

		logger.logTitledMessage(`Top candidates`, topCandidatesStrings.join(', '))

		if (callbacks?.onPart) {
			callbacks.onPart(sortedResultsForPart, startTimeOffset, endTimeOffset)
		}

		if (audioPartDuration < maxAudioPartDuration) {
			break
		}
	}

	const averagedResults: LanguageDetectionResults = deepClone(resultsForParts[0])
	averagedResults.forEach(entry => { entry.probability = 0.0 })

	for (const partResults of resultsForParts) {
		for (let i = 0; i < partResults.length; i++) {
			averagedResults[i].probability += partResults[i].probability
		}
	}

	for (const result of averagedResults) {
		result.probability /= resultsForParts.length
	}

	return averagedResults
}

export type SpeechLanguageDetectionEngine = 'silero' | 'whisper' | 'whisper.cpp'

export interface SpeechLanguageDetectionOptions extends API.OperationOptions {
	engine?: SpeechLanguageDetectionEngine
	defaultLanguage?: string,
	fallbackThresholdProbability?: number

	crop?: boolean

	silero?: SileroLanguageDetectionOptions

	whisper?: WhisperLanguageDetectionOptions

	whisperCpp?: WhisperCppCliOptions

	vad?: API.VoiceActivityDetectionOptions
}

export const defaultSpeechLanguageDetectionOptions: SpeechLanguageDetectionOptions = {
	engine: 'whisper',
	defaultLanguage: 'en',
	fallbackThresholdProbability: 0.05,

	crop: true,

	silero: {
	},

	whisper: {
		model: 'tiny',
		temperature: 1.0
	},

	whisperCpp: {
		model: 'tiny'
	},

	vad: {
		engine: 'adaptive-gate'
	}
}

export interface SpeechLanguageDetectionCallbacks extends API.OperationCallbacks {
	onPart?: SpeechLanguageDetectionPartCallback
}

export type SpeechLanguageDetectionPartCallback = (partResults: LanguageDetectionResults, partStartTime: number, partEndTime: number) => Promise<void>

export const speechLanguageDetectionEngines: API.EngineMetadata[] = [
	{
		id: 'silero',
		name: 'Silero',
		description: 'A speech language classification model by Silero.',
		type: 'local'
	},
	{
		id: 'whisper',
		name: 'OpenAI Whisper',
		description: 'Uses the language tokens produced by the Whisper model to classify the spoken langauge.',
		type: 'local'
	},
	{
		id: 'whisper.cpp',
		name: 'OpenAI Whisper (C++ port) CLI',
		description: 'Uses the language tokens produced by whisper.cpp to classify the spoken langauge.',
		type: 'local'
	},
]
