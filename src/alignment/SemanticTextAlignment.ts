import { type PreTrainedModel, type PreTrainedTokenizer } from '@echogarden/transformers-nodejs-lite'
import { Logger } from '../utilities/Logger.js'
import { loadPackage } from '../utilities/PackageManager.js'
import { alignDTWWindowed } from './DTWSequenceAlignmentWindowed.js'
import { cosineDistance } from '../math/VectorMath.js'
import { isPunctuation, isWord, splitToSentences, splitToWords } from '../nlp/Segmentation.js'
import { Timeline, extractEntries } from '../utilities/Timeline.js'

export async function alignTimelineToTextSemantically(timeline: Timeline, text: string, textLangCode: string) {
	const logger = new Logger()

	logger.start(`Prepare text for semantic alignment`)

	const timelineSentenceEntries = extractEntries(timeline, entry => entry.type === 'sentence')

	const timelineWordEntryGroups: Timeline[] = []
	const timelineWordGroups: string[][] = []

	for (const sentenceEntry of timelineSentenceEntries) {
		const wordEntryGroup = sentenceEntry.timeline!
			.filter(wordEntry => isWord(wordEntry.text))

		timelineWordEntryGroups.push(wordEntryGroup)
		timelineWordGroups.push(wordEntryGroup.map(wordEntry => wordEntry.text))
	}

	const timelineWordEntriesFiltered = timelineWordEntryGroups.flat()

	const textSentences = splitToSentences(text, textLangCode)

	const textWordGroups: string[][] = []

	for (const sentenceText of textSentences) {
		let wordGroup = await splitToWords(sentenceText, textLangCode)
		wordGroup = wordGroup.filter(word => isWord(word))

		textWordGroups.push(wordGroup)
	}

	const textWords = textWordGroups.flat()

	logger.end()

	const wordMappingEntries = await alignWordsToWordsSemantically(timelineWordGroups, textWordGroups)

	logger.start(`Build timeline for translation`)

	const mappingGroups = new Map<number, number[]>()

	for (const wordMappingEntry of wordMappingEntries) {
		const wordIndex1 = wordMappingEntry.wordIndex1
		const wordIndex2 = wordMappingEntry.wordIndex2

		let group = mappingGroups.get(wordIndex1)

		if (!group) {
			group = []
			mappingGroups.set(wordIndex1, group)
		}

		if (!group.includes(wordIndex2)) {
			group.push(wordIndex2)
		}
	}

	type TimeSlice = { startTime: number, endTime: number }

	const timeSlicesLookup = new Map<number, TimeSlice[]>()

	for (const [wordIndex1, mappedWordIndexes] of mappingGroups) {
		if (mappedWordIndexes.length === 0) {
			continue
		}

		const startTime = timelineWordEntriesFiltered[wordIndex1].startTime
		const endTime = timelineWordEntriesFiltered[wordIndex1].endTime

		const splitCount = mappedWordIndexes.length

		const sliceDuration = (endTime - startTime) / splitCount

		let timeOffset = 0

		for (let i = 0; i < splitCount; i++) {
			const timeSlice: TimeSlice = {
				startTime: startTime + timeOffset,
				endTime: startTime + timeOffset + sliceDuration
			}

			const wordIndex2 = mappedWordIndexes[i]

			let timeSlicesForTargetWord = timeSlicesLookup.get(wordIndex2)

			if (!timeSlicesForTargetWord) {
				timeSlicesForTargetWord = []
				timeSlicesLookup.set(wordIndex2, timeSlicesForTargetWord)
			}

			timeSlicesForTargetWord.push(timeSlice)

			timeOffset += sliceDuration
		}
	}

	const resultTimeline: Timeline = []

	for (const [key, value] of timeSlicesLookup) {
		resultTimeline.push({
			type: 'word',
			text: textWords[key],
			startTime: value[0].startTime,
			endTime: value[value.length - 1].endTime
		})
	}

	logger.end()

	return resultTimeline
}

