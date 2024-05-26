import { detectAll } from 'tinyld'
import { languageCodeToName } from '../utilities/Locale.js'
import { LanguageDetectionResults } from '../api/LanguageDetectionCommon.js'

export async function detectLanguage(text: string) {
	const tinyldResults = detectAll(text)

	const results: LanguageDetectionResults =
		tinyldResults.map(result => ({
			language: result.lang,
			languageName: languageCodeToName(result.lang),
			probability: result.accuracy
		}))

	return results
}
