import type * as Onnx from 'onnxruntime-node'

import { Logger } from '../utilities/Logger.js'
import { computeMelSpectogramUsingFilterbanks, Filterbank } from '../dsp/MelSpectogram.js'
import { clip, getIntegerRange, getRepetitionScoreRelativeToFirstSubstring, getUTF32Chars, logToStderr, splitFloat32Array, yieldToEventLoop } from '../utilities/Utilities.js'
import { indexOfMax, logOfVector, logSumExp, meanOfVector, medianFilter, softmax, stdDeviationOfVector } from '../math/VectorMath.js'

import { alignDTWWindowed } from '../alignment/DTWSequenceAlignmentWindowed.js'
import { extendDeep } from '../utilities/ObjectUtilities.js'
import { Timeline, TimelineEntry } from '../utilities/Timeline.js'
import { AlignmentPath } from '../alignment/SpeechAlignment.js'
import { getRawAudioDuration, RawAudio } from '../audio/AudioUtilities.js'
import { readFile } from '../utilities/FileSystem.js'
import path from 'path'
import type { LanguageDetectionResults } from '../api/API.js'
import { getShortLanguageCode, languageCodeToName } from '../utilities/Locale.js'
import { loadPackage } from '../utilities/PackageManager.js'
import chalk from 'chalk'
import { XorShift32RNG } from '../utilities/RandomGenerator.js'
import { detectSpeechLanguageByParts } from '../api/LanguageDetection.js'
import { type Tiktoken } from 'tiktoken/lite'
import { isPunctuation, isWhitespace } from '../nlp/Segmentation.js'

export async function recognize(sourceRawAudio: RawAudio, modelName: WhisperModelName, modelDir: string, task: WhisperTask, sourceLanguage: string, options: WhisperOptions) {
	if (sourceRawAudio.sampleRate != 16000) {
		throw new Error('Source audio must have a sampling rate of 16000')
	}

	sourceLanguage = getShortLanguageCode(sourceLanguage)

	if (!(sourceLanguage in languageIdLookup)) {
		throw new Error(`The language ${languageCodeToName(sourceLanguage)} is not supported by the Whisper engine.`)
	}

	if (isEnglishOnlyModel(modelName) && sourceLanguage != 'en') {
		throw new Error(`The model '${modelName}' can only be used with English inputs. However, the given source language was ${languageCodeToName(sourceLanguage)}.`)
	}

	if (options.temperature && options.temperature < 0) {
		throw new Error(`Temperature can't be negative`)
	}

	let seed = options.seed

	if (seed) {
		seed = Math.max(Math.floor(seed), 1) | 0
	}

	const whisper = new Whisper(modelName, modelDir, seed)

	const result = await whisper.recognize(sourceRawAudio, task, sourceLanguage, options)

	return result
}

export async function align(sourceRawAudio: RawAudio, referenceText: string, modelName: WhisperModelName, modelDir: string, sourceLanguage: string) {
	if (sourceRawAudio.sampleRate != 16000) {
		throw new Error('Source audio must have a sampling rate of 16000')
	}

	sourceLanguage = getShortLanguageCode(sourceLanguage)

	if (!(sourceLanguage in languageIdLookup)) {
		throw new Error(`The language ${languageCodeToName(sourceLanguage)} is not supported by the Whisper engine.`)
	}

	if (isEnglishOnlyModel(modelName) && sourceLanguage != 'en') {
		throw new Error(`The model '${modelName}' can only be used with English inputs. However, the given source language was ${languageCodeToName(sourceLanguage)}.`)
	}

	const whisper = new Whisper(modelName, modelDir)

	const timeline = await whisper.align(sourceRawAudio, referenceText, sourceLanguage)

	return timeline
}

export async function detectLanguage(sourceRawAudio: RawAudio, modelName: WhisperModelName, modelDir: string, temperature: number) {
	if (sourceRawAudio.sampleRate != 16000) {
		throw new Error('Source audio must have a sampling rate of 16000')
	}

	if (!isMultilingualModel(modelName)) {
		throw new Error(`Language detection is only supported with multilingual models.`)
	}

	if (temperature < 0) {
		throw new Error(`Temperature cannot be negative`)
	}

	const whisper = new Whisper(modelName, modelDir)

	async function detectLanguageForPart(partAudio: RawAudio) {
		const audioFeatures = await whisper.encodeAudio(partAudio)
		const partResults = await whisper.detectLanguage(audioFeatures, temperature)

		return partResults
	}

	const results = await detectSpeechLanguageByParts(sourceRawAudio, detectLanguageForPart)

	results.sort((entry1, entry2) => entry2.probability - entry1.probability)

	return results
}

export class Whisper {
	modelName: WhisperModelName
	modelDir: string

	isMultiligualModel: boolean

	audioEncoder?: Onnx.InferenceSession
	textDecoder?: Onnx.InferenceSession

	tiktoken?: Tiktoken

	onnxOptions: Onnx.InferenceSession.SessionOptions = {
		logSeverityLevel: 2,
		executionProviders: ['cpu']
	}

	tokenConfig: {
		endOfTextToken: number
		startOfTextToken: number

		languageTokensStart: number
		languageTokensEnd: number

		translateTaskToken: number
		transcribeTaskToken: number
		startOfPromptToken: number
		nonSpeechToken: number
		noTimestampsToken: number

		timestampTokensStart: number
		timestampTokensEnd: number
	}

	randomGen: XorShift32RNG

	constructor(modelName: WhisperModelName, modelDir: string, rngSeed = 461845907) {
		this.modelName = modelName
		this.modelDir = modelDir

		this.isMultiligualModel = isMultilingualModel(this.modelName)

		if (this.isMultiligualModel) {
			this.tokenConfig = {
				endOfTextToken: 50257,
				startOfTextToken: 50258,

				languageTokensStart: 50259,
				languageTokensEnd: 50358,

				translateTaskToken: 50358,
				transcribeTaskToken: 50359,
				startOfPromptToken: 50361,
				nonSpeechToken: 50362,
				noTimestampsToken: 50363,

				timestampTokensStart: 50364,
				timestampTokensEnd: 50364 + 1501,
			}
		} else {
			this.tokenConfig = {
				endOfTextToken: 50256,
				startOfTextToken: 50257,

				languageTokensStart: 50258,
				languageTokensEnd: 50358,

				translateTaskToken: 50358,
				transcribeTaskToken: 50359,
				startOfPromptToken: 50360,
				nonSpeechToken: 50361,
				noTimestampsToken: 50362,

				timestampTokensStart: 50363,
				timestampTokensEnd: 50363 + 1501,
			}
		}

		this.randomGen = new XorShift32RNG(rngSeed)
	}

	async initializeIfNeeded() {
		await this.initializeTokenizerIfNeeded()
		await this.initializeEncoderSessionIfNeeded()
		await this.initializeDecoderSessionIfNeeded()
	}

	async initializeTokenizerIfNeeded() {
		if (this.tiktoken) {
			return
		}

		const logger = new Logger()
		await logger.startAsync('Load tokenizer data')

		const tiktokenModulePackagePath = await loadPackage('whisper-tiktoken-data')

		const tiktokenDataFilePath = path.join(tiktokenModulePackagePath, this.isMultiligualModel ? 'multilingual.tiktoken' : 'gpt2.tiktoken')
		let tiktokenData = await readFile(tiktokenDataFilePath, { encoding: 'utf8' })

		const tokenConfig = this.tokenConfig

		const metadataTokens: Record<number, string> = {
			[tokenConfig.endOfTextToken]: '[EndOfText]',
			[tokenConfig.startOfTextToken]: '[StartOfText]',
			[tokenConfig.translateTaskToken]: '[TranslateTask]',
			[tokenConfig.transcribeTaskToken]: '[TranscribeTask]',
			[tokenConfig.startOfPromptToken]: '[StartOfPrompt]',
			[tokenConfig.nonSpeechToken]: '[NonSpeech]',
			[tokenConfig.noTimestampsToken]: '[NoTimestamps]',
		}

		if (this.isMultiligualModel) {
			metadataTokens[50256] = '[Unused_50256]'
			metadataTokens[50360] = '[Unused_50360]'
		}

		const languageTokenCount = tokenConfig.languageTokensEnd - tokenConfig.languageTokensStart

		for (let i = 0; i < languageTokenCount; i++) {
			const tokenIndex = this.tokenConfig.languageTokensStart + i

			metadataTokens[tokenIndex] = `[Language_${i}]`
		}

		const timestampTokensCount = 1501

		for (let i = 0; i < timestampTokensCount; i++) {
			const tokenIndex = this.tokenConfig.timestampTokensStart + i
			const tokenTime = this.timestampTokenToSeconds(tokenIndex)

			metadataTokens[tokenIndex] = `[Timestamp_${tokenTime.toFixed(2)}]`
		}

		const inverseMetadataTokensLookup: Record<string, number> = {}

		for (const [key, value] of Object.entries(metadataTokens)) {
			inverseMetadataTokensLookup[value] = parseInt(key)
		}

		const patternString = `'s|'t|'re|'ve|'m|'ll|'d| ?\\p{L}+| ?\\p{N}+| ?[^\\s\\p{L}\\p{N}]+|\\s+(?!\\S)|\\s+`

		const { Tiktoken } = await import('tiktoken/lite')

		this.tiktoken = new Tiktoken(tiktokenData, inverseMetadataTokensLookup, patternString)

		logger.end()
	}

