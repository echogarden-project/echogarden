import { sumArray, logToStderr } from '../utilities/Utilities.js'
import { getShortLanguageCode } from '../utilities/Locale.js'
import { ParagraphBreakType, WhitespaceProcessing } from '../api/Common.js'
import { includesAnyOf, splitAndPreserveSeparators } from '../utilities/StringUtilities.js'

import * as TextSegmentation from '@echogarden/text-segmentation'
import { splitChineseTextToWords_Jieba } from './ChineseSegmentation.js'
import { splitJapaneseTextToWords_Kuromoji } from './JapaneseSegmentation.js'

const log = logToStderr

export const wordCharacterRegExp = /[\p{Letter}\p{Number}]/u
export const emojiCharacterRegExp = /[\p{Emoji}]/u
export const punctuationRegExp = /[\p{Punctuation}]/u

export const phraseSeparators = [',', '、', '，', '،', ';', '；', ':', '：', '—']
export const symbolWords = ['$', '€', '¢', '£', '¥', '©', '®', '™', '%', '&', '#', '~', '@', '+', '±', '÷', '/', '*', '=', '¼', '½', '¾']

///////////////////////////////////////////////////////////////////////////////////////////////
// Predicates
///////////////////////////////////////////////////////////////////////////////////////////////
export function isWordOrSymbolWord(str: string) {
	return isWord(str) || includesEmoji(str) || symbolWords.includes(str)
}

export function isSymbolWord(str: string) {
	return symbolWords.includes(str?.trim())
}

export function isWord(str: string) {
	return wordCharacterRegExp.test(str?.trim())
}

export function includesPunctuation(str: string) {
	return punctuationRegExp.test(str?.trim())
}

export function includesEmoji(str: string) {
	return emojiCharacterRegExp.test(str?.trim())
}

export function isWhitespace(str: string) {
	return str?.trim().length === 0
}

///////////////////////////////////////////////////////////////////////////////////////////////
// Paragraph, line, sentence, phrase, and word segmentation
///////////////////////////////////////////////////////////////////////////////////////////////
export function splitToParagraphs(text: string, paragraphBreakType: ParagraphBreakType, whitespaceProcessingMethod: WhitespaceProcessing) {
	let paragraphs: string[] = []

	if (paragraphBreakType === 'single') {
		paragraphs = splitAndPreserveSeparators(text, /(\r?\n)+/g)
	} else if (paragraphBreakType === 'double') {
		paragraphs = splitAndPreserveSeparators(text, /(\r?\n)(\r?\n)+/g)
	} else {
		throw new Error(`Invalid paragraph break type: '${paragraphBreakType}'`)
	}

	paragraphs = paragraphs.map(p => applyWhitespaceProcessing(p, whitespaceProcessingMethod))
	paragraphs = paragraphs.filter(p => p.length > 0)

	return paragraphs
}

export function splitToLines(text: string) {
	return splitAndPreserveSeparators(text, /\r?\n/g)
}

export async function parseText(text: string, langCode: string) {
	const shortLangCode = getShortLanguageCode(langCode || '')

	const wordSequence = await splitToWords(text, shortLangCode)

	const parsedText = await TextSegmentation.segmentWordSequence(wordSequence)

	return parsedText
}

export async function splitToWords(text: string, langCode: string): Promise<TextSegmentation.WordSequence> {
	const shortLangCode = getShortLanguageCode(langCode || '')

	if (shortLangCode === 'zh' || shortLangCode === 'cmn' || shortLangCode === 'ja') {
		let wordArray: string[] = []

		if (shortLangCode === 'zh' || shortLangCode === 'cmn') {
			wordArray = await splitChineseTextToWords_Jieba(text)
		} else {
			wordArray = await splitJapaneseTextToWords_Kuromoji(text)
		}

		const wordSequence = new TextSegmentation.WordSequence()

		let offset = 0

		for (const wordText of wordArray) {
			const startOffset = offset
			const endOffset = startOffset + wordText.length
			const isNonPunctuation = isWordOrSymbolWord(wordText)

			wordSequence.addWord(wordText, startOffset, isNonPunctuation)

			offset = endOffset
		}

		return wordSequence
	} else {
		return TextSegmentation.splitToWords(text, { language: langCode })
	}
}

export function applyWhitespaceProcessing(text: string, whitespaceProcessingMethod: WhitespaceProcessing) {
	if (whitespaceProcessingMethod === 'removeLineBreaks') {
		return text.trim().replaceAll(/(\r?\n)+/g, ' ')
	} else if (whitespaceProcessingMethod === 'collapse') {
		return text.trim().replaceAll(/\s+/g, ' ')
	} else if (whitespaceProcessingMethod === 'preserve') {
		return text
	} else {
		throw new Error(`Invalid whitespace processing method: '${whitespaceProcessingMethod}'`)
	}
}

