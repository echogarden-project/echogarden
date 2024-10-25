import { deepClone, extendDeep } from '../utilities/ObjectUtilities.js'

import { AudioSourceParam, RawAudio, ensureRawAudio, getRawAudioDuration, normalizeAudioLevelInPlace, sliceRawAudioByTime, trimAudioEnd } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'

import * as API from './API.js'
import { logToStderr } from '../utilities/Utilities.js'
import { type WhisperLanguageDetectionOptions } from '../recognition/WhisperSTT.js'
import { formatLanguageCodeWithName, languageCodeToName } from '../utilities/Locale.js'
import { loadPackage } from '../utilities/PackageManager.js'
import chalk from 'chalk'
import { type WhisperCppOptions } from '../recognition/WhisperCppSTT.js'
import { type SileroLanguageDetectionOptions } from '../speech-language-detection/SileroLanguageDetection.js'
import { OnnxExecutionProvider } from '../utilities/OnnxUtilities.js'
import { LanguageDetectionResults } from './LanguageDetectionCommon.js'
import { joinPath } from '../utilities/PathUtilities.js'

const log = logToStderr

export async function detectSpeechLanguage(input: AudioSourceParam, options: SpeechLanguageDetectionOptions): Promise<SpeechLanguageDetectionResult> {
	const logger = new Logger()

	const startTime = logger.getTimestamp()

	options = extendDeep(defaultSpeechLanguageDetectionOptions, options)

	const inputRawAudio = await ensureRawAudio(input)

	logger.start(`Resample audio to 16kHz mono`)
	let sourceRawAudio = await ensureRawAudio(inputRawAudio, 16000, 1)
	normalizeAudioLevelInPlace(sourceRawAudio)
	sourceRawAudio.audioChannels[0] = trimAudioEnd(sourceRawAudio.audioChannels[0])

	if (options.crop) {
		logger.start('Crop using voice activity detection');
		({ croppedRawAudio: sourceRawAudio } = await API.detectVoiceActivity(sourceRawAudio, options.vad!))

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

			const modelDir = await loadPackage('silero-lang-classifier-95')

			const modelPath = joinPath(modelDir, 'lang_classifier_95.onnx')
			const languageDictionaryPath = joinPath(modelDir, 'lang_dict_95.json')
			const languageGroupDictionaryPath = joinPath(modelDir, 'lang_group_dict_95.json')
			const onnxExecutionProviders: OnnxExecutionProvider[] = sileroOptions.provider ? [sileroOptions.provider] : []

			const languageResults = await SileroLanguageDetection.detectLanguage(
				sourceRawAudio,
				modelPath,
				languageDictionaryPath,
				languageGroupDictionaryPath,
				onnxExecutionProviders)

			detectedLanguageProbabilities = languageResults

			break
		}

		case 'whisper': {
			const WhisperSTT = await import('../recognition/WhisperSTT.js')

			const whisperOptions = options.whisper!

			const { modelName, modelDir } = await WhisperSTT.loadPackagesAndGetPaths(whisperOptions.model, undefined)

			logger.end()

			detectedLanguageProbabilities = await WhisperSTT.detectLanguage(
				sourceRawAudio,
				modelName,
				modelDir,
				whisperOptions)

			break
		}

		case 'whisper.cpp': {
			const WhisperCppSTT = await import('../recognition/WhisperCppSTT.js')

			const whisperCppOptions = options.whisperCpp!

			logger.end()

			const { modelName, modelPath } = await WhisperCppSTT.loadModelPackage(whisperCppOptions.model, undefined)

			logger.end();

			detectedLanguageProbabilities = await WhisperCppSTT.detectLanguage(sourceRawAudio, modelName, modelPath)

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
	logger.logDuration('\nTotal language detection time', startTime, chalk.magentaBright)

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

export async function detectSpeechLanguageByParts(sourceRawAudio: RawAudio, getResultsForAudioPart: (audioPart: RawAudio) => Promise<LanguageDetectionResults>, audioPartDuration = 30, hopDuration = 25) {
	const logger = new Logger()

	const audioDuration = getRawAudioDuration(sourceRawAudio)

	if (audioDuration === 0) {
		return []
	}

	const resultsForParts: LanguageDetectionResults[] = []

	for (let audioTimeOffset = 0; audioTimeOffset < audioDuration; audioTimeOffset += hopDuration) {
		const startOffset = audioTimeOffset
		const endOffset = Math.min(audioTimeOffset + audioPartDuration, audioDuration)
		const audioPartLength = endOffset - startOffset

		logger.logTitledMessage(`\nDetect speech language starting at audio offset`, `${startOffset.toFixed(1)}`, chalk.magentaBright)
		const audioPart = sliceRawAudioByTime(sourceRawAudio, startOffset, endOffset)

		const resultsForPart = await getResultsForAudioPart(audioPart)

		resultsForParts.push(resultsForPart)

		const sortedResultsForPart = deepClone(resultsForPart).sort((a, b) => b.probability - a.probability)

		let topCandidatesStrings: string[] = []

		for (let i = 0; i < Math.min(3, sortedResultsForPart.length); i++) {
			topCandidatesStrings.push(`${formatLanguageCodeWithName(sortedResultsForPart[i].language)}: ${sortedResultsForPart[i].probability.toFixed(3)}`)
		}

		logger.logTitledMessage(`Top candidates`, topCandidatesStrings.join(', '))

		if (audioPartLength < audioPartDuration) {
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

export interface SpeechLanguageDetectionOptions {
	engine?: SpeechLanguageDetectionEngine
	defaultLanguage?: string,
	fallbackThresholdProbability?: number

	crop?: boolean

	silero?: SileroLanguageDetectionOptions

	whisper?: WhisperLanguageDetectionOptions

	whisperCpp?: WhisperCppOptions

	vad?: API.VADOptions
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
		name: 'OpenAI Whisper (C++ port)',
		description: 'Uses the language tokens produced by Whisper.cpp to classify the spoken langauge.',
		type: 'local'
	},
]
