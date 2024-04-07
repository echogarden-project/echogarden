import * as EspeakTTS from '../synthesis/EspeakTTS.js'
import { logToStderr } from '../utilities/Utilities.js'
import * as Segmentation from './Segmentation.js'

const log = logToStderr

export async function phonemizeSentence(sentence: string, espeakVoice: string, substitutionMap?: Map<string, string[]>, useIpa = true) {
	const ipaString = await EspeakTTS.textToPhonemes(sentence, espeakVoice, useIpa)

	const clauseStrings = ipaString.split(' | ')

	const clauses: string[][][] = []

	for (let clauseIndex = 0; clauseIndex < clauseStrings.length; clauseIndex++) {
		const clauseString = clauseStrings[clauseIndex]

		const wordStrings = clauseString.trim().split(/ +/g)
		const words: string[][] = []

		for (let wordIndex = 0; wordIndex < wordStrings.length; wordIndex++) {
			const word = wordStrings[wordIndex]

			let wordPhonemes = word.split('_')

			wordPhonemes = wordPhonemes.flatMap(phoneme => {
				if (!phoneme || phoneme.startsWith('(')) {
					return []
				} else if (phoneme.startsWith(`ˈ`) || phoneme.startsWith(`ˌ`)) {
					return [phoneme[0], phoneme.substring(1)]
				} else if (phoneme.endsWith(`ˈ`) || phoneme.endsWith(`ˌ`)) {
					return [phoneme.substring(0, phoneme.length - 1), phoneme[phoneme.length - 1]]
				} else {
					return substitutionMap?.get(phoneme) || [phoneme]
				}
			})

			if (wordPhonemes.length > 0) {
				words.push(wordPhonemes)
			}
		}

		if (words.length > 0) {
			clauses.push(words)
		}
	}

	return clauses
}

export async function phonemizeText(text: string, voice: string, substitutionMap?: Map<string, string[]>) {
	text = text
			.replaceAll('，', ',')
			.replaceAll('、', ',')
			.replaceAll('。', '.')
			.replaceAll('(', ', ')
			.replaceAll(')', ', ')
			.replaceAll('«', ', ')
			.replaceAll('»', ', ')

	const segmentedText = await Segmentation.parse(text, voice)
	const preparedClauses: string[] = []
	const clauseBreakers: string[] = []

	for (const sentence of segmentedText) {
		for (const clause of sentence.phrases) {
			const words = clause.words.filter(wordObject => Segmentation.isWordOrSymbolWord(wordObject.text))
			const preparedClauseText = words.map(word => word.text.replace(/\./g, ' ')).join(' ')

			preparedClauses.push(preparedClauseText)

			const trimmedClauseText = clause.text.trim()
			const lastChar = trimmedClauseText[trimmedClauseText.length - 1]

			if (clause.isSentenceFinalizer) {
				if (trimmedClauseText.endsWith('?') || trimmedClauseText.endsWith(`?"`)) {
					clauseBreakers.push('?')
				} else if (trimmedClauseText.endsWith('!') || trimmedClauseText.endsWith(`!"`)) {
					clauseBreakers.push('!')
				} else {
					clauseBreakers.push('.')
				}
			} else {
				if (lastChar == ':' || lastChar == ';') {
					clauseBreakers.push(lastChar)
				} else {
					clauseBreakers.push(',')
				}
			}
		}
	}

	return phonemizeClauses(preparedClauses, voice, clauseBreakers, substitutionMap)
}

export async function phonemizeClauses(clauses: string[], voice: string, clauseBreakers: string[], substitutionMap?: Map<string, string[]>) {
	if (clauses.length == 0) {
		return []
	}

	const preparedText = clauses.join('\n\n') // filter(clause => clause.trim().length > 0)

	const ipaString = await EspeakTTS.textToIPA(preparedText, voice)

	const ipaLines = ipaString.split('\n')

	const phonemeLines = ipaLines.map(line => {
		line = line.replace(/_+/g, '_').replace(/ +/g, ' ')

		return line.split(' ').map(word => {
			word = word.replaceAll('_', ' ').trim()
			let wordPhonemes = word.split(' ')

			wordPhonemes = wordPhonemes.flatMap(phoneme => {
				if (!phoneme || phoneme.startsWith('(')) {
					return []
				} else if (phoneme.startsWith('ˈ') || phoneme.startsWith('ˌ')) {
					return [phoneme[0], phoneme.substring(1)]
				} else if (phoneme.endsWith('ˈ') || phoneme.endsWith('ˌ')) {
					return [phoneme.substring(0, phoneme.length - 1), phoneme[phoneme.length - 1]]
				} else {
					return [phoneme]
				}
			})

			if (substitutionMap) {
				wordPhonemes = wordPhonemes.flatMap(phoneme => substitutionMap.get(phoneme) || [phoneme])
			}

			return wordPhonemes
		})
	})

	if (ipaLines.length != clauseBreakers.length) {
		log(clauses)
		log(ipaLines)
		log(clauseBreakers)

		throw new Error(`Unexpected: IPA lines count (${ipaLines.length}) is not equal to clause breakers count (${clauseBreakers.length})`)
	}

	for (let i = 0; i < phonemeLines.length; i++) {
		const line = phonemeLines[i]
		const lastWordInLine = line[line.length - 1]

		lastWordInLine.push(clauseBreakers[i])
	}

	return phonemeLines
}

export function phonemizedClausesToSentences(phonemizedClauses: string[][][]) {
	let phonemizedSentences: string[][][] = [[]]

	for (const phonemizedClause of phonemizedClauses) {
		phonemizedSentences[phonemizedSentences.length - 1].push(...phonemizedClause)

		const lastWord = phonemizedClause[phonemizedClause.length - 1]
		const lastPhoneme = lastWord[lastWord.length - 1]

		if (['.', '?', '!'].includes(lastPhoneme)) {
			phonemizedSentences.push([])
		}
	}

	phonemizedSentences = phonemizedSentences.filter(entry => entry.length > 0)

	return phonemizedSentences
}