	async initializeEncoderSessionIfNeeded() {
		if (this.audioEncoder) {
			return
		}

		const logger = new Logger()

		await logger.startAsync(`Create encoder model inference session for model '${this.modelName}'`)

		const encoderFilePath = path.join(this.modelDir, 'encoder.onnx')

		const Onnx = await import('onnxruntime-node')

		this.audioEncoder = await Onnx.InferenceSession.create(encoderFilePath, this.onnxOptions)

		logger.end()
	}

	async initializeDecoderSessionIfNeeded() {
		if (this.textDecoder) {
			return
		}

		const logger = new Logger()

		await logger.startAsync(`Create decoder model inference session for model '${this.modelName}'`)

		const decoderFilePath = path.join(this.modelDir, 'decoder.onnx')

		const Onnx = await import('onnxruntime-node')

		this.textDecoder = await Onnx.InferenceSession.create(decoderFilePath, this.onnxOptions)

		logger.end()
	}

	async recognize(rawAudio: RawAudio, task: WhisperTask, language: string, options: WhisperOptions) {
		await this.initializeIfNeeded()

		const logger = new Logger()

		const audioSamples = rawAudio.audioChannels[0]
		const sampleRate = rawAudio.sampleRate
		const prompt = options.prompt

		const maxAudioSamplesPerPart = sampleRate * 30

		const decodeTimestampTokens = options.decodeTimestampTokens!

		let previousPartTextTokens: number[] = []

		let timeline: Timeline = []
		let allDecodedTokens: number[] = []

		for (let audioOffset = 0; audioOffset < audioSamples.length;) {
			const segmentStartTime = audioOffset / sampleRate

			await logger.startAsync(`\nPrepare audio part at time position ${segmentStartTime.toFixed(2)}`, undefined, chalk.magentaBright)

			const audioPartSamples = audioSamples.slice(audioOffset, audioOffset + maxAudioSamplesPerPart)
			const audioPartRawAudio: RawAudio = { audioChannels: [audioPartSamples], sampleRate }
			const audioPartDuration = getRawAudioDuration(audioPartRawAudio)

			logger.end()

			const audioPartFeatures = await this.encodeAudio(audioPartRawAudio)

			const isFirstPart = audioOffset === 0
			const isFinalPart = audioOffset + maxAudioSamplesPerPart >= audioSamples.length

			let initialTokens: number[] = []

			if (isFirstPart && prompt) {
				const promptTokens = this.textToTokens(prompt)

				initialTokens = [this.tokenConfig.startOfPromptToken, ...promptTokens]
			} else if (options.autoPromptParts && previousPartTextTokens.length > 0) {
				initialTokens = [this.tokenConfig.startOfPromptToken, ...previousPartTextTokens]
			}

			initialTokens = [...initialTokens, ...this.getTextStartTokens(language, task, !decodeTimestampTokens)]

			logger.end()

			let {
				decodedTokens: partTokens,
				crossAttentionQKs: partCrossAttentionQKs,
				decodedTokensConfidence
			} = await this.decodeTokens(audioPartFeatures, initialTokens, audioPartDuration, isFirstPart, isFinalPart, options)

			const lastToken = partTokens[partTokens.length - 1]
			const lastTokenIsTimestamp = this.isTimestampToken(lastToken)

			let audioEndOffset: number

			if (!isFinalPart && lastTokenIsTimestamp) {
				const timePosition = this.timestampTokenToSeconds(lastToken)

				audioEndOffset = audioOffset + Math.floor(timePosition * sampleRate)
			} else {
				audioEndOffset = Math.min(audioOffset + maxAudioSamplesPerPart, audioSamples.length)
			}

			const segmentEndTime = audioEndOffset / sampleRate
			const segmentFrameCount = this.secondsRangeToFrameCount(segmentStartTime, segmentEndTime)

			await logger.startAsync(`Extract timeline for part`)

			if (partTokens.length != partCrossAttentionQKs.length) {
				throw new Error('Unexpected: partTokens.length != partCrossAttentionQKs.length')
			}

			partTokens = partTokens.slice(initialTokens.length)

			//const compressionRatioForPart = (await getDeflateCompressionMetricsForString(this.tokensToText(partTokens))).ratio

			partCrossAttentionQKs = partCrossAttentionQKs.slice(initialTokens.length)

			const alignmentPath = await this.findAlignmentPathFromQKs(partCrossAttentionQKs, partTokens, 0, segmentFrameCount) //, alignmentHeadsIndexes[this.modelName])
			const partTimeline = await this.getTokenTimelineFromAlignmentPath(alignmentPath, partTokens, segmentStartTime, segmentEndTime, decodedTokensConfidence)

			audioOffset = audioEndOffset

			allDecodedTokens.push(...partTokens)
			timeline.push(...partTimeline)

			previousPartTextTokens = partTokens.filter(token => this.isTextToken(token))

			logger.end()
		}

		timeline = this.tokenTimelineToWordTimeline(timeline, language)

		const transcript = this.tokensToText(allDecodedTokens).trim()

		logger.end()

		return { transcript, timeline }
	}

	async align(rawAudio: RawAudio, referenceText: string, language: string) {
		await this.initializeIfNeeded()

		const logger = new Logger()

		await logger.startAsync('Prepare for alignment')

		referenceText = referenceText.replaceAll(/\s+/g, ' ')

		const audioDuration = Math.min(getRawAudioDuration(rawAudio), 30)
		const audioFrameCount = this.secondsToFrame(audioDuration)

		const initialTokens = this.getTextStartTokens(language, 'transcribe', true)

		const endOfTextToken = this.tokenConfig.endOfTextToken

		let tokens = [...initialTokens, ...this.textToTokens(referenceText), endOfTextToken]

		logger.end()
		const audioFeatures = await this.encodeAudio(rawAudio)

		await logger.startAsync('Infer cross-attention QKs')
		let crossAttentionQKs = await this.inferCrossAttentionQKs(tokens, audioFeatures)

		tokens = tokens.slice(initialTokens.length, tokens.length - 1)
		crossAttentionQKs = crossAttentionQKs.slice(initialTokens.length, crossAttentionQKs.length - 1)

		await logger.startAsync('Extract word timeline')
		const alignmentPath = await this.findAlignmentPathFromQKs(crossAttentionQKs, tokens, 0, audioFrameCount)//, this.getAlignmentHeadIndexes())
		const tokenTimeline = await this.getTokenTimelineFromAlignmentPath(alignmentPath, tokens, 0, audioDuration)

		const wordTimeline = this.tokenTimelineToWordTimeline(tokenTimeline, language)

		logger.end()

		return wordTimeline
	}

	async detectLanguage(audioFeatures: Onnx.Tensor, temperature: number): Promise<LanguageDetectionResults> {
		if (!this.isMultiligualModel) {
			throw new Error('Language detection is only supported with multilingual models')
		}

		await this.initializeTokenizerIfNeeded()
		await this.initializeDecoderSessionIfNeeded()

		// Prepare and run decoder
		const logger = new Logger()
		await logger.startAsync('Detect language with Whisper model')

		const sotToken = this.tokenConfig.startOfTextToken

		const initialTokens = [sotToken]
		const offset = 0

		const Onnx = await import('onnxruntime-node')

		const initialKvDimensions = this.getKvDimensions(1, initialTokens.length)
		const kvCacheTensor = new Onnx.Tensor('float32', new Float32Array(initialKvDimensions[0] * initialKvDimensions[1] * initialKvDimensions[2] * initialKvDimensions[3]), initialKvDimensions)

		const tokensTensor = new Onnx.Tensor('int64', new BigInt64Array(initialTokens.map(token => BigInt(token))), [1, initialTokens.length])
		const offsetTensor = new Onnx.Tensor('int64', new BigInt64Array([BigInt(offset)]), [])

		const decoderInputs = {
			tokens: tokensTensor,
			audio_features: audioFeatures,
			kv_cache: kvCacheTensor,
			offset: offsetTensor
		}

		const decoderOutputs = await this.textDecoder!.run(decoderInputs)
		const logitsBuffer = decoderOutputs['logits'].data as Float32Array

		const tokenConfig = this.tokenConfig

		const languageTokensLogits = Array.from(logitsBuffer.slice(tokenConfig.languageTokensStart, tokenConfig.languageTokensEnd))
		const languageTokensProbabilities = softmax(languageTokensLogits, temperature)

		const results: LanguageDetectionResults = []

		for (const language in languageIdLookup) {
			const langId = languageIdLookup[language]
			const probability = languageTokensProbabilities[langId]

			results.push({
				language,
				languageName: languageCodeToName(language),
				probability
			})
		}

		logger.end()

		return results
	}

