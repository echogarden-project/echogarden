import { type PreTrainedModel, type PreTrainedTokenizer } from '@echogarden/transformers-nodejs-lite'
import { Logger } from '../utilities/Logger.js'
import { loadPackage } from '../utilities/PackageManager.js'
import { alignDTWWindowed } from './DTWSequenceAlignmentWindowed.js'
import { cosineDistance } from '../math/VectorMath.js'
import { isPunctuation, splitToWords } from '../nlp/Segmentation.js'

export async function alignText(text1: string, langCode1: string, text2: string, langCode2: string) {
	const logger = new Logger()

	text1 = text1.replaceAll(/\s+/g, ' ')
	text2 = text2.replaceAll(/\s+/g, ' ')

	const words1 = await splitToWords(text1, langCode1)
	const words2 = await splitToWords(text2, langCode2)

	const wordAlignment = await alignWords(words1, words2)

	const x = 0
}

export async function alignWords(words1: string[], words2: string[]) {
	const logger = new Logger()

	// Join words and get offsets
	const { joinedText: text1, offsets: text1Offsets } = joinAndGetOffsets(words1)
	const { joinedText: text2, offsets: text2Offsets } = joinAndGetOffsets(words2)

	// Load embedding model
	const modelPath = await loadPackage(`xenova-multilingual-e5-base-quantized`)

	const embeddingModel = new E5TextEmbedding(modelPath)

	// Process text 1:
	logger.start(`Initialize E5 embedding model`)
	await embeddingModel.initializeIfNeeded()

	logger.start(`Tokenize text 1`)
	const inputs1 = await embeddingModel.tokenizeToModelInputs(text1)

	logger.start(`Infer embeddings for text 1`)
	const embeddings1 = await embeddingModel.inferTokenEmbeddings(inputs1)

	logger.start(`Compute token to word mapping for text 1`)
	const filteredEmbeddings1 = embeddings1.filter((embedding) => embedding.text !== '▁' && embedding.text !== '<s>' && embedding.text !== '</s>')
	const tokenToWordIndexMapping1 = mapTokenEmbeddingsToWordIndexes(filteredEmbeddings1, text1, text1Offsets)

	// Process text 2:
	logger.start(`Tokenize text 2`)
	const inputs2 = await embeddingModel.tokenizeToModelInputs(text2)

	logger.start(`Infer embeddings for text 2`)
	const embeddings2 = await embeddingModel.inferTokenEmbeddings(inputs2)

	logger.start(`Compute token to word mapping for text 2`)
	const filteredEmbeddings2 = embeddings2.filter((embedding) => embedding.text !== '▁' && embedding.text !== '<s>' && embedding.text !== '</s>')
	const tokenToWordIndexMapping2 = mapTokenEmbeddingsToWordIndexes(filteredEmbeddings2, text2, text2Offsets)

	logger.end()

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

	const { path } = alignDTWWindowed(filteredEmbeddings1, filteredEmbeddings2, costFunction, 1000 * 1000)

	// Use alignment path to words to words
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

		const embedding1 = filteredEmbeddings1[sourceTokenIndex]
		const embedding2 = filteredEmbeddings2[destTokenIndex]

		logger.log(`${embedding1.text} -> ${embedding2.text}`)
	}

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
		joinedText += word

		offsets.push(offset)

		offset += word.length
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
