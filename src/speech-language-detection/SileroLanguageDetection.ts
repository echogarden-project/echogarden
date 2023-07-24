import Onnx from 'onnxruntime-node'
import { softmax } from '../math/VectorMath.js'
import { Logger } from "../utilities/Logger.js"
import { RawAudio } from "../audio/AudioUtilities.js"
import { readAndParseJsonFile, readFile } from '../utilities/FileSystem.js'
import type { LanguageDetectionResults } from '../api/LanguageDetection.js'
import { languageCodeToName } from '../utilities/Locale.js'

export async function detectLanguage(rawAudio: RawAudio, modelPath: string, languageDictionaryPath: string, languageGroupDictionaryPath: string) {
	const logger = new Logger()
	logger.start("Initialize ONNX inference session")

	const languageDictionary = await readAndParseJsonFile(languageDictionaryPath)
	const languageGroupDictionary = await readAndParseJsonFile(languageGroupDictionaryPath)

	const audioSamples = rawAudio.audioChannels[0]

	const onnxOptions: Onnx.InferenceSession.SessionOptions = {
		logSeverityLevel: 3
	}

	const session = await Onnx.InferenceSession.create(modelPath, onnxOptions)

	logger.start("Detect language with Silero")

	const inputTensor = new Onnx.Tensor('float32', audioSamples, [1, audioSamples.length])

	const inputs = { input: inputTensor }

	const results = await session.run(inputs)

	logger.start("Parse model results")

	const languageLogits = results["output"].data
	const languageGroupLogits = results["2038"].data

	const languageProbabilities = softmax(languageLogits as any)
	const languageGroupProbabilities = softmax(languageGroupLogits as any)

	const languageResults: LanguageDetectionResults = []

	for (let i = 0; i < languageProbabilities.length; i++) {
		const languageString = languageDictionary[i]
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
			languageGroup: languageGroupDictionary[i],
			probability: languageGroupProbabilities[i]
		})
	}

	languageGroupResults.sort((a, b) => b.probability - a.probability)

	logger.end()

	return { languageResults, languageGroupResults }
}