	async decodeTokens(
		audioFeatures: Onnx.Tensor,
		initialTokens: number[],
		audioDuration: number,
		isFirstPart: boolean,
		isFinalPart: boolean,
		options: WhisperOptions) {

		await this.initializeTokenizerIfNeeded()
		await this.initializeDecoderSessionIfNeeded()

		const logger = new Logger()

		const allowedPunctuationMarks = this.getAllowedPunctuationMarks()

		await logger.startAsync('Decode text tokens with Whisper decoder model')

		options = extendDeep(defaultWhisperOptions, options)

		const Onnx = await import('onnxruntime-node')

		const endOfTextToken = this.tokenConfig.endOfTextToken

		const timestampTokensStart = this.tokenConfig.timestampTokensStart
		const suppressedTokens = new Set(this.getSuppressedTokens())

		const spaceToken = this.textToTokens(' ')[0]

		const maxDecodedTokenCount = options.maxTokensPerPart!

		let decodedTokens = initialTokens.slice()
		const initialKvDimensions = this.getKvDimensions(1, decodedTokens.length)
		let kvCacheTensor = new Onnx.Tensor('float32', new Float32Array(initialKvDimensions[0] * initialKvDimensions[1] * initialKvDimensions[2] * initialKvDimensions[3]), initialKvDimensions)

		let decodedTokensTimestampLogits: number[][] = [new Array(1501)]

		let lastTimestampTokenIndex = -1

		let timestampsSeenCount = 0

		const decodedTokensConfidence: number[] = []
		let decodedTokensCrossAttentionQKs: Onnx.Tensor[] = []

		for (let i = 0; i < decodedTokens.length; i++) {
			decodedTokensCrossAttentionQKs.push(undefined as any)
		}

		let bufferedTokensToPrint: number[] = []

		// Start decoding loop
		for (let decodedTokenCount = 0; decodedTokenCount < maxDecodedTokenCount; decodedTokenCount++) {
			const isInitialState = decodedTokens.length == initialTokens.length

			const tokensToDecode = isInitialState ? decodedTokens : [decodedTokens[decodedTokens.length - 1]]
			const offset = isInitialState ? 0 : decodedTokens.length

			if (!isInitialState) {
				// Reshape KV Cache tensor
				const dims = kvCacheTensor.dims

				const currentKvCacheGroups = splitFloat32Array(kvCacheTensor.data as Float32Array, dims[2] * dims[3])

				const reshapedKvCacheTensor = new Onnx.Tensor('float32', new Float32Array(dims[0] * dims[1] * (decodedTokens.length) * dims[3]), [dims[0], dims[1], decodedTokens.length, dims[3]])
				const reshapedKvCacheGroups = splitFloat32Array(reshapedKvCacheTensor.data, decodedTokens.length * dims[3])

				for (let i = 0; i < dims[0]; i++) {
					reshapedKvCacheGroups[i].set(currentKvCacheGroups[i])
				}

				kvCacheTensor = reshapedKvCacheTensor
			}

			// Prepare and run decoder
			const tokensTensor = new Onnx.Tensor('int64', new BigInt64Array(tokensToDecode.map(token => BigInt(token))), [1, tokensToDecode.length])
			const offsetTensor = new Onnx.Tensor('int64', new BigInt64Array([BigInt(offset)]), [])

			const decoderInputs = { tokens: tokensTensor, audio_features: audioFeatures, kv_cache: kvCacheTensor, offset: offsetTensor }

			const decoderOutputs = await this.textDecoder!.run(decoderInputs)

			const logitsBuffer = decoderOutputs['logits'].data as Float32Array
			kvCacheTensor = decoderOutputs['output_kv_cache'] as any

			// Compute logits
			const resultLogits = splitFloat32Array(logitsBuffer, logitsBuffer.length / decoderOutputs['logits'].dims[1])
			const allTokenLogits = Array.from(resultLogits[resultLogits.length - 1])
			const timestampTokenLogits = allTokenLogits.slice(timestampTokensStart)

			// Suppress logits for tokens in the suppressed set
			for (let logitIndex = 0; logitIndex < allTokenLogits.length; logitIndex++) {
				const isWrongTokenForInitialState =
					isInitialState &&
					(logitIndex === spaceToken || logitIndex === endOfTextToken)

				const isInSuppressedList = suppressedTokens.has(logitIndex)

				const shouldSuppressToken = isWrongTokenForInitialState || isInSuppressedList

				if (shouldSuppressToken) {
					allTokenLogits[logitIndex] = -Infinity
				}
			}

			// Add best token
			function addToken(tokenToAdd: number, timestampLogits: number[], confidence: number) {
				decodedTokens.push(tokenToAdd)
				decodedTokensTimestampLogits.push(timestampLogits)
				decodedTokensCrossAttentionQKs.push(decoderOutputs['cross_attention_qks'])
				decodedTokensConfidence.push(confidence)
			}

			let shouldDecodeNonTimestampToken = true

			if (options.decodeTimestampTokens) {
				// Derive token probabilities
				const probabilities = softmax(allTokenLogits as any, 1.0)
				const logProbabilities = logOfVector(probabilities)

				const nonTimestampTokenLogProbs = logProbabilities.slice(0, timestampTokensStart)

				const indexOfMaxNonTimestampLogProb = indexOfMax(nonTimestampTokenLogProbs)
				const valueOfMaxNonTimestampLogProb = nonTimestampTokenLogProbs[indexOfMaxNonTimestampLogProb]

				const timestampTokenLogProbs = logProbabilities.slice(timestampTokensStart)
				const indexOfMaxTimestampLogProb = indexOfMax(timestampTokenLogProbs)

				const logSumExpOfTimestampTokenLogProbs = logSumExp(timestampTokenLogProbs)

				const shouldDecodeTimestampToken = logSumExpOfTimestampTokenLogProbs > valueOfMaxNonTimestampLogProb

				const previousTokenWasTimestamp = this.isTimestampToken(decodedTokens[decodedTokens.length - 1])
				const secondPreviousTokenWasTimestamp = decodedTokens.length < 2 || this.isTimestampToken(decodedTokens[decodedTokens.length - 2])

				if (shouldDecodeTimestampToken && !previousTokenWasTimestamp) {
					timestampsSeenCount += 1
				}

				if (shouldDecodeTimestampToken || (previousTokenWasTimestamp && !secondPreviousTokenWasTimestamp)) {
					if (previousTokenWasTimestamp) {
						const previousToken = decodedTokens[decodedTokens.length - 1]
						const previousTokenTimestampLogits = decodedTokensTimestampLogits[decodedTokensTimestampLogits.length - 1]
						const previousTokenConfidence = decodedTokensConfidence[decodedTokensConfidence.length - 1]

						addToken(previousToken, previousTokenTimestampLogits, previousTokenConfidence)

						lastTimestampTokenIndex = decodedTokens.length

						const previousTokenTimestamp = this.timestampTokenToSeconds(previousToken)

						if (previousTokenTimestamp >= audioDuration) {
							break
						}
					} else {
						const timestampToken = timestampTokensStart + indexOfMaxTimestampLogProb
						const confidence = probabilities[timestampToken]

						addToken(timestampToken, timestampTokenLogits, confidence)
					}

					shouldDecodeNonTimestampToken = false
				}
			}

			if (shouldDecodeNonTimestampToken) {
				const topLogitCount = options.topCandidateCount!

				const nonTimestampTokenLogits = allTokenLogits.slice(0, timestampTokensStart)

				const sortedNonTimestampTokenLogitsWithIndexes =
					Array.from(nonTimestampTokenLogits).map((logit, index) => ({ token: index, logit }))

				sortedNonTimestampTokenLogitsWithIndexes.sort((a, b) => b.logit - a.logit)

				let topCandidates = sortedNonTimestampTokenLogitsWithIndexes.slice(0, topLogitCount)
					.map(entry => ({
						token: entry.token,
						logit: entry.logit,
						text: this.tokenToText(entry.token, true)
					}))

				//// Repetition suppression code
				if (options.suppressRepetition) {
					const topCandidatesRepetitionScores = topCandidates.map(entry => {
						const lastDecodedTextTokens = decodedTokens.filter(token => this.isTextToken(token)).reverse().slice(0, 20)
						const { maxScore } = getRepetitionScoreRelativeToFirstSubstring([entry.token, ...lastDecodedTextTokens])

						return maxScore
					})

					const thresholdRepetitionScore = 4

					if (topCandidatesRepetitionScores.every(score => score >= thresholdRepetitionScore)) {
						const indexOfMaxScore = topCandidatesRepetitionScores.indexOf(Math.max(...topCandidatesRepetitionScores))
						topCandidates = [topCandidates[indexOfMaxScore]]
					} else {
						topCandidates = topCandidates.filter((candidate, index) => topCandidatesRepetitionScores[index] < thresholdRepetitionScore)
					}
				}
				////

				const topCandidateProbabilities = softmax(topCandidates.map(a => a.logit), options.temperature)

				//// Remove end-of-text token from candidates if its probability isn't high enough
				if (options.decodeTimestampTokens === false) {
					topCandidates = topCandidates.filter((candidate, index) => {
						if (candidate.token === endOfTextToken) {
							return topCandidateProbabilities[index] >= 0.9
						}

						return true
					})
				}
				////

				const rankOfPromisingPunctuationToken = topCandidates.findIndex((entry, index) => {
					const tokenText = this.tokenToText(entry.token).trim()

					const isPunctuationToken = allowedPunctuationMarks.includes(tokenText)

					if (!isPunctuationToken) {
						return false
					}

					const tokenProb = topCandidateProbabilities[index]

					return tokenProb >= options.punctuationThreshold!
				})

				let rankOfSpaceToken = topCandidates.findIndex(candidate => candidate.token === spaceToken)

				if (rankOfSpaceToken < 0) {
					rankOfSpaceToken = Infinity
				}

				let chosenCandidateRank: number

				if (rankOfPromisingPunctuationToken >= 0 &&
					rankOfPromisingPunctuationToken < rankOfSpaceToken) {
					chosenCandidateRank = rankOfPromisingPunctuationToken
				} else {
					chosenCandidateRank = this.randomGen.selectRandomIndexFromDistribution(topCandidateProbabilities)
				}

				const chosenToken = topCandidates[chosenCandidateRank].token
				const chosenTokenConfidence = topCandidateProbabilities[chosenCandidateRank]

				addToken(chosenToken, timestampTokenLogits, chosenTokenConfidence)

				if (chosenToken === endOfTextToken) {
					break
				}

				if (this.isTextToken(chosenToken)) {
					bufferedTokensToPrint.push(chosenToken)

					let textToPrint = this.tokensToText(bufferedTokensToPrint)

					if (textToPrint.codePointAt(0) !== 65533) {
						if (isFirstPart && decodedTokens.every(token => this.isMetadataToken(token))) {
							textToPrint = textToPrint.trimStart()
						}

						logger.write(textToPrint)

						bufferedTokensToPrint = []
					}
				}
			}

			await yieldToEventLoop()
		}

		if (timestampsSeenCount >= 2 && !isFinalPart) {
			decodedTokens = decodedTokens.slice(0, lastTimestampTokenIndex)
			decodedTokensTimestampLogits = decodedTokensTimestampLogits.slice(0, lastTimestampTokenIndex)
			decodedTokensCrossAttentionQKs = decodedTokensCrossAttentionQKs.slice(0, lastTimestampTokenIndex)
		}

		logger.write('\n')
		logger.end()

		// Return the tokens
		return {
			decodedTokens,
			decodedTokensTimestampLogits,
			crossAttentionQKs: decodedTokensCrossAttentionQKs,
			decodedTokensConfidence
		}
	}

