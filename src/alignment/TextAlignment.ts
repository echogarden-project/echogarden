import { type PreTrainedModel, type PreTrainedTokenizer } from '@echogarden/transformers-nodejs-lite'
import { Logger } from '../utilities/Logger.js'
import { loadPackage } from '../utilities/PackageManager.js'

export async function alignText(text1: string, text2: string) {
	const logger = new Logger()

	text1 = text1.replaceAll(/(\r?\n)+/g, ' ')
	text2 = text2.replaceAll(/(\r?\n)+/g, ' ')

	const modelPath = await loadPackage(`xenova-multilingual-e5-small-quantized`)

	const embeddingModel = new E5TextEmbedding(modelPath)

	logger.start(`Initialize E5 embedding model`)
	await embeddingModel.initializeIfNeeded()

	logger.start(`Tokenize text 1`)
	const inputs1 = await embeddingModel.tokenizeToModelInputs(text1)

	logger.start(`Infer embeddings for text 1`)
	const embeddings1 = await embeddingModel.inferTokenEmbeddings(inputs1)

	logger.start(`Tokenize text 2`)
	const inputs2 = await embeddingModel.tokenizeToModelInputs(text2)

	logger.start(`Infer embeddings for text 2`)
	const embeddings2 = await embeddingModel.inferTokenEmbeddings(inputs1)

	logger.end()

	logger.log(embeddings1)
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
