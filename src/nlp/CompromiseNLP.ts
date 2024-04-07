import { getShortLanguageCode } from '../utilities/Locale.js'
import { logToStderr } from '../utilities/Utilities.js'
import { Lexicon } from './Lexicon.js'

const log = logToStderr

export async function parse(text: string): Promise<CompromiseParsedDocument> {
	const { default: nlp } = await import('compromise')

	const doc = nlp(text)

	doc.compute('penn')

	const jsonDoc: any[] = doc.json({ offset: true })

	//log(jsonDoc)

	const result: CompromiseParsedDocument = jsonDoc.map(sentence => {
		const terms = sentence.terms
		const parsedSentence: CompromiseParsedSentence = []

		for (let termIndex = 0; termIndex < terms.length; termIndex++) {
			const term = terms[termIndex]

			const parsedTerm: CompromiseParsedTerm = {
				text: term.text,
				pos: term.penn,
				tags: term.tags,
				preText: term.pre,
				postText: term.post,
				startOffset: term.offset.start,
				endOffset: term.offset.start + term.offset.length
			}

			if (parsedTerm.text == '') {
				if (parsedSentence.length > 0) {
					parsedSentence[parsedSentence.length - 1].postText += parsedTerm.preText + parsedTerm.postText
				}
			} else if (parsedTerm.tags.includes('Abbreviation') && parsedTerm.postText.startsWith('.')) {
				parsedTerm.text += '.'
				parsedTerm.endOffset += 1
				parsedSentence.push(parsedTerm)
			} else {
				parsedSentence.push(parsedTerm)
			}
		}

		return parsedSentence
	})

	//log(result)

	return result
}

export function tryMatchInLexicons(term: CompromiseParsedTerm, lexicons: Lexicon[], espeakVoice: string) {
	const reversedLexicons = [...lexicons].reverse() // Give precedence to later lexicons

	for (const lexicon of reversedLexicons) {
		const match = tryMatchInLexicon(term, lexicon, espeakVoice)

		if (match) {
			return match
		}
	}

	return undefined
}

export function tryMatchInLexicon(term: CompromiseParsedTerm, lexicon: Lexicon, espeakVoice: string) {
	const shortLanguageCode = getShortLanguageCode(espeakVoice)

	const lexiconForLanguage = lexicon[shortLanguageCode]

	if (!lexiconForLanguage) {
		return undefined
	}

	const termText = term.text
	const lowerCaseTermText = termText.toLocaleLowerCase()

	const entry = lexiconForLanguage[lowerCaseTermText]

	if (!entry) {
		return undefined
	}

	for (const substitutionEntry of entry) {
		if (!substitutionEntry.pos || substitutionEntry.pos.includes(term.pos)) {
			const substitutionPhonemesText = substitutionEntry?.pronunciation?.espeak?.[espeakVoice]

			if (substitutionPhonemesText) {
				const substitutionPhonemes = substitutionPhonemesText.split(/ +/g)

				return substitutionPhonemes
			}
		}
	}

	return undefined
}

export type CompromiseParsedDocument = CompromiseParsedSentence[]

export type CompromiseParsedSentence = CompromiseParsedTerm[]

export type CompromiseParsedTerm = {
	text: string
	pos: string
	tags: string[]
	preText: string,
	postText: string,
	startOffset: number,
	endOffset: number
}
