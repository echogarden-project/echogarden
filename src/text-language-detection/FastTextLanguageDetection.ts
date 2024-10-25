import { languageCodeToName } from '../utilities/Locale.js'
import { OpenPromise } from '../utilities/OpenPromise.js'
import { resolveModuleMainPath, roundToDigits } from '../utilities/Utilities.js'
import { LanguageDetectionResults } from '../api/LanguageDetectionCommon.js'
import { getDirName, joinPath } from '../utilities/PathUtilities.js'

let fastTextLanguageDetectionModel: any

export async function detectLanguage(text: string) {
	const model = await loadLanguageDetectionModel()

	const predictionsVector = model.predict(text, -1, 0.0)

	const predictions: LanguageDetectionResults = []

	for (let i = 0; i < predictionsVector.size(); i++) {
		const prediction = predictionsVector.get(i)
		const languageCode = prediction[1].substring(9)
		const probability = roundToDigits(prediction[0], 3)

		predictions.push({
			language: languageCode,
			languageName: languageCodeToName(languageCode),
			probability
		})
	}

	return predictions
}

async function loadLanguageDetectionModel() {
	if (fastTextLanguageDetectionModel) {
		return fastTextLanguageDetectionModel
	}

	const { FastText, addOnPostRun } = await import('@echogarden/fasttext-wasm')

	const resultPromise = new OpenPromise<any>()

	addOnPostRun(async () => {
		const fastText = new FastText()

		const moduleMainPath = await resolveModuleMainPath('@echogarden/fasttext-wasm')
		const modelPath = joinPath(getDirName(moduleMainPath), 'lid.176.ftz')

		const model = await fastText.loadModel(modelPath)

		fastTextLanguageDetectionModel = model
		resultPromise.resolve(model)
	})

	return resultPromise.promise
}