	async inferCrossAttentionQKs(tokens: number[], audioFeatures: Onnx.Tensor) {
		const offset = 0

		const Onnx = await import('onnxruntime-node')

		const tokensTensor = new Onnx.Tensor('int64', new BigInt64Array(tokens.map(token => BigInt(token))), [1, tokens.length])
		const offsetTensor = new Onnx.Tensor('int64', new BigInt64Array([BigInt(offset)]), [])

		const initialKvDimensions = this.getKvDimensions(1, tokens.length)
		const kvCacheTensor = new Onnx.Tensor('float32', new Float32Array(initialKvDimensions[0] * initialKvDimensions[1] * initialKvDimensions[2] * initialKvDimensions[3]), initialKvDimensions)

		const decoderInputs = { tokens: tokensTensor, audio_features: audioFeatures, kv_cache: kvCacheTensor, offset: offsetTensor }

		const decoderOutputs = await this.textDecoder!.run(decoderInputs)

		const crossAttentionQKsTensor = decoderOutputs['cross_attention_qks']

		const tensorShape = crossAttentionQKsTensor.dims.slice()

		const ndarray = (await import('ndarray')).default

		let qkArray = ndarray(crossAttentionQKsTensor.data, crossAttentionQKsTensor.dims.slice())
		qkArray = qkArray.transpose(3, 0, 1, 2, 4)

		const tokenCrossAttentionQKsTensors: Onnx.Tensor[] = []

		for (let i0 = 0; i0 < qkArray.shape[0]; i0++) {
			const dataForToken: number[] = []

			for (let i1 = 0; i1 < qkArray.shape[1]; i1++) {
				for (let i2 = 0; i2 < qkArray.shape[2]; i2++) {
					for (let i3 = 0; i3 < qkArray.shape[3]; i3++) {
						for (let i4 = 0; i4 < qkArray.shape[4]; i4++) {
							dataForToken.push(qkArray.get(i0, i1, i2, i3, i4) as number)
						}
					}
				}
			}

			const newTensorShape = tensorShape.slice()
			newTensorShape[3] = 1

			const newTensor = new Onnx.Tensor('float32', dataForToken, newTensorShape)

			tokenCrossAttentionQKsTensors.push(newTensor)
		}

		return tokenCrossAttentionQKsTensors
	}

	async encodeAudio(rawAudio: RawAudio) {
		await this.initializeEncoderSessionIfNeeded()

		const Onnx = await import('onnxruntime-node')

		const logger = new Logger()

		const audioSamples = rawAudio.audioChannels[0]
		const sampleRate = rawAudio.sampleRate

		const fftOrder = 400
		const hopLength = 160
		const filterbankCount = 80

		const maxAudioSamples = sampleRate * 30
		const maxAudioFrames = 3000

		await logger.startAsync('Extract mel spectogram from audio part')

		const paddedAudioSamples = new Float32Array(maxAudioSamples)
		paddedAudioSamples.set(audioSamples.subarray(0, maxAudioSamples), 0)

		const rawAudioPart: RawAudio = { audioChannels: [paddedAudioSamples], sampleRate }

		const { melSpectogram } = await computeMelSpectogramUsingFilterbanks(rawAudioPart, fftOrder, fftOrder, hopLength, filterbanks)

		await logger.startAsync('Normalize mel spectogram')

		const logMelSpectogram = melSpectogram.map(spectrum => spectrum.map(mel => Math.log10(Math.max(mel, 1e-10))))
		let maxLogMel = -Infinity

		for (const spectrum of logMelSpectogram) {
			for (const mel of spectrum) {
				if (mel > maxLogMel) {
					maxLogMel = mel
				}
			}
		}

		const normalizedLogMelSpectogram = logMelSpectogram.map(spectrum => spectrum.map(
			logMel => (Math.max(logMel, maxLogMel - 8) + 4) / 4))

		const flattenedNormalizedLogMelSpectogram = new Float32Array(maxAudioFrames * filterbankCount)

		for (let i = 0; i < filterbankCount; i++) {
			for (let j = 0; j < maxAudioFrames; j++) {
				flattenedNormalizedLogMelSpectogram[(i * maxAudioFrames) + j] = normalizedLogMelSpectogram[j][i]
			}
		}

		await logger.startAsync('Encode mel spectogram with Whisper encoder model')

		const inputTensor = new Onnx.Tensor('float32', flattenedNormalizedLogMelSpectogram, [1, filterbankCount, maxAudioFrames])

		const encoderInputs = { mel: inputTensor }

		const encoderOutputs = await this.audioEncoder!.run(encoderInputs)
		const encodedAudioFeatures = encoderOutputs['output']

		logger.end()

		return encodedAudioFeatures
	}

	addSegmentsToTimeline(timeline: Timeline, tokens: number[], initialTimeOffset: number, audioDuration: number) {
		const timestampTokensStart = this.tokenConfig.timestampTokensStart

		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i]

			if (token == this.tokenConfig.startOfTextToken || token == this.tokenConfig.endOfTextToken) {
				continue
			}

			const tokenIsTimestamp = token >= timestampTokensStart
			const previousTokenWasTimestamp = tokens.length > 1 && tokens[i - 1] >= timestampTokensStart

