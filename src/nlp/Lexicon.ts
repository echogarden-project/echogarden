import { readAndParseJsonFile, readFile } from "../utilities/FileSystem.js"

export async function loadLexiconFile(jsonFilePath: string): Promise<Lexicon> {
	const parsedLexicon: Lexicon = await readAndParseJsonFile(jsonFilePath)

	return parsedLexicon
}

export type Lexicon = { [word: string]: LexiconEntry[] }

export type LexiconEntry = {
	pos?: string[]
	case?: LexiconWordCase

	pronunciation?: {
		espeak?: LexiconPronunciationForLanguages
		sapi?: LexiconPronunciationForLanguages
	},

	example?: string
}

export type LexiconWordCase = "any" | "capitalized" | "uppercase" | "lowercase" | "titlecase" | "camelcase" | "pascalcase"
export type LexiconPronunciationForLanguages = { [language: string]: string }
