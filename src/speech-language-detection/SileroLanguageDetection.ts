import type * as Onnx from 'onnxruntime-node'
import { softmax } from '../math/VectorMath.js'
import { Logger } from '../utilities/Logger.js'
import { RawAudio } from '../audio/AudioUtilities.js'
import { readAndParseJsonFile } from '../utilities/FileSystem.js'
import { detectSpeechLanguageByParts } from '../api/SpeechLanguageDetection.js'
import { languageCodeToName } from '../utilities/Locale.js'
import { OnnxExecutionProvider, getOnnxSessionOptions } from '../utilities/OnnxUtilities.js'
import { LanguageDetectionResults } from '../api/LanguageDetectionCommon.js'

export async function detectLanguage(
	rawAudio: RawAudio,
	modelPath: string,
	languageDictionaryPath: string,
	languageGroupDictionaryPath: string,
	onnxExecutionProviders: OnnxExecutionProvider[]) {

	const languageDetection = new SileroLanguageDetection(
		modelPath,
		languageDictionaryPath,
		languageGroupDictionaryPath,
		onnxExecutionProviders)

	async function detectLanguageForPart(partAudio: RawAudio) {
		const { languageResults } = await languageDetection.detectLanguage(partAudio)

		return languageResults
	}

	const results = await detectSpeechLanguageByParts(rawAudio, detectLanguageForPart)

	results.sort((a, b) => b.probability - a.probability)

	return results
}

export class SileroLanguageDetection {
	languageDictionary?: any
	languageGroupDictionary?: any

	session?: Onnx.InferenceSession

	constructor(
		public readonly modelPath: string,
		public readonly languageDictionaryPath: string,
		public readonly languageGroupDictionaryPath: string,
		public readonly onnxExecutionProviders: OnnxExecutionProvider[]) {
	}

	async detectLanguage(rawAudio: RawAudio) {
		await this.initializeIfNeeded()

		const logger = new Logger()

		logger.start('Detect language with Silero')

		const audioSamples = rawAudio.audioChannels[0]

		const Onnx = await import('onnxruntime-node')

		const inputTensor = new Onnx.Tensor('float32', audioSamples, [1, audioSamples.length])

		const inputs = { input: inputTensor }

		const results = await this.session!.run(inputs)

		logger.start('Parse model results')

		const languageLogits = results['output'].data
		const languageGroupLogits = results['2038'].data

		const languageProbabilities = softmax(languageLogits as any)
		const languageGroupProbabilities = softmax(languageGroupLogits as any)

		const languageResults: LanguageDetectionResults = []

		for (let i = 0; i < languageProbabilities.length; i++) {
			const languageString = this.languageDictionary[i]
			const languageCode = languageString.replace(/,.*$/, '')

			languageResults.push({
				language: languageCode,
				languageName: languageCodeToName(languageCode),
				probability: languageProbabilities[i]
			})
		}

		const languageGroupResults: { languageGroup: string, probability: number }[] = []

		for (let i = 0; i < languageGroupProbabilities.length; i++) {
			languageGroupResults.push({
				languageGroup: this.languageGroupDictionary[i],
				probability: languageGroupProbabilities[i]
			})
		}

		logger.end()

		return { languageResults, languageGroupResults }
	}

	async initializeIfNeeded() {
		if (this.session) {
			return
		}

		const logger = new Logger()

		logger.start('Initialize ONNX inference session for Silero language detection')

		this.languageDictionary = await readAndParseJsonFile(this.languageDictionaryPath)
		this.languageGroupDictionary = await readAndParseJsonFile(this.languageGroupDictionaryPath)

		const Onnx = await import('onnxruntime-node')

		const onnxSessionOptions = getOnnxSessionOptions({ executionProviders: this.onnxExecutionProviders })

		this.session = await Onnx.InferenceSession.create(this.modelPath, onnxSessionOptions)

		logger.end()
	}
}

export interface SileroLanguageDetectionOptions {
	provider?: OnnxExecutionProvider
}

export const defaultSileroLanguageDetectionOptions: SileroLanguageDetectionOptions = {
	provider: undefined
}