///////////////////////////////////////////////////////////////////////////////////////////////
// Fragment segmentation
//
// Used to split text to fragments, to fit particular size constraints.
///////////////////////////////////////////////////////////////////////////////////////////////
export async function splitToFragments(text: string, maxFragmentLength: number, langCode: string, preserveSentences = true, preservePhrases = true) {
	const parsedText = await parseTextAndConvertToFragmentObjects(text, langCode)

	const fragments: Fragment[] = []
	let currentFragment = new Fragment()

	const remainingCharactersInCurrentFragment = () => maxFragmentLength - currentFragment.length
	const createNewFragmentIfNeeded = () => {
		if (currentFragment.isNonempty) {
			fragments.push(currentFragment)
			currentFragment = new Fragment()
		}
	}

	const fitsCurrentFragment = (segment: Segment) => segment.length <= remainingCharactersInCurrentFragment()

	for (const sentence of parsedText) {
		if (fitsCurrentFragment(sentence)) {
			currentFragment.segments.push(sentence)
			continue
		}

		if (preserveSentences) {
			createNewFragmentIfNeeded()

			if (fitsCurrentFragment(sentence)) {
				currentFragment.segments.push(sentence)
				continue
			}
		}

		for (const phrase of sentence.phrases) {
			if (fitsCurrentFragment(phrase)) {
				currentFragment.segments.push(phrase)
				continue
			}


			if (preservePhrases) {
				createNewFragmentIfNeeded()

				if (fitsCurrentFragment(phrase)) {
					currentFragment.segments.push(phrase)
					continue
				}
			}

			for (const word of phrase.words) {
				if (fitsCurrentFragment(word)) {
					currentFragment.segments.push(word)
					continue
				}

				createNewFragmentIfNeeded()

				if (fitsCurrentFragment(word)) {
					currentFragment.segments.push(word)
					continue
				}

				throw new Error(`Encountered a word of length ${word.length}, which excceeds the maximum fragment length of ${maxFragmentLength}`)
			}
		}
	}

	createNewFragmentIfNeeded()

	return fragments
}

export async function parseTextAndConvertToFragmentObjects(text: string, langCode: string) {
	const segmentedText = await parseText(text, langCode)

	const sentences: Sentence[] = []

	for (const sentenceEntry of segmentedText.sentences) {
		const sentence = new Sentence()

		for (const phraseEntry of sentenceEntry.phrases) {
			const phrase = new Phrase()

			for (const wordEntry of phraseEntry.words.entries) {
				const isSentenceFinalizer = wordEntry === sentenceEntry.words.lastEntry

				const word = new Word(wordEntry.text, isSentenceFinalizer)

				phrase.words.push(word)
			}

			if (phrase.words.length > 0) {
				sentence.phrases.push(phrase)
			}
		}

		sentences.push(sentence)
	}

	return sentences
}

export class Sentence {
	phrases: Phrase[] = []

	readonly isSentenceFinalizer = true

	get length() { return sumArray(this.phrases, (phrase) => phrase.length) }

	get text() { return this.phrases.reduce<string>((result, phrase) => result + phrase.text, '') }
}

export class Phrase {
	words: Word[] = []

	get length() { return sumArray(this.words, (word) => word.length) }

	get text() { return this.words.reduce<string>((result, word) => result + word.text, '') }

	get lastWord() {
		if (this.words.length == 0) {
			return undefined
		}

		return this.words[this.words.length - 1]
	}

	get isSentenceFinalizer() { return this.lastWord != null ? this.lastWord.isSentenceFinalizer : false }
}

export class Word {
	readonly text: string
	isSentenceFinalizer: boolean

	constructor(text: string, isSentenceFinalizer: boolean) {
		this.text = text
		this.isSentenceFinalizer = isSentenceFinalizer
	}

	get containsOnlyPunctuation() { return !wordCharacterRegExp.test(this.text) && !this.isSymbolWord }

	get isSymbolWord() { return symbolWords.includes(this.text) }

	get isPhraseSeperator() { return this.containsOnlyPunctuation && includesAnyOf(this.text, phraseSeparators) }

	get length() { return this.text.length }
}

export type Segment = Sentence | Phrase | Word

export class Fragment {
	segments: Segment[] = []

	get length() { return sumArray(this.segments, (phrase) => phrase.length) }

	get text() { return this.segments.reduce<string>((result, segment) => result + segment.text, '') }

	get isEmpty() { return this.length == 0 }

	get isNonempty() { return !this.isEmpty }

	get lastSegment() {
		if (this.isEmpty) {
			return undefined
		}

		return this.segments[this.segments.length - 1]
	}
}