export async function alignWordsToWordsSemantically(wordsGroups1: string[][], wordsGroups2: string[][], windowTokenCount = 20000) {
	const logger = new Logger()

	// Load embedding model
	const modelPath = await loadPackage(`xenova-multilingual-e5-small-fp16`)

	const embeddingModel = new E5TextEmbedding(modelPath)

	logger.start(`Initialize E5 embedding model`)
	await embeddingModel.initializeIfNeeded()

	async function extractEmbeddingsFromWordGroups(wordGroups: string[][]) {
		const logger = new Logger()

		const maxTokensPerFragment = 512
		const { Tensor } = await import('@echogarden/transformers-nodejs-lite')

		const words: string[] = []

		const embeddings: TokenEmbeddingData[] = []
		const tokenToWordIndexMapping: number[] = []

		for (const wordGroup of wordGroups) {
			const { joinedText: joinedTextForGroup, offsets: offsetsForGroup } = joinAndGetOffsets(wordGroup)

			logger.start(`Tokenize text`)
			const inputsForGroup = await embeddingModel.tokenizeToModelInputs(joinedTextForGroup)

			logger.start(`Infer embeddings for text`)

			const allTokenIds = inputsForGroup['input_ids'].data
			const allAttentionMask = inputsForGroup['attention_mask'].data

			let embeddingsForGroup: TokenEmbeddingData[] = []

			for (let tokenStart = 0; tokenStart < allTokenIds.length; tokenStart += maxTokensPerFragment) {
				const tokenEnd = Math.min(tokenStart + maxTokensPerFragment, allTokenIds.length)
				const fragmentTokenCount = tokenEnd - tokenStart

				const fragmentInputIdsTensor = new Tensor('int64', allTokenIds.slice(tokenStart, tokenEnd), [1, fragmentTokenCount])
				const fragmentAttentionMaskTensor = new Tensor('int64', allAttentionMask.slice(tokenStart, tokenEnd), [1, fragmentTokenCount])

				const inputsForFragment = { input_ids: fragmentInputIdsTensor, attention_mask: fragmentAttentionMaskTensor }

				const embeddingsForFragment = await embeddingModel.inferTokenEmbeddings(inputsForFragment)

				embeddingsForGroup.push(...embeddingsForFragment)
			}

			logger.start(`Compute token to word mapping for text`)
			const filteredEmbeddingsForGroup = embeddingsForGroup.filter((embedding) => embedding.text !== '▁' && embedding.text !== '<s>' && embedding.text !== '</s>')
			const tokenToWordIndexMappingForGroup = mapTokenEmbeddingsToWordIndexes(filteredEmbeddingsForGroup, joinedTextForGroup, offsetsForGroup)
			const tokenToWordIndexMappingForGroupWithOffset = tokenToWordIndexMappingForGroup.map(value => words.length + value)

			embeddings.push(...filteredEmbeddingsForGroup)
			tokenToWordIndexMapping.push(...tokenToWordIndexMappingForGroupWithOffset)

			words.push(...wordGroup)
		}

		return { words, embeddings, tokenToWordIndexMapping }
	}

	logger.start(`Extract embeddings from source 1`)
	const {
		words: words1,
		embeddings: embeddings1,
		tokenToWordIndexMapping: tokenToWordIndexMapping1
	} = await extractEmbeddingsFromWordGroups(wordsGroups1)

	logger.start(`Extract embeddings from source 2`)
	const {
		words: words2,
		embeddings: embeddings2,
		tokenToWordIndexMapping: tokenToWordIndexMapping2
	} = await extractEmbeddingsFromWordGroups(wordsGroups2)

	// Align
	function costFunction(a: TokenEmbeddingData, b: TokenEmbeddingData) {
		const aIsPunctuation = isPunctuation(a.text)
		const bIsPunctuation = isPunctuation(b.text)

		if (aIsPunctuation === bIsPunctuation) {
			return cosineDistance(a.embeddingVector, b.embeddingVector)
		} else {
			return 1.0
		}
	}

	logger.start(`Align token embedding vectors using DTW`)

	const { path } = alignDTWWindowed(embeddings1, embeddings2, costFunction, windowTokenCount)

	// Use alignment path to words to words
	logger.start(`Map tokens to words`)

	const wordMapping: WordMapping[] = []

	for (let i = 0; i < path.length; i++) {
		const pathEntry = path[i]

		const sourceTokenIndex = pathEntry.source
		const destTokenIndex = pathEntry.dest

		const mappedWordIndex1 = tokenToWordIndexMapping1[sourceTokenIndex]
		const mappedWordIndex2 = tokenToWordIndexMapping2[destTokenIndex]

		wordMapping.push({
			wordIndex1: mappedWordIndex1,
			word1: words1[mappedWordIndex1],
			wordIndex2: mappedWordIndex2,
			word2: words2[mappedWordIndex2],
		})
	}

	logger.end()

	return wordMapping
}

function mapTokenEmbeddingsToWordIndexes(embeddings: TokenEmbeddingData[], text: string, textWordOffsets: number[]) {
	const tokenToWordIndex: number[] = []

	let currentTextOffset = 0

	for (let i = 0; i < embeddings.length; i++) {
		const embedding = embeddings[i]
		let tokenText = embedding.text

		if (tokenText === '<s>' || tokenText === '</s>') {
			tokenToWordIndex.push(-1)

			continue
		}

		if (tokenText.startsWith('▁')) {
			tokenText = tokenText.substring(1)
		}

		const matchPosition = text.indexOf(tokenText, currentTextOffset)

		if (matchPosition === -1) {
			throw new Error(`Token '${tokenText}' not found in text`)
		}

		currentTextOffset = matchPosition + tokenText.length

		let tokenMatchingWordIndex = textWordOffsets.findIndex((index) => index > matchPosition)

		if (tokenMatchingWordIndex === -1) {
			throw new Error(`Token '${tokenText}' not found in text`)
		} else {
			tokenMatchingWordIndex = Math.max(tokenMatchingWordIndex - 1, 0)
		}

		tokenToWordIndex.push(tokenMatchingWordIndex)
	}

	return tokenToWordIndex
}

