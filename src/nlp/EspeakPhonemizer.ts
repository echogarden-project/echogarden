import * as EspeakTTS from '../synthesis/EspeakTTS.js'
import { logToStderr } from '../utilities/Utilities.js'
import * as Segmentation from './Segmentation.js'

const log = logToStderr

export async function phonemizeSentence(sentence: string, espeakVoice: string, substitutionMap?: Map<string, string[]>, useIpa = true) {
	const ipaString = await EspeakTTS.textToPhonemes(sentence, espeakVoice, useIpa)

	const phraseStrings = ipaString.split(' | ')

	const phrases: string[][][] = []

	for (let phraseIndex = 0; phraseIndex < phraseStrings.length; phraseIndex++) {
		const phraseString = phraseStrings[phraseIndex]

		const wordStrings = phraseString.trim().split(/ +/g)
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
			phrases.push(words)
		}
	}

	return phrases
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

	const segmentedText = await Segmentation.parseTextAndConvertToFragmentObjects(text, voice)
	const preparedPhrases: string[] = []
	const phraseBreakers: string[] = []

	for (const sentence of segmentedText) {
		for (const phrase of sentence.phrases) {
			const words = phrase.words.filter(wordObject => Segmentation.isWordOrSymbolWord(wordObject.text))
			const preparedPhraseText = words.map(word => word.text.replace(/\./g, ' ')).join(' ')

			preparedPhrases.push(preparedPhraseText)

			const trimmedPhraseText = phrase.text.trim()
			const lastChar = trimmedPhraseText[trimmedPhraseText.length - 1]

			if (phrase.isSentenceFinalizer) {
				if (trimmedPhraseText.endsWith('?') || trimmedPhraseText.endsWith(`?"`)) {
					phraseBreakers.push('?')
				} else if (trimmedPhraseText.endsWith('!') || trimmedPhraseText.endsWith(`!"`)) {
					phraseBreakers.push('!')
				} else {
					phraseBreakers.push('.')
				}
			} else {
				if (lastChar == ':' || lastChar == ';') {
					phraseBreakers.push(lastChar)
				} else {
					phraseBreakers.push(',')
				}
			}
		}
	}

	return phonemizePhrases(preparedPhrases, voice, phraseBreakers, substitutionMap)
}

export async function phonemizePhrases(phrases: string[], voice: string, phraseBreakers: string[], substitutionMap?: Map<string, string[]>) {
	if (phrases.length == 0) {
		return []
	}

	const preparedText = phrases.join('\n\n') // filter(phrase => phrase.trim().length > 0)

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

	if (ipaLines.length != phraseBreakers.length) {
		log(phrases)
		log(ipaLines)
		log(phraseBreakers)

		throw new Error(`Unexpected: IPA lines count (${ipaLines.length}) is not equal to phrase breakers count (${phraseBreakers.length})`)
	}

	for (let i = 0; i < phonemeLines.length; i++) {
		const line = phonemeLines[i]
		const lastWordInLine = line[line.length - 1]

		lastWordInLine.push(phraseBreakers[i])
	}

	return phonemeLines
}

export function phonemizedPhrasesToSentences(phonemizedPhrases: string[][][]) {
	let phonemizedSentences: string[][][] = [[]]

	for (const phonemizedPhrase of phonemizedPhrases) {
		phonemizedSentences[phonemizedSentences.length - 1].push(...phonemizedPhrase)

		const lastWord = phonemizedPhrase[phonemizedPhrase.length - 1]
		const lastPhoneme = lastWord[lastWord.length - 1]

		if (['.', '?', '!'].includes(lastPhoneme)) {
			phonemizedSentences.push([])
		}
	}

	phonemizedSentences = phonemizedSentences.filter(entry => entry.length > 0)

	return phonemizedSentences
}