			if (tokenIsTimestamp) {
				if (previousTokenWasTimestamp) {
					continue
				}

				let startTime = initialTimeOffset + this.timestampTokenToSeconds(token)

				startTime = Math.min(startTime, audioDuration)

				if (timeline.length > 0) {
					timeline[timeline.length - 1].endTime = startTime
				}

				timeline.push({
					type: 'segment',
					text: '',
					startTime,
					endTime: -1,
				})
			} else {
				if (timeline.length == 0) {
					timeline.push({
						type: 'segment',
						text: '',
						startTime: initialTimeOffset,
						endTime: -1,
					})
				}

				const tokenText = this.tokenToText(token)

				timeline[timeline.length - 1].text += tokenText
			}
		}
	}

	async addWordsToTimeline(timeline: Timeline, tokens: number[], rawAudio: RawAudio, crossAttentionQKs: Onnx.Tensor[], initialAudioTimeOffset: number, duration: number) {
		let segmentStartTime = 0
		let segmentTokens: number[] = []
		let segmentCrossAttentionQKs: Onnx.Tensor[] = []

		for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
			const token = tokens[tokenIndex]
			const tokenCrossAttentionQKs = crossAttentionQKs[tokenIndex]

			const segmentTokensWithoutTimestamps = segmentTokens.filter(token => this.isNonTimestampToken(token))

			const isTimestamp = this.isTimestampToken(token)

			if (isTimestamp || tokenIndex == tokens.length - 1) {
				let tokenTime: number

				if (isTimestamp) {
					tokenTime = this.timestampTokenToSeconds(token)
				} else {
					tokenTime = duration
				}

				if (segmentTokensWithoutTimestamps.length > 0) {
					const segmentEndTime = tokenTime

					const segmentStartFrame = this.secondsToFrame(segmentStartTime)
					let segmentEndFrame = this.secondsToFrame(segmentEndTime)

					if (segmentStartFrame == segmentEndFrame) {
						segmentEndFrame += 1
					}

					const segmentFrameCount = segmentEndFrame - segmentStartFrame

					const reinferCrossAttentionQKs = true

					if (reinferCrossAttentionQKs) {
						const initialTokens = this.getTextStartTokens('en', 'transcribe')
						const tokensToDecode = [...initialTokens, ...segmentTokensWithoutTimestamps]

						//const segmentAudioFeaturesBuffer = audioFeatures.data.slice(segmentStartFrame * audioFeatures.dims[2], segmentEndFrame * audioFeatures.dims[2])
						//const segmentAudioFeatures = new Onnx.Tensor('float32', segmentAudioFeaturesBuffer, [1, segmentFrameCount, audioFeatures.dims[2]])

						const segmentAudioSamples = rawAudio.audioChannels[0].slice(Math.floor(segmentStartTime * rawAudio.sampleRate), Math.floor(segmentEndTime * rawAudio.sampleRate))
						const segmentRawAudio: RawAudio = { audioChannels: [segmentAudioSamples], sampleRate: rawAudio.sampleRate }

						const segmentAudioFeatures = await this.encodeAudio(segmentRawAudio)

						const reinferredCrossAttentionQKs = await this.inferCrossAttentionQKs(tokensToDecode, segmentAudioFeatures)
						reinferredCrossAttentionQKs.slice(initialTokens.length)

						const alignmentPath = await this.findAlignmentPathFromQKs(reinferredCrossAttentionQKs, tokensToDecode, 0, segmentFrameCount)//, alignmentHeadsIndexes[modelName])
						const tokenTimeline = await this.getTokenTimelineFromAlignmentPath(alignmentPath, segmentTokensWithoutTimestamps, initialAudioTimeOffset + segmentStartTime, initialAudioTimeOffset + segmentEndTime)

						timeline.push(...tokenTimeline)
					} else {
						const alignmentPath = await this.findAlignmentPathFromQKs(segmentCrossAttentionQKs, segmentTokens, segmentStartFrame, segmentEndFrame)//, alignmentHeadsIndexes[modelName])
						const tokenTimeline = await this.getTokenTimelineFromAlignmentPath(alignmentPath, segmentTokens, initialAudioTimeOffset, initialAudioTimeOffset + segmentEndTime)

						timeline.push(...tokenTimeline)
					}
				}

				segmentStartTime = tokenTime
				segmentTokens = []
				segmentCrossAttentionQKs = []
			}

			segmentTokens.push(token)
			segmentCrossAttentionQKs.push(tokenCrossAttentionQKs)
		}
	}

	tokenTimelineToWordTimeline(tokenTimeline: Timeline, language: string): Timeline {
		function isSeparatorCharacter(char: string) {
			const nonSeparatingPunctuation = [`'`, `-`, `.`, `·`, `•`]

			if (nonSeparatingPunctuation.includes(char)) {
				return false
			}

			return isWhitespace(char) || isPunctuation(char)
		}

		function startsWithSeparatorCharacter(text: string) {
			return isSeparatorCharacter(text[0])
		}

		function endsWithSeparatorCharacter(text: string) {
			return isSeparatorCharacter(text[text.length - 1])
		}

		const resultTimeline: Timeline = []

		let groups: Timeline[] = []

		for (let tokenIndex = 0; tokenIndex < tokenTimeline.length; tokenIndex++) {
			const entry = tokenTimeline[tokenIndex]
			const previousEntry = tokenIndex > 0 ? tokenTimeline[tokenIndex - 1] : undefined

			const text = entry.text
			const previousEntryText = previousEntry?.text

			if (groups.length == 0 ||
				text === '' ||
				startsWithSeparatorCharacter(text) ||
				(previousEntryText != null && endsWithSeparatorCharacter(previousEntryText))) {

				groups.push([entry])
			} else {
				groups[groups.length - 1].push(entry)
			}
		}

		{
			const splitGroups: Timeline[] = []

			for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
				const group = groups[groupIndex]
				const nextGroup = groups[groupIndex + 1]

				if (
					group.length > 1 &&
					group[group.length - 1].text === '.' &&
					(!nextGroup || [' ', '['].includes(nextGroup[0].text[0]))) {

					splitGroups.push(group.slice(0, group.length - 1))
					splitGroups.push(group.slice(group.length - 1))
				} else {
					splitGroups.push(group)
				}
			}

			groups = splitGroups
		}

		for (const group of groups) {
			let groupText = this.tokensToText(group.map(entry => entry.id!))

			if (groupText === '') {
				continue
			}

			const startTime = group[0].startTime
			const endTime = group[group.length - 1].endTime
			let confidence: number | undefined = undefined

			if (group[0].confidence != null) {
				confidence = meanOfVector(group.map(entry => entry.confidence!))
			}

			const newEntry: TimelineEntry = {
				type: 'word',
				text: groupText.trim(),
				startTime,
				endTime,
				confidence,
				timeline: group,
			}

			resultTimeline.push(newEntry)
		}

		return resultTimeline
	}

	async getTokenTimelineFromAlignmentPath(alignmentPath: AlignmentPath, tokens: number[], startTimeOffset: number, endTimeOffset: number, tokensConfidence?: number[], correctionAmount = 0.0) {
		if (alignmentPath.length == 0) {
			return []
		}

		const tokenTimeline: Timeline = []

		for (let pathIndex = 0; pathIndex < alignmentPath.length; pathIndex++) {
			if (pathIndex != 0 && alignmentPath[pathIndex].source == alignmentPath[pathIndex - 1].source) {
				continue
			}

			const tokenMappingEntry = alignmentPath[pathIndex]

			const tokenIndex = tokenMappingEntry.source
			const token = tokens[tokenIndex]
			const tokenConfidence = tokensConfidence ? tokensConfidence[tokenIndex] : undefined
			const tokenText = this.tokenToText(token, true)

			let startTime = startTimeOffset + (tokenMappingEntry.dest * 0.02)

			startTime = Math.max(startTime + correctionAmount, startTimeOffset)

			if (tokenTimeline.length > 0) {
				tokenTimeline[tokenTimeline.length - 1].endTime = startTime
			}

			tokenTimeline.push({
				type: 'token',
				text: tokenText,
				id: token,
				startTime,
				endTime: -1,
				confidence: tokenConfidence
			})
		}

		if (tokenTimeline.length > 0) {
			tokenTimeline[tokenTimeline.length - 1].endTime = endTimeOffset
		}

		return tokenTimeline
	}

	async findAlignmentPathFromQKs(qksTensors: Onnx.Tensor[], tokens: number[], segmentStartFrame: number, segmentEndFrame: number, headIndexes?: number[]) {
		const segmentFrameCount = segmentEndFrame - segmentStartFrame

		if (segmentFrameCount === 0 || tokens.length === 0 || qksTensors.length === 0) {
			return []
		}

		const tokenCount = qksTensors.length
		const layerCount = qksTensors[0].dims[0]
		const headCount = qksTensors[0].dims[2]
		const frameCount = qksTensors[0].dims[4]

		if (!headIndexes) {
			headIndexes = []

			for (let i = 0; i < layerCount * headCount; i++) {
				//for (let i = Math.floor(layerCount * headCount / 2); i < layerCount * headCount; i++) {
				headIndexes.push(i)
			}
		}

		// Load attention head weights from tensors
		const attentionHeads: number[][][] = [] // structure: [heads, tokens, frames]

		for (const headIndex of headIndexes) {
			const attentionHead: number[][] = [] // structure: [tokens, frames]

			for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex++) {
				const bufferOffset = headIndex * frameCount
				const startIndexInBuffer = bufferOffset + segmentStartFrame
				const endIndexInBuffer = bufferOffset + segmentEndFrame

				const framesForHead = qksTensors[tokenIndex].data.slice(startIndexInBuffer, endIndexInBuffer)

				attentionHead.push(Array.from(framesForHead as any))
			}

			attentionHeads.push(attentionHead)
		}

		const applySoftmax = true
		const normalize = true
		const applyMedianFilter = true
		const fixateTimestampTokens = false

		const softmaxTemperature = 1.0
		const medianFilterWidth = 7

		if (applySoftmax) {
			// Apply softmax to each token's frames
			for (const head of attentionHeads) {
				for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex++) {
					head[tokenIndex] = softmax(head[tokenIndex], softmaxTemperature)
				}
			}
		}

		if (normalize) {
			// Normalize all weights in each individual head
			for (const head of attentionHeads) {
				const allWeightsForHead = head.flatMap(tokenFrames => tokenFrames)

				const meanOfAllWeights = meanOfVector(allWeightsForHead)
				const stdDeviationOfAllWeights = stdDeviationOfVector(allWeightsForHead) + 1e-10

				for (const tokenFrames of head) {
					for (let frameIndex = 0; frameIndex < tokenFrames.length; frameIndex++) {
						tokenFrames[frameIndex] = (tokenFrames[frameIndex] - meanOfAllWeights) / stdDeviationOfAllWeights
					}
				}
			}
		}

		if (applyMedianFilter) {
			// Apply median filter to each token's frames
			for (const head of attentionHeads) {
				for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex++) {
					head[tokenIndex] = medianFilter(head[tokenIndex], medianFilterWidth)
				}
			}
		}

		// Compute the mean for all layers and heads
		const frameMeansForToken: number[][] = []

		for (let i = 0; i < tokenCount; i++) {
			const frameMeans = new Array(segmentFrameCount)

			frameMeansForToken.push(frameMeans)
		}

		for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex++) {
			for (let frameIndex = 0; frameIndex < segmentFrameCount; frameIndex++) {
				let sum = 0

				for (const head of attentionHeads) {
					sum += head[tokenIndex][frameIndex]
				}

				const frameMean = sum / attentionHeads.length

				frameMeansForToken[tokenIndex][frameIndex] = frameMean
			}
		}

		if (fixateTimestampTokens) {
			// Fixate timestamp tokens to the original ones detected
			const timestampTokensStart = this.tokenConfig.timestampTokensStart

			for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
				const token = tokens[tokenIndex]

				if (this.isTimestampToken(token)) {
					let timestampFrame = token - timestampTokensStart

					timestampFrame = clip(timestampFrame, segmentStartFrame, segmentEndFrame - 1)

					frameMeansForToken[tokenIndex][timestampFrame] = 100
				}
			}
		}

		// Perform DTW
		const tokenIndexes = [...Array(tokenCount).keys()]
		const frameIndexes = [...Array(segmentFrameCount).keys()]

		let { path } = alignDTWWindowed(tokenIndexes, frameIndexes, (tokenIndex, frameIndex) => {
			return -frameMeansForToken[tokenIndex][frameIndex]
		}, segmentFrameCount)

		path = path.map(entry => ({ source: entry.source, dest: segmentStartFrame + entry.dest }))

		return path
	}

	getKvDimensions(groupCount: number, length: number) {
		const modelName = this.modelName

		if (modelName == 'tiny' || modelName == 'tiny.en') {
			return [8, groupCount, length, 384]
		} else if (modelName == 'base' || modelName == 'base.en') {
			return [12, groupCount, length, 512]
		} else if (modelName == 'small' || modelName == 'small.en') {
			return [24, groupCount, length, 768]
		} else if (modelName == 'medium' || modelName == 'medium.en') {
			return [48, groupCount, length, 1024]
		} else if (modelName == 'large' || modelName == 'large-v1' || modelName == 'large-v2' || modelName == 'large-v3') {
			return [64, groupCount, length, 1280]
		} else {
			throw new Error(`Unsupported model: ${modelName}`)
		}
	}

	getTextStartTokens(language: string, task: WhisperTask, disableTimestamps = false) {
		const startOfTextToken = this.tokenConfig.startOfTextToken

		let tokens: number[]

		if (this.isMultiligualModel) {
			const languageToken = this.tokenConfig.languageTokensStart + languageIdLookup[language]
			const taskToken = task == 'translate' ? this.tokenConfig.translateTaskToken : this.tokenConfig.transcribeTaskToken

			tokens = [startOfTextToken, languageToken, taskToken]
		} else {
			tokens = [startOfTextToken]
		}

		if (disableTimestamps) {
			tokens.push(this.tokenConfig.noTimestampsToken)
		}

		return tokens
	}

	tokenToText(token: number, includeMetadataTokens = false) {
		return this.tokensToText([token], includeMetadataTokens)
	}

	tokensToText(tokens: number[], includeMetadataTokens = false) {
		tokens.forEach(token => this.assertIsValidToken(token))

		if (includeMetadataTokens === false) {
			tokens = tokens.filter(token => this.isTextToken(token))
		}

		if (tokens.length === 0) {
			return ''
		}

		try {
			return Buffer.from(this.tiktoken!.decode(new Uint32Array(tokens))).toString('utf8')
		} catch {
			return '[TOKENIZER_FAILED]'
		}
	}

	textToTokens(text: string) {
		return Array.from(this.tiktoken!.encode(text))
	}

	isTextToken(token: number) {
		return token < this.tokenConfig.endOfTextToken
	}

	isMetadataToken(token: number) {
		return token >= this.tokenConfig.endOfTextToken
	}

	isLanguageToken(token: number) {
		return token >= this.tokenConfig.languageTokensStart && token < this.tokenConfig.languageTokensEnd
	}

	isTimestampToken(token: number) {
		return token >= this.tokenConfig.timestampTokensStart
	}

	isNonTimestampToken(token: number) {
		return token < this.tokenConfig.timestampTokensStart
	}

	timestampTokenToSeconds(timestampToken: number) {
		this.assertIsValidToken(timestampToken)

		if (this.isNonTimestampToken(timestampToken)) {
			throw new Error(`Invalid timestamp token: ${timestampToken}`)
		}

		return (timestampToken - this.tokenConfig.timestampTokensStart) * 0.02
	}

	isValidToken(token: number) {
		return token < this.tokenConfig.timestampTokensEnd
	}

	assertIsValidToken(token: number) {
		if (!this.isValidToken(token)) {
			throw new Error(`Invalid token: ${token}`)
		}
	}

	secondsToFrame(seconds: number) {
		return Math.floor(seconds / 0.02)
	}

	secondsRangeToFrameCount(startSeconds: number, endSeconds: number) {
		if (startSeconds > endSeconds) {
			throw new Error(`Invalid range: ${startSeconds} > ${endSeconds}`)
		}

		return this.secondsToFrame(endSeconds - startSeconds)
	}

	languageTokenToLanguageIndex(languageToken: number) {
		if (!this.isLanguageToken(languageToken)) {
			throw new Error(`Invalid language token: ${languageToken}`)
		}

		let languageIndex = languageToken - this.tokenConfig.languageTokensStart

		if (this.isEnglishOnlyModel) {
			languageIndex += 1
		}
	}

	get isEnglishOnlyModel() {
		return this.isMultiligualModel === false
	}

	getAlignmentHeadIndexes() {
		return alignmentHeadsIndexes[this.modelName]
	}

	getSuppressedTokens() {
		return [
			...this.getSuppressedTextTokens(),
			...this.getSuppressedMetadataTokens(),
		]
	}

	getSuppressedTextTokens() {
		const allowedPunctuationMarks = this.getAllowedPunctuationMarks()

		const nonWordTokensData = this.getNonWordTokenData()

		const suppressedTextTokens = nonWordTokensData
			.filter(entry => !allowedPunctuationMarks.includes(entry.text))
			.map(entry => entry.id)

		return suppressedTextTokens
	}

	getSuppressedMetadataTokens() {
		if (this.isMultiligualModel) {
			return [50256, ...getIntegerRange(50258, 50364)]
		} else {
			return [...getIntegerRange(50257, 50363)]
		}
	}

	getAllowedPunctuationMarks() {
		const generalPunctuation = [`'`, ',', '.', '?', '!']

		let allowedPunctuation: string[]

		if (this.isMultiligualModel) {
			const spanish = ['¿', '¡']
			const chinese = ['、', '，', '。', '？', '！']
			const arabic = ['،', '؟']
			const various = ['·', '•', '・']

			allowedPunctuation = [...generalPunctuation, ...arabic, ...chinese, ...spanish, ...various]
		} else {
			allowedPunctuation = generalPunctuation
		}

		return allowedPunctuation
	}

	getNonWordTokenData() {
		const nonWordTokenData: WhisperTokenData[] = []

		const invalidUTF8Char = String.fromCharCode(65533)

		for (let i = 0; i < this.tokenConfig.endOfTextToken; i++) {
			const tokenText = this.tokenToText(i, false)
			const tokenTextWithoutWhitespace = tokenText.replaceAll(/\s/g, '')

			const isNonWordToken = /^[\p{Punctuation}\p{Symbol}]+$/u.test(tokenTextWithoutWhitespace)

			const containsInvalidUTF8 = getUTF32Chars(tokenTextWithoutWhitespace).utf32chars.includes(invalidUTF8Char)

			if (isNonWordToken && !containsInvalidUTF8) {
				nonWordTokenData.push({
					id: i,
					text: tokenText,
				})
			}
		}

		return nonWordTokenData
	}


	getTokensData(tokens: number[]) {
		const tokensData: WhisperTokenData[] = []

		for (const token of tokens) {
			tokensData.push({
				id: token,
				text: this.tokenToText(token, true),
			})
		}

		return tokensData
	}
}

