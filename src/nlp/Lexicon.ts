import { readAndParseJsonFile, readFile } from "../utilities/FileSystem.js"
import { getShortLanguageCode } from "../utilities/Locale.js"

export function tryGetFirstLexiconSubstitution(sentenceWords: string[], wordIndex: number, lexicons: Lexicon[], espeakVoice: string) {
	const reversedLexicons = [...lexicons].reverse() // Give precedence to later lexicons

	for (const lexicon of reversedLexicons) {
		const match = tryGetLexiconSubstitution(sentenceWords, wordIndex, lexicon, espeakVoice)

		if (match) {
			return match
		}
	}

	return undefined
}

export function tryGetLexiconSubstitution(sentenceWords: string[], wordIndex: number, lexicon: Lexicon, espeakVoice: string) {
	let word = sentenceWords[wordIndex]

	if (!word) {
		return
	}

	const shortLanguageCode = getShortLanguageCode(espeakVoice)
	const lexiconForLanguage = lexicon[shortLanguageCode]

	if (!lexiconForLanguage) {
		return
	}

	const lexiconEntry = lexiconForLanguage[word]

	if (!lexiconEntry) {
		return
	}

	for (let i = 0; i < lexiconEntry.length; i++) {
		const substitutionEntry = lexiconEntry[i]

		const substitutionPhonemesText = substitutionEntry?.pronunciation?.espeak?.[espeakVoice]

		if (!substitutionPhonemesText) {
			continue
		}

		const precedingWord = sentenceWords[wordIndex - 1] || ""
		const succeedingWord = sentenceWords[wordIndex + 1] || ""

		const precededBy = substitutionEntry?.precededBy || []
		const notPrecededBy = substitutionEntry?.notPrecededBy || []

		const succeededBy = substitutionEntry?.succeededBy || []
		const notSucceededBy = substitutionEntry?.notSucceededBy || []

		const hasNegativePattern = notPrecededBy.includes(precedingWord) || notSucceededBy.includes(succeedingWord)
		const hasPositivePattern = precededBy.includes(precedingWord) || succeededBy.includes(succeedingWord)

		if (i == lexiconEntry.length - 1 || (hasPositivePattern && !hasNegativePattern)) {
			const substitutionPhonemes = substitutionPhonemesText.split(/ +/g)

			return substitutionPhonemes
		}
	}
}

export async function loadLexiconFile(jsonFilePath: string): Promise<Lexicon> {
	const parsedLexicon: Lexicon = await readAndParseJsonFile(jsonFilePath)

	return parsedLexicon
}

export type Lexicon = {
	[shortLanguageCode: string]: LexiconForLanguage
}

export type LexiconForLanguage = {
	[word: string]: LexiconEntry[]
}

export type LexiconEntry = {
	pos?: string[]
	case?: LexiconWordCase

	pronunciation?: {
		espeak?: LexiconPronunciationForLanguageCodes
		sapi?: LexiconPronunciationForLanguageCodes
	},

	precededBy?: string[]
	notPrecededBy?: string[]

	succeededBy?: string[]
	notSucceededBy?: string[]

	example?: string
}

export type LexiconWordCase = "any" | "capitalized" | "uppercase" | "lowercase" | "titlecase" | "camelcase" | "pascalcase"
export type LexiconPronunciationForLanguageCodes = { [languageCode: string]: string }
