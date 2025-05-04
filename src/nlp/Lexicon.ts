import { readAndParseJsonFile } from '../utilities/FileSystem.js'
import { getShortLanguageCode } from '../utilities/Locale.js'
import { resolveToModuleRootDir } from '../utilities/PathUtilities.js'

export function tryGetFirstLexiconSubstitution(sentenceWords: string[], wordIndex: number, lexicons: Lexicon[], languageCode: string) {
	for (let i = lexicons.length - 1; i >= 0; i--) {
		const lexicon = lexicons[i]

		const match = tryGetLexiconSubstitution(sentenceWords, wordIndex, lexicon, languageCode)

		if (match) {
			return match
		}
	}

	return undefined
}

export function tryGetLexiconSubstitution(sentenceWords: string[], wordIndex: number, lexicon: Lexicon, languageCode: string) {
	let word = sentenceWords[wordIndex]

	if (!word) {
		return undefined
	}

	const shortLanguageCode = getShortLanguageCode(languageCode)
	const lexiconForLanguage = lexicon[shortLanguageCode]

	if (!lexiconForLanguage) {
		return undefined
	}

	let lexiconEntry = lexiconForLanguage[word]

	if (!lexiconEntry) {
		return undefined
	}

	if (!Array.isArray(lexiconEntry)) {
		lexiconEntry = [lexiconEntry]
	}

	for (let i = 0; i < lexiconEntry.length; i++) {
		const candidateEntry = lexiconEntry[i]

		const pronunciationPhonemesText = candidateEntry?.pronunciation?.espeak?.[languageCode]

		if (!pronunciationPhonemesText) {
			continue
		}

		const precedingWord = sentenceWords[wordIndex - 1] ?? ''
		const followingWord = sentenceWords[wordIndex + 1] ?? ''

		const precededBy = candidateEntry?.precededBy ?? []
		const notPrecededBy = candidateEntry?.notPrecededBy ?? []

		const followedBy = candidateEntry?.followedBy ?? candidateEntry?.succeededBy ?? []
		const notFollowedBy = candidateEntry?.notFollowedBy ?? candidateEntry?.notSucceededBy ?? []

		const hasNegativePattern = notPrecededBy.includes(precedingWord) || notFollowedBy.includes(followingWord)
		const hasPositivePattern = precededBy.includes(precedingWord) || followedBy.includes(followingWord)

		if (i === lexiconEntry.length - 1 || (hasPositivePattern && !hasNegativePattern)) {
			const substitutionPhonemes = pronunciationPhonemesText.split(/ +/g)

			return substitutionPhonemes
		}
	}

	return undefined
}

export async function loadLexiconFile(jsonFilePath: string): Promise<Lexicon> {
	const parsedLexicon: Lexicon = await readAndParseJsonFile(jsonFilePath)

	return parsedLexicon
}

export async function loadLexiconsForLanguage(language: string, customLexiconPaths?: string[]) {
	const lexicons: Lexicon[] = []

	if (getShortLanguageCode(language) == 'en') {
		const wordsLexicon = await loadLexiconFile(resolveToModuleRootDir('data/lexicons/words.en.json'))
		lexicons.push(wordsLexicon)

		const heteronymsLexicon = await loadLexiconFile(resolveToModuleRootDir('data/lexicons/heteronyms.en.json'))
		lexicons.push(heteronymsLexicon)
	}

	if (customLexiconPaths && customLexiconPaths.length > 0) {
		for (const customLexicon of customLexiconPaths) {
			const customLexiconObject = await loadLexiconFile(customLexicon)

			lexicons.push(customLexiconObject)
		}
	}

	return lexicons
}

export type Lexicon = {
	[shortLanguageCode: string]: LexiconForLanguage
}

export type LexiconForLanguage = {
	[word: string]: LexiconEntry | LexiconEntry[]
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

	followedBy?: string[]
	notFollowedBy?: string[]

	succeededBy?: string[] // Deprecated. Replaced by 'followedBy'
	notSucceededBy?: string[] // Deprecated. Replaced by 'notFollowedBy'

	example?: string
}

export type LexiconWordCase = 'any' | 'capitalized' | 'uppercase' | 'lowercase' | 'titlecase' | 'camelcase' | 'pascalcase'
export type LexiconPronunciationForLanguageCodes = { [languageCode: string]: string }