const filterbanks: Filterbank[] = [
/* 0 */ { startIndex: 1, weights: [0.02486259490251541,] },

/* 1 */ { startIndex: 1, weights: [0.001990821911022067, 0.022871771827340126,] },

/* 2 */ { startIndex: 2, weights: [0.003981643822044134, 0.02088095061480999,] },

/* 3 */ { startIndex: 3, weights: [0.0059724655002355576, 0.018890129402279854,] },

/* 4 */ { startIndex: 4, weights: [0.007963287644088268, 0.01689930632710457,] },

/* 5 */ { startIndex: 5, weights: [0.009954108856618404, 0.014908484183251858,] },

/* 6 */ { startIndex: 6, weights: [0.011944931000471115, 0.012917662039399147,] },

/* 7 */ { startIndex: 7, weights: [0.013935752213001251, 0.010926840826869011,] },

/* 8 */ { startIndex: 8, weights: [0.015926575288176537, 0.0089360186830163,] },

/* 9 */ { startIndex: 9, weights: [0.017917396500706673, 0.006945197004824877,] },

/* 10 */ { startIndex: 10, weights: [0.01990821771323681, 0.004954374860972166,] },

/* 11 */ { startIndex: 11, weights: [0.021899040788412094, 0.0029635531827807426,] },

/* 12 */ { startIndex: 12, weights: [0.02388986200094223, 0.0009727313299663365,] },

/* 13 */ { startIndex: 13, weights: [0.025880683213472366,] },

/* 14 */ { startIndex: 14, weights: [0.025835324078798294,] },

/* 15 */ { startIndex: 14, weights: [0.0010180906392633915, 0.023844502866268158,] },

/* 16 */ { startIndex: 15, weights: [0.003008912317454815, 0.021853681653738022,] },

/* 17 */ { startIndex: 16, weights: [0.004999734461307526, 0.019862858578562737,] },

/* 18 */ { startIndex: 17, weights: [0.006990555673837662, 0.0178720373660326,] },

/* 19 */ { startIndex: 18, weights: [0.008981377817690372, 0.015881216153502464,] },

/* 20 */ { startIndex: 19, weights: [0.010972199961543083, 0.013890394009649754,] },

/* 21 */ { startIndex: 20, weights: [0.01296302117407322, 0.011899571865797043,] },

/* 22 */ { startIndex: 21, weights: [0.01495384331792593, 0.009908749721944332,] },

/* 23 */ { startIndex: 22, weights: [0.01694466546177864, 0.007917927578091621,] },

/* 24 */ { startIndex: 23, weights: [0.018935488536953926, 0.005927106365561485,] },

/* 25 */ { startIndex: 24, weights: [0.020874010398983955, 0.004040425643324852,] },

/* 26 */ { startIndex: 25, weights: [0.022114217281341553, 0.0033186059445142746,] },

/* 27 */ { startIndex: 26, weights: [0.02173672430217266, 0.0036109676584601402,] },

/* 28 */ { startIndex: 27, weights: [0.020497702062129974, 0.004762193653732538,] },

/* 29 */ { startIndex: 28, weights: [0.018486659973859787, 0.006592618301510811,] },

/* 30 */ { startIndex: 29, weights: [0.01585603691637516, 0.00896277092397213,] },

/* 31 */ { startIndex: 30, weights: [0.012738768011331558, 0.011751330457627773,] },

/* 32 */ { startIndex: 31, weights: [0.009250369854271412, 0.014853144995868206,] },

/* 33 */ { startIndex: 32, weights: [0.005490840878337622, 0.018177473917603493, 0.0028155462350696325,] },

/* 34 */ { startIndex: 33, weights: [0.0015463664894923568, 0.01632951945066452, 0.007420188747346401,] },

/* 35 */ { startIndex: 35, weights: [0.011181050911545753, 0.012018864043056965,] },

/* 36 */ { startIndex: 36, weights: [0.006065350491553545, 0.016561277210712433, 0.004360878840088844,] },

/* 37 */ { startIndex: 37, weights: [0.0010297985281795263, 0.012770536355674267, 0.009707189165055752,] },

/* 38 */ { startIndex: 39, weights: [0.006986402906477451, 0.01485429983586073, 0.004391219466924667,] },

/* 39 */ { startIndex: 40, weights: [0.001418047584593296, 0.011486922390758991, 0.010089744813740253, 0.00040022286702878773,] },

/* 40 */ { startIndex: 42, weights: [0.005411104764789343, 0.014735566452145576, 0.006518189795315266,] },

/* 41 */ { startIndex: 44, weights: [0.00827841367572546, 0.012277561239898205, 0.00396781275048852,] },

/* 42 */ { startIndex: 45, weights: [0.002187808509916067, 0.010184479877352715, 0.00998187530785799, 0.0022864851634949446,] },

/* 43 */ { startIndex: 47, weights: [0.00386943481862545, 0.011274894699454308, 0.008466221392154694, 0.0013397691072896123,] },

/* 44 */ { startIndex: 49, weights: [0.004820294212549925, 0.011678251437842846, 0.007608682848513126, 0.0010091039584949613,] },

/* 45 */ { startIndex: 51, weights: [0.005156961735337973, 0.011507894843816757, 0.007301822770386934, 0.0011901655234396458,] },

/* 46 */ { startIndex: 53, weights: [0.004982104524970055, 0.010863498784601688, 0.007451189681887627, 0.001791381393559277,] },

/* 47 */ { startIndex: 55, weights: [0.004385921638458967, 0.009832492098212242, 0.007973956875503063, 0.002732589840888977,] },

/* 48 */ { startIndex: 57, weights: [0.0034474546555429697, 0.008491347543895245, 0.008797688409686089, 0.00394382793456316,] },

/* 49 */ { startIndex: 59, weights: [0.0022357646375894547, 0.0069067515432834625, 0.009859241545200348, 0.005364237818866968, 0.0008692338014952838,] },

/* 50 */ { startIndex: 61, weights: [0.0008110002381727099, 0.005136650986969471, 0.00946230161935091, 0.0069410777650773525, 0.0027783995028585196,] },

/* 51 */ { startIndex: 64, weights: [0.003231203882023692, 0.007237049750983715, 0.00862883497029543, 0.004773912951350212, 0.0009189908159896731,] },

/* 52 */ { startIndex: 66, weights: [0.001233637798577547, 0.0049433219246566296, 0.008653006516397, 0.006818502210080624, 0.003248583758249879,] },

/* 53 */ { startIndex: 69, weights: [0.0026164355222135782, 0.006051854696124792, 0.008880467154085636, 0.005574479699134827, 0.002268492942675948,] },

/* 54 */ { startIndex: 71, weights: [0.0002863667905330658, 0.003467798000201583, 0.0066492292098701, 0.00787146482616663, 0.004809896927326918, 0.0017483289120718837,] },

/* 55 */ { startIndex: 74, weights: [0.0009245910914614797, 0.0038708120118826628, 0.00681703258305788, 0.007283343467861414, 0.004448124207556248, 0.0016129047144204378,] },

/* 56 */ { startIndex: 77, weights: [0.0011703289346769452, 0.003898728871718049, 0.006627128925174475, 0.0070473202504217625, 0.004421714693307877, 0.0017961094854399562,] },

/* 57 */ { startIndex: 80, weights: [0.0010892992140725255, 0.003615982597693801, 0.006142666097730398, 0.007102936040610075, 0.004671447444707155, 0.002239959081634879,] },

/* 58 */ { startIndex: 83, weights: [0.0007392280967906117, 0.0030791081953793764, 0.005418988410383463, 0.007397185545414686, 0.005145462695509195, 0.002893739379942417, 0.0006420162972062826,] },

/* 59 */ { startIndex: 86, weights: [0.00017068670422304422, 0.0023375742603093386, 0.004504461772739887, 0.0066713495180010796, 0.005798479542136192, 0.003713231300935149, 0.0016279831761494279,] },

/* 60 */ { startIndex: 90, weights: [0.0014345343224704266, 0.0034412189852446318, 0.005447904113680124, 0.006591092795133591, 0.004660011734813452, 0.002728930441662669, 0.0007978491485118866,] },

/* 61 */ { startIndex: 93, weights: [0.0004075043834745884, 0.002265830524265766, 0.004124156199395657, 0.005982482805848122, 0.005700822453945875, 0.003912510350346565, 0.0021241982467472553, 0.0003358862304594368,] },

/* 62 */ { startIndex: 97, weights: [0.0010099108330905437, 0.002730846870690584, 0.004451782442629337, 0.006172718480229378, 0.005150905344635248, 0.0034948070533573627, 0.0018387088784947991, 0.0001826105872169137,] },

/* 63 */ { startIndex: 101, weights: [0.0012943691108375788, 0.002888072282075882, 0.004481775686144829, 0.006075479090213776, 0.0048866597935557365, 0.003353001084178686, 0.0018193417927250266, 0.00028568264679051936,] },

/* 64 */ { startIndex: 105, weights: [0.0013131388695910573, 0.0027890161145478487, 0.004264893010258675, 0.0057407706044614315, 0.004859979264438152, 0.0034397069830447435, 0.0020194342359900475, 0.0005991620710119605,] },

/* 65 */ { startIndex: 109, weights: [0.0011121684219688177, 0.002478930866345763, 0.0038456933107227087, 0.0052124555222690105, 0.005028639920055866, 0.0037133716978132725, 0.002398103242740035, 0.0010828346712514758,] },

/* 66 */ { startIndex: 113, weights: [0.0007317548734135926, 0.0019974694587290287, 0.003263183869421482, 0.004528898745775223, 0.005355686880648136, 0.004137659445405006, 0.0029196315445005894, 0.0017016039928421378, 0.0004835762665607035,] },

/* 67 */ { startIndex: 117, weights: [0.00020713974663522094, 0.0013792773243039846, 0.0025514145381748676, 0.003723552217707038, 0.004895689897239208, 0.004680895246565342, 0.0035529187880456448, 0.0024249425623565912, 0.0012969663366675377, 0.00016899015463422984,] },

/* 68 */ { startIndex: 122, weights: [0.0006545265205204487, 0.0017400053329765797, 0.0028254841454327106, 0.003910962492227554, 0.004996441304683685, 0.0042709787376224995, 0.003226396394893527, 0.002181813819333911, 0.0011372314766049385, 9.264905384043232e-05,] },

/* 69 */ { startIndex: 127, weights: [0.000854626705404371, 0.001859853626228869, 0.002865080488845706, 0.003870307235047221, 0.00487553421407938, 0.00408313749358058, 0.003115783678367734, 0.0021484296303242445, 0.001181075582280755, 0.0002137213887181133,] },

/* 70 */ { startIndex: 132, weights: [0.0008483415003865957, 0.0017792496364563704, 0.0027101580053567886, 0.0036410661414265633, 0.004571974277496338, 0.004079728852957487, 0.003183893393725157, 0.002288057701662183, 0.0013922222424298525, 0.0004963868414051831,] },

/* 71 */ { startIndex: 137, weights: [0.0006716204807162285, 0.0015337044605985284, 0.002395788673311472, 0.0032578727696090937, 0.004119956865906715, 0.004227725323289633, 0.0033981208689510822, 0.0025685166474431753, 0.0017389123095199466, 0.0009093079133890569, 7.970355363795534e-05,] },

/* 72 */ { startIndex: 142, weights: [0.0003559796023182571, 0.0011543278815224767, 0.0019526762189343572, 0.002751024439930916, 0.0035493727773427963, 0.004347721114754677, 0.0037299629766494036, 0.002961693098768592, 0.00219342322088778, 0.0014251532265916467, 0.0006568834069184959,] },

/* 73 */ { startIndex: 148, weights: [0.0006682946113869548, 0.0014076193328946829, 0.0021469437051564455, 0.002886268775910139, 0.0036255933810025454, 0.004154576454311609, 0.0034431067761033773, 0.0027316368650645018, 0.0020201667211949825, 0.0013086966937407851, 0.0005972267827019095,] },

/* 74 */ { startIndex: 153, weights: [9.926508937496692e-05, 0.0007839298341423273, 0.001468594535253942, 0.0021532592363655567, 0.0028379240538924932, 0.0035225888714194298, 0.0039915177039802074, 0.0033326479606330395, 0.002673778682947159, 0.002014909405261278, 0.0013560398947447538, 0.0006971705006435513, 3.8301113818306476e-05,] },

/* 75 */ { startIndex: 159, weights: [0.00010181095422012731, 0.0007358568836934865, 0.0013699028640985489, 0.0020039486698806286, 0.002637994708493352, 0.0032720407471060753, 0.003906086552888155, 0.0033682563807815313, 0.0027580985333770514, 0.002147940918803215, 0.0015377833042293787, 0.0009276255150325596, 0.000317467754939571,] },

/* 76 */ { startIndex: 166, weights: [0.0005530364578589797, 0.0011402058880776167, 0.0017273754347115755, 0.0023145449813455343, 0.002901714527979493, 0.003488884074613452, 0.003523340215906501, 0.002958292607218027, 0.002393245231360197, 0.0018281979719176888, 0.001263150479644537, 0.0006981031037867069, 0.0001330557424807921,] },

/* 77 */ { startIndex: 172, weights: [0.0002608386566862464, 0.0008045974536798894, 0.0013483562506735325, 0.0018921148730441928, 0.0024358737282454967, 0.002979632467031479, 0.003523391205817461, 0.003251380519941449, 0.0027281083166599274, 0.002204835880547762, 0.001681563793681562, 0.001158291706815362, 0.0006350195035338402, 0.00011174729297636077,] },

/* 78 */ { startIndex: 179, weights: [0.0003849811910185963, 0.0008885387214832008, 0.001392096164636314, 0.0018956535495817661, 0.00239921105094254, 0.002902768552303314, 0.0034063260536640882, 0.003132763085886836, 0.0026481777895241976, 0.0021635922603309155, 0.0016790067311376333, 0.0011944210855290294, 0.0007098356145434082, 0.00022525011445395648,] },

/* 79 */ { startIndex: 186, weights: [0.000366741674952209, 0.0008330700220540166, 0.0012993983691558242, 0.0017657268326729536, 0.0022320549469441175, 0.002698383294045925, 0.0031647118739783764, 0.003141313325613737, 0.002692554146051407, 0.0022437951993197203, 0.00179503601975739, 0.0013462770730257034, 0.000897518009878695, 0.0004487590049393475,] },
]

