import Onnx from 'onnxruntime-node'
import { softmax } from '../math/VectorMath.js'
import { Logger } from "../utilities/Logger.js"
import { RawAudio } from "../audio/AudioUtilities.js"
import { readAndParseJsonFile } from '../utilities/FileSystem.js'
import { detectLanguageByParts, type LanguageDetectionResults } from '../api/LanguageDetection.js'
import { languageCodeToName } from '../utilities/Locale.js'

export async function detectLanguage(rawAudio: RawAudio, modelPath: string, languageDictionaryPath: string, languageGroupDictionaryPath: string) {
	const languageDetection = new SileroLanguageDetection(modelPath, languageDictionaryPath, languageGroupDictionaryPath)
	await languageDetection.initialize()

	async function detectLanguageForPart(partAudio: RawAudio) {
		const { languageResults } = await languageDetection.detectLanguage(partAudio)

		return languageResults
	}

	return detectLanguageByParts(rawAudio, detectLanguageForPart)
}

export class SileroLanguageDetection {
	modelPath: string
	languageDictionaryPath: string
	languageGroupDictionaryPath: string

	languageDictionary: any
	languageGroupDictionary: any

	session: Onnx.InferenceSession | undefined

	constructor(modelPath: string, languageDictionaryPath: string, languageGroupDictionaryPath: string) {
		this.modelPath = modelPath
		this.languageDictionaryPath = languageDictionaryPath
		this.languageGroupDictionaryPath = languageGroupDictionaryPath
	}

	async initialize() {
		const logger = new Logger()
		logger.start("Initialize ONNX inference session")

		this.languageDictionary = await readAndParseJsonFile(this.languageDictionaryPath)
		this.languageGroupDictionary = await readAndParseJsonFile(this.languageGroupDictionaryPath)

		const onnxOptions: Onnx.InferenceSession.SessionOptions = {
			logSeverityLevel: 3
		}

		this.session = await Onnx.InferenceSession.create(this.modelPath, onnxOptions)

		logger.end()
	}

	async detectLanguage(rawAudio: RawAudio) {
		const logger = new Logger()

		logger.start("Detect language with Silero")

		const audioSamples = rawAudio.audioChannels[0]

		const inputTensor = new Onnx.Tensor('float32', audioSamples, [1, audioSamples.length])

		const inputs = { input: inputTensor }

		const results = await this.session!.run(inputs)

		logger.start("Parse model results")

		const languageLogits = results["output"].data
		const languageGroupLogits = results["2038"].data

		const languageProbabilities = softmax(languageLogits as any)
		const languageGroupProbabilities = softmax(languageGroupLogits as any)

		const languageResults: LanguageDetectionResults = []

		for (let i = 0; i < languageProbabilities.length; i++) {
			const languageString = this.languageDictionary[i]
			const languageCode = languageString.replace(/,.*$/, "")

			languageResults.push({
				language: languageCode,
				languageName: languageCodeToName(languageCode),
				probability: languageProbabilities[i]
			})
		}

		languageResults.sort((a, b) => b.probability - a.probability)

		const languageGroupResults: { languageGroup: string, probability: number }[] = []

		for (let i = 0; i < languageGroupProbabilities.length; i++) {
			languageGroupResults.push({
				languageGroup: this.languageGroupDictionary[i],
				probability: languageGroupProbabilities[i]
			})
		}

		languageGroupResults.sort((a, b) => b.probability - a.probability)

		logger.end()

		return { languageResults, languageGroupResults }
	}
}