function joinAndGetOffsets(words: string[]) {
	let joinedText = ''
	const offsets: number[] = []

	let offset = 0

	for (const word of words) {
		const extendedWord = `${word} `
		joinedText += extendedWord

		offsets.push(offset)

		offset += extendedWord.length
	}

	offsets.push(joinedText.length)

	return { joinedText, offsets }
}

export class E5TextEmbedding {
	tokenizer?: PreTrainedTokenizer
	model?: PreTrainedModel

	constructor(public readonly modelPath: string) {
	}

	async tokenizeToModelInputs(text: string) {
		await this.initializeIfNeeded()

		const inputs = await this.tokenizer!(text)

		return inputs
	}

	async inferTokenEmbeddings(inputs: any) {
		await this.initializeIfNeeded()

		const tokensText = this.tokenizer!.model.convert_ids_to_tokens(Array.from(inputs.input_ids.data))

		const result = await this.model!(inputs)

		const lastHiddenState = result.last_hidden_state

		const tokenCount = lastHiddenState.dims[1]
		const embeddingSize = lastHiddenState.dims[2]

		const tokenEmbeddings: TokenEmbeddingData[] = []

		for (let i = 0; i < tokenCount; i++) {
			const tokenEmbeddingVector = lastHiddenState.data.slice(i * embeddingSize, (i + 1) * embeddingSize)

			const tokenId = Number(inputs.input_ids.data[i])
			const tokenText = tokensText[i]

			tokenEmbeddings.push({
				id: tokenId,
				text: tokenText,
				embeddingVector: tokenEmbeddingVector
			})
		}

		return tokenEmbeddings
	}

	async initializeIfNeeded() {
		if (this.tokenizer && this.model) {
			return
		}

		const { AutoTokenizer, AutoModel } = await import('@echogarden/transformers-nodejs-lite')

		this.tokenizer = await AutoTokenizer.from_pretrained(this.modelPath)
		this.model = await AutoModel.from_pretrained(this.modelPath)
	}
}

export interface TokenEmbeddingData {
	id: number
	text: string
	embeddingVector: Float32Array
}

export interface WordMapping {
	wordIndex1: number
	word1: string

	wordIndex2: number
	word2: string
}

export const e5SupportedLanguages: string[] = [
	'af', // Afrikaans
	'am', // Amharic
	'ar', // Arabic
	'as', // Assamese
	'az', // Azerbaijani
	'be', // Belarusian
	'bg', // Bulgarian
	'bn', // Bengali
	'br', // Breton
	'bs', // Bosnian
	'ca', // Catalan
	'cs', // Czech
	'cy', // Welsh
	'da', // Danish
	'de', // German
	'el', // Greek
	'en', // English
	'eo', // Esperanto
	'es', // Spanish
	'et', // Estonian
	'eu', // Basque
	'fa', // Persian
	'fi', // Finnish
	'fr', // French
	'fy', // Western Frisian
	'ga', // Irish
	'gd', // Scottish Gaelic
	'gl', // Galician
	'gu', // Gujarati
	'ha', // Hausa
	'he', // Hebrew
	'hi', // Hindi
	'hr', // Croatian
	'hu', // Hungarian
	'hy', // Armenian
	'id', // Indonesian
	'is', // Icelandic
	'it', // Italian
	'ja', // Japanese
	'jv', // Javanese
	'ka', // Georgian
	'kk', // Kazakh
	'km', // Khmer
	'kn', // Kannada
	'ko', // Korean
	'ku', // Kurdish
	'ky', // Kyrgyz
	'la', // Latin
	'lo', // Lao
	'lt', // Lithuanian
	'lv', // Latvian
	'mg', // Malagasy
	'mk', // Macedonian
	'ml', // Malayalam
	'mn', // Mongolian
	'mr', // Marathi
	'ms', // Malay
	'my', // Burmese
	'ne', // Nepali
	'nl', // Dutch
	'no', // Norwegian
	'om', // Oromo
	'or', // Oriya
	'pa', // Panjabi
	'pl', // Polish
	'ps', // Pashto
	'pt', // Portuguese
	'ro', // Romanian
	'ru', // Russian
	'sa', // Sanskrit
	'sd', // Sindhi
	'si', // Sinhala
	'sk', // Slovak
	'sl', // Slovenian
	'so', // Somali
	'sq', // Albanian
	'sr', // Serbian
	'su', // Sundanese
	'sv', // Swedish
	'sw', // Swahili
	'ta', // Tamil
	'te', // Telugu
	'th', // Thai
	'tl', // Tagalog
	'tr', // Turkish
	'ug', // Uyghur
	'uk', // Ukrainian
	'ur', // Urdu
	'uz', // Uzbek
	'vi', // Vietnamese
	'xh', // Xhosa
	'yi', // Yiddish
	'zh', // Chinese
]