export async function loadPackagesAndGetPaths(modelName: WhisperModelName | undefined, languageCode: string | undefined) {
	if (modelName) {
		modelName = normalizeWhisperModelName(modelName, languageCode)
	} else {
		if (languageCode) {
			const shortLanguageCode = getShortLanguageCode(languageCode)

			modelName = shortLanguageCode == 'en' ? 'tiny.en' : 'tiny'
		} else {
			modelName = 'tiny'
		}
	}

	if (modelName.startsWith('large')) {
		throw new Error(`Large models are not currently supported by the integrated Whisper engine due to model size restrictions of onnxruntime-node. To use large models, you can select the whisper.cpp engine instead.`)
	}

	const packageName = modelNameToPackageName[modelName]

	const modelDir = await loadPackage(packageName)

	return { modelName, modelDir }
}

export function normalizeWhisperModelName(modelName: WhisperModelName, languageCode: string | undefined): WhisperModelName {
	if (languageCode != 'en' && modelName.endsWith('.en')) {
		const originalModelName = modelName
		modelName = modelName.slice(0, modelName.length - 3) as WhisperModelName

		const logger = new Logger()
		logger.logTitledMessage(`Warning`, `The model '${originalModelName}' is English only and cannot be used to transcribe language '${languageCode}'. using '${modelName}' instead.`, chalk.yellowBright)
	}

	return modelName
}

export function isMultilingualModel(modelName: WhisperModelName) {
	return !isEnglishOnlyModel(modelName)
}

export function isEnglishOnlyModel(modelName: WhisperModelName) {
	return modelName.endsWith('.en')
}

export type WhisperTokenData = {
	id: number
	text: string
}

export type WhisperModelName = 'tiny' | 'tiny.en' | 'base' | 'base.en' | 'small' | 'small.en' | 'medium' | 'medium.en' | 'large' | 'large-v1' | 'large-v2' | 'large-v3'
export type WhisperTask = 'transcribe' | 'translate' | 'detect-language'

export const modelNameToPackageName: { [modelName in WhisperModelName]: string } = {
	'tiny': 'whisper-tiny',
	'tiny.en': 'whisper-tiny.en',
	'base': 'whisper-base',
	'base.en': 'whisper-base.en',
	'small': 'whisper-small',
	'small.en': 'whisper-small.en',
	'medium': 'whisper-medium',
	'medium.en': 'whisper-medium.en',
	'large': 'whisper-large-v3',
	'large-v1': 'whisper-large-v1',
	'large-v2': 'whisper-large-v2',
	'large-v3': 'whisper-large-v3'
}

export const tokenizerPackageName = 'whisper-tokenizer'

const languageIdLookup: { [s: string]: number } = {
	'en': 0,
	'zh': 1,
	'de': 2,
	'es': 3,
	'ru': 4,
	'ko': 5,
	'fr': 6,
	'ja': 7,
	'pt': 8,
	'tr': 9,
	'pl': 10,
	'ca': 11,
	'nl': 12,
	'ar': 13,
	'sv': 14,
	'it': 15,
	'id': 16,
	'hi': 17,
	'fi': 18,
	'vi': 19,
	'iw': 20,
	'uk': 21,
	'el': 22,
	'ms': 23,
	'cs': 24,
	'ro': 25,
	'da': 26,
	'hu': 27,
	'ta': 28,
	'no': 29,
	'th': 30,
	'ur': 31,
	'hr': 32,
	'bg': 33,
	'lt': 34,
	'la': 35,
	'mi': 36,
	'ml': 37,
	'cy': 38,
	'sk': 39,
	'te': 40,
	'fa': 41,
	'lv': 42,
	'bn': 43,
	'sr': 44,
	'az': 45,
	'sl': 46,
	'kn': 47,
	'et': 48,
	'mk': 49,
	'br': 50,
	'eu': 51,
	'is': 52,
	'hy': 53,
	'ne': 54,
	'mn': 55,
	'bs': 56,
	'kk': 57,
	'sq': 58,
	'sw': 59,
	'gl': 60,
	'mr': 61,
	'pa': 62,
	'si': 63,
	'km': 64,
	'sn': 65,
	'yo': 66,
	'so': 67,
	'af': 68,
	'oc': 69,
	'ka': 70,
	'be': 71,
	'tg': 72,
	'sd': 73,
	'gu': 74,
	'am': 75,
	'yi': 76,
	'lo': 77,
	'uz': 78,
	'fo': 79,
	'ht': 80,
	'ps': 81,
	'tk': 82,
	'nn': 83,
	'mt': 84,
	'sa': 85,
	'lb': 86,
	'my': 87,
	'bo': 88,
	'tl': 89,
	'mg': 90,
	'as': 91,
	'tt': 92,
	'haw': 93,
	'ln': 94,
	'ha': 95,
	'ba': 96,
	'jw': 97,
	'su': 98,
}

const alignmentHeadsIndexes: { [name in WhisperModelName]: number[] } = {
	'tiny.en': [6, 12, 17, 18, 19, 20, 21, 22],
	'tiny': [14, 18, 20, 21, 22, 23],
	'base.en': [27, 39, 41, 45, 47],
	'base': [25, 34, 35, 39, 41, 42, 44, 46],
	'small.en': [78, 84, 87, 92, 98, 101, 103, 108, 112, 116, 118, 120, 121, 122, 123, 126, 131, 134, 136],
	'small': [63, 69, 96, 100, 103, 104, 108, 115, 117, 125],
	'medium.en': [180, 225, 236, 238, 244, 256, 260, 265, 284, 286, 295, 298, 303, 320, 323, 329, 334, 348],
	'medium': [223, 244, 255, 257, 320, 372],
	'large-v1': [199, 222, 224, 237, 447, 451, 457, 462, 475],
	'large-v2': [212, 277, 331, 332, 333, 355, 356, 364, 371, 379, 391, 422, 423, 443, 449, 452, 465, 467, 473, 505, 521, 532, 555],
	'large-v3': [212, 277, 331, 332, 333, 355, 356, 364, 371, 379, 391, 422, 423, 443, 449, 452, 465, 467, 473, 505, 521, 532, 555], // Temporary (may not be correct)
	'large': [212, 277, 331, 332, 333, 355, 356, 364, 371, 379, 391, 422, 423, 443, 449, 452, 465, 467, 473, 505, 521, 532, 555],
}

export interface WhisperOptions {
	model?: WhisperModelName
	temperature?: number
	prompt?: string
	topCandidateCount?: number
	punctuationThreshold?: number
	autoPromptParts?: boolean
	maxTokensPerPart?: number
	suppressRepetition?: boolean
	decodeTimestampTokens?: boolean
	seed?: number
}

export const defaultWhisperOptions: WhisperOptions = {
	model: undefined,
	temperature: 0.1,
	prompt: undefined,
	topCandidateCount: 5,
	punctuationThreshold: 0.2,
	autoPromptParts: true,
	maxTokensPerPart: 250,
	suppressRepetition: true,
	decodeTimestampTokens: true,
	seed: undefined,
}
