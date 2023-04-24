import Onnx from 'onnxruntime-node'

import { Logger } from '../utilities/Logger.js'
import { computeMelSpectogramUsingFilterbanks, Filterbank } from "../dsp/MelSpectogram.js"
import { clip, delay,  roundToDigits, splitFloat32Array } from '../utilities/Utilities.js'
import { indexOfMax, logSoftmax, logSumExp, meanOfVector, medianFilter, softMax, stdDeviationOfVector } from '../math/VectorMath.js'
import { splitToWords, wordCharacterPattern } from '../nlp/Segmentation.js'

import { alignDTWWindowed } from '../alignment/DTWSequenceAlignmentWindowed.js'
import { deepClone } from '../utilities/ObjectUtilities.js'
import { Timeline } from '../utilities/Timeline.js'
import { AlignmentPath } from '../alignment/SpeechAlignment.js'
import { getRawAudioDuration, RawAudio } from '../audio/AudioUtilities.js'
import { readAndParseJsonFile, readFile } from '../utilities/FileSystem.js'
import path from 'path'
import type { LanguageDetectionResults } from '../api/API.js'
import { getShortLanguageCode, languageCodeToName } from '../utilities/Locale.js'
import { loadPackage } from '../utilities/PackageManager.js'

export async function recognize(sourceRawAudio: RawAudio, modelName: WhisperModelName, modelDir: string, tokenizerDir: string, task: WhisperTask, sourceLanguage: string) {
	if (sourceRawAudio.sampleRate != 16000) {
		throw new Error("Source audio must have a sampling rate of 16000")
	}

	const whisper = new Whisper(modelName, modelDir, tokenizerDir)
	await whisper.initialize()

	const result = await whisper.recognize(sourceRawAudio, task, sourceLanguage)

	return result
}

export async function align(sourceRawAudio: RawAudio, referenceText: string, modelName: WhisperModelName, modelDir: string, tokenizerDir: string, language: string) {
	if (sourceRawAudio.sampleRate != 16000) {
		throw new Error("Source audio must have a sampling rate of 16000")
	}

	const whisper = new Whisper(modelName, modelDir, tokenizerDir)
	await whisper.initialize()

	const timeline = await whisper.align(sourceRawAudio, referenceText, language)

	return timeline
}

export async function detectLanguage(sourceRawAudio: RawAudio, modelName: WhisperModelName, modelDir: string, tokenizerDir: string) {
	if (sourceRawAudio.sampleRate != 16000) {
		throw new Error("Source audio must have a sampling rate of 16000")
	}

	const whisper = new Whisper(modelName, modelDir, tokenizerDir)
	await whisper.initialize()

	const audioFeatures = await whisper.encodeAudio(sourceRawAudio)
	const results = await whisper.detectLanguage(audioFeatures)

	return results
}

export class Whisper {
	modelName: WhisperModelName
	modelDir: string
	tokenizerDir: string

	isMultiligualModel: boolean

	audioEncoder?: Onnx.InferenceSession
	textDecoder?: Onnx.InferenceSession

	textToTokenLookup = new Map<string, number>()
	tokenToTextLookup = new Map<number, string>()

	merges: [string, string][] = []

	onnxOptions: Onnx.InferenceSession.SessionOptions = {
		logSeverityLevel: 2,
		executionProviders: ['cpu']
	}

	tokenConfig: {
		suppressedTokens: number[]
		sotToken: number
		sotPrevToken: number
		eotToken: number
		noTimestampsToken: number
		noSpeechToken: number
		timestampTokensStart: number
	}

	constructor(modelName: WhisperModelName, modelDir: string, tokenizerDir: string) {
		this.modelDir = modelDir
		this.modelName = modelName
		this.tokenizerDir = tokenizerDir

		this.isMultiligualModel = isMultiligualModel(this.modelName)

		if (this.isMultiligualModel) {
			this.tokenConfig = {
				sotToken: 50258,
				sotPrevToken: 50361,
				eotToken: 50257,
				noSpeechToken: 50362,
				noTimestampsToken: 50363,
				timestampTokensStart: 50364,
				suppressedTokens: [1, 2, 6, 7, 8, 9, 10, 12, 14, 25, 26, 27, 28, 29, 31, 58, 59, 60, 61, 62, 63, 90, 91, 92, 93, 359, 503, 522, 542, 873, 893, 902, 918, 922, 931, 1350, 1853, 1982, 2460, 2627, 3246, 3253, 3268, 3536, 3846, 3961, 4183, 4667, 6585, 6647, 7273, 9061, 9383, 10428, 10929, 11938, 12033, 12331, 12562, 13793, 14157, 14635, 15265, 15618, 16553, 16604, 18362, 18956, 20075, 21675, 22520, 26130, 26161, 26435, 28279, 29464, 31650, 32302, 32470, 36865, 42863, 47425, 49870, 50254, 50258, 50360, 50361, 50362]
			}
		} else {
			this.tokenConfig = {
				sotToken: 50257,
				sotPrevToken: 50360,
				eotToken: 50256,
				noSpeechToken: 50361,
				noTimestampsToken: 50362,
				timestampTokensStart: 50363,
				suppressedTokens: [1, 2, 7, 8, 9, 10, 14, 25, 26, 27, 28, 29, 31, 58, 59, 60, 61, 62, 63, 90, 91, 92, 93, 357, 366, 438, 532, 685, 705, 796, 930, 1058, 1220, 1267, 1279, 1303, 1343, 1377, 1391, 1635, 1782, 1875, 2162, 2361, 2488, 3467, 4008, 4211, 4600, 4808, 5299, 5855, 6329, 7203, 9609, 9959, 10563, 10786, 11420, 11709, 11907, 13163, 13697, 13700, 14808, 15306, 16410, 16791, 17992, 19203, 19510, 20724, 22305, 22935, 27007, 30109, 30420, 33409, 34949, 40283, 40493, 40549, 47282, 49146, 50257, 50359, 50360, 50361]
			}
		}
	}

	async initialize() {
		const logger = new Logger()
		await logger.startAsync("Load tokenizer data")

		const encoderFilePath = path.join(this.modelDir, "encoder.onnx")
		const decoderFilePath = path.join(this.modelDir, "decoder.onnx")

		const vocabFilePath = path.join(this.tokenizerDir, "vocab.json")
		const mergesFilePath = path.join(this.tokenizerDir, "merges.txt")

		const vocabObject = await readAndParseJsonFile(vocabFilePath)

		function bpeEncodedStrToString(str: string) {
			const decodedChars = []

			for (const char of str) {
				const decodedChar = vocabCharacterSetLookup[char]

				if (decodedChar == undefined) {
					throw new Error(`Invalid char: '${char}'`)
				}

				decodedChars.push(decodedChar)
			}

			return Buffer.from(decodedChars).toString("utf-8")
		}

		for (const key in vocabObject) {
			const value = vocabObject[key]

			const decodedKey = bpeEncodedStrToString(key)

			this.textToTokenLookup.set(decodedKey, value)
			this.tokenToTextLookup.set(value, decodedKey)
		}

		const mergesFileRawLines = (await readFile(mergesFilePath, "utf8")).trim().split(/\r?\n/g)
		const mergesFileRawEntries = mergesFileRawLines.map(line => line.trim().split(" "))
		this.merges = mergesFileRawEntries.map(entry => [bpeEncodedStrToString(entry[0]), bpeEncodedStrToString(entry[1])])

		await logger.startAsync(`Create ONNX inference session for model '${this.modelName}'`)

		this.audioEncoder = await Onnx.InferenceSession.create(encoderFilePath, this.onnxOptions)
		this.textDecoder = await Onnx.InferenceSession.create(decoderFilePath, this.onnxOptions)

		logger.end()
	}

	async recognize(rawAudio: RawAudio, task: WhisperTask, language: string) {
		const logger = new Logger()

		const timestampTokensStart = this.tokenConfig.timestampTokensStart

		const audioSamples = rawAudio.audioChannels[0]
		const sampleRate = rawAudio.sampleRate
		const audioDuration = getRawAudioDuration(rawAudio)

		const maxAudioSamples = sampleRate * 30

		let previousPartTokens: number[] = []

		let timeline: Timeline = []

		for (let audioOffset = 0; audioOffset < audioSamples.length;) {
			const segmentStartTime = audioOffset / sampleRate

			await logger.startAsync(`\nPrepare audio part at time position ${roundToDigits(segmentStartTime, 2)}`)

			const audioPartSamples = audioSamples.slice(audioOffset, audioOffset + maxAudioSamples)
			const audioPartRawAudio: RawAudio = { audioChannels: [audioPartSamples], sampleRate }
			const audioPartDuration = getRawAudioDuration(audioPartRawAudio)

			logger.end()

			const audioPartFeatures = await this.encodeAudio(audioPartRawAudio)

			const isFinalPart = audioOffset + maxAudioSamples > audioSamples.length

			let initialTokens: number[] = []

			if (previousPartTokens.length > 0) {
				initialTokens = [this.tokenConfig.sotPrevToken, ...previousPartTokens]
			}

			initialTokens = [...initialTokens, ...this.getInitialTokens(language, task)]

			logger.end()

			let { decodedTokens: partTokens, crossAttentionQKs: partCrossAttentionQKs } = await this.decodeTokens(audioPartFeatures, initialTokens, audioPartDuration, isFinalPart)

			const partTranscript = this.tokensToText(partTokens.slice(initialTokens.length))

			logger.log(`Recognized part transcript: "${partTranscript}"`)

			const lastToken = partTokens[partTokens.length - 1]
			const lastTokenIsTimestamp = lastToken >= timestampTokensStart

			let audioEndOffset: number

			if (!isFinalPart && lastTokenIsTimestamp) {
				const timePosition = (lastToken - timestampTokensStart) * 0.02

				audioEndOffset = audioOffset + Math.floor(timePosition * sampleRate)
			} else {
				audioEndOffset = Math.min(audioOffset + maxAudioSamples, audioSamples.length)
			}

			const segmentEndTime = audioEndOffset / sampleRate
			const segmentFrameCount = Math.floor((segmentEndTime - segmentStartTime) / 0.02)

			await logger.startAsync(`Extract timeline for part`)

			if (partTokens.length != partCrossAttentionQKs.length) {
				throw new Error("Unexpected: partTokens.length != partCrossAttentionQKs.length")
			}

			//partTokens = partTokens.filter(token => token < timestampTokensStart)
			//partCrossAttentionQKs = await this.inferCrossAttentionQKs(partTokens, audioPartFeatures)

			partTokens = partTokens.slice(initialTokens.length)
			partCrossAttentionQKs = partCrossAttentionQKs.slice(initialTokens.length)

			//await this.addWordsToTimeline(timeline, partTokens, audioPartRawAudio, partCrossAttentionQKs, initialAudioTimeOffset, audioPartSamples.length / sampleRate)

			const alignmentPath = await this.findAlignmentPathFromQKs(partCrossAttentionQKs, partTokens, 0, segmentFrameCount) //, alignmentHeadsIndexes[this.modelName])
			const partTimeline = await this.getWordTimelineFromAlignmentPath(alignmentPath, partTokens, segmentStartTime, segmentEndTime)

			timeline.push(...partTimeline)

			audioOffset = audioEndOffset

			previousPartTokens = partTokens.filter(token => token < this.tokenConfig.eotToken)

			logger.end()
		}

		if (timeline.length > 0) {
			timeline[timeline.length - 1].endTime = audioDuration
		}

		timeline = this.mergeSuccessiveWordFragmentsInTimeline(timeline)
		timeline.forEach(entry => { entry.text = entry.text.trim() })
		timeline = timeline.filter(entry => wordCharacterPattern.test(entry.text))

		const transcript = timeline.map(entry => entry.text).join(" ")

		logger.end()

		return { transcript, timeline }
	}

	async align(rawAudio: RawAudio, referenceText: string, language: string) {
		const logger = new Logger()

		await logger.startAsync("Prepare for alignment")
		const audioDuration = Math.min(getRawAudioDuration(rawAudio), 30)
		const audioFrameCount = Math.floor(audioDuration / 0.02)

		const initialTokens = this.getInitialTokens(language, "transcribe", true)
		const timestampTokensStart = this.tokenConfig.timestampTokensStart
		const eotToken = this.tokenConfig.eotToken

		let tokens = [...initialTokens, ...await this.textToTokens(referenceText, language), eotToken]

		logger.end()
		const audioFeatures = await this.encodeAudio(rawAudio)

		await logger.startAsync("Infer cross-attention QKs")
		let crossAttentionQKs = await this.inferCrossAttentionQKs(tokens, audioFeatures)

		tokens = tokens.slice(initialTokens.length, tokens.length - 1)
		crossAttentionQKs = crossAttentionQKs.slice(initialTokens.length, crossAttentionQKs.length - 1)

		await logger.startAsync("Extract word timeline")
		const alignmentPath = await this.findAlignmentPathFromQKs(crossAttentionQKs, tokens, 0, audioFrameCount)//, this.getAlignmentHeadIndexes())
		let timeline = await this.getWordTimelineFromAlignmentPath(alignmentPath, tokens, 0, audioDuration)

		timeline = this.mergeSuccessiveWordFragmentsInTimeline(timeline)
		timeline.forEach(entry => { entry.text = entry.text.trim() })
		timeline = timeline.filter(entry => wordCharacterPattern.test(entry.text))

		logger.end()

		return timeline
	}

	async detectLanguage(audioFeatures: Onnx.Tensor): Promise<LanguageDetectionResults> {
		const logger = new Logger()

		if (!this.isMultiligualModel) {
			throw new Error("Language detection only works for a multilingual model")
		}

		// Prepare and run decoder
		logger.startAsync("Detect language with Whisper model")

		const sotToken = this.tokenConfig.sotToken

		const initialTokens = [sotToken]
		const offset = 0

		const initialKvDimensions = this.getKvDimensions(1, initialTokens.length)
		const kvCacheTensor = new Onnx.Tensor('float32', new Float32Array(initialKvDimensions[0] * initialKvDimensions[1] * initialKvDimensions[2] * initialKvDimensions[3]), initialKvDimensions)

		const tokensTensor = new Onnx.Tensor('int64', new BigInt64Array(initialTokens.map(token => BigInt(token))), [1, initialTokens.length])
		const offsetTensor = new Onnx.Tensor('int64', new BigInt64Array([BigInt(offset)]), [])

		const decoderInputs = { tokens: tokensTensor, audio_features: audioFeatures, kv_cache: kvCacheTensor, offset: offsetTensor }

		const decoderOutputs = await this.textDecoder!.run(decoderInputs)
		const logitsBuffer = decoderOutputs["logits"].data as Float32Array

		const languageTokensLogits = Array.from(logitsBuffer.slice(sotToken + 1, sotToken + 1 + 99))
		const languageTokensProbabilities = softMax(languageTokensLogits, 1.0)

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

		results.sort((entry1, entry2) => entry2.probability - entry1.probability)

		logger.end()

		return results
	}

	async decodeTokens(audioFeatures: Onnx.Tensor, initialTokens: number[], audioDuration: number, isFinalPart: boolean) {
		const logger = new Logger()
		await logger.startAsync("Decode text tokens with Whisper decoder model")

		const noSpeechThreshold = 0.6

		const blankToken = this.textToTokenLookup.get(" ")

		const suppressedTokens = this.tokenConfig.suppressedTokens
		const sotToken = this.tokenConfig.sotToken
		const eotToken = this.tokenConfig.eotToken
		const noTimestampsToken = this.tokenConfig.noTimestampsToken
		const noSpeechToken = this.tokenConfig.noSpeechToken
		const timestampTokensStart = this.tokenConfig.timestampTokensStart

		const maxDecodedTokenCount = 200

		let decodedTokens = initialTokens.slice()
		const initialKvDimensions = this.getKvDimensions(1, decodedTokens.length)
		let kvCacheTensor = new Onnx.Tensor('float32', new Float32Array(initialKvDimensions[0] * initialKvDimensions[1] * initialKvDimensions[2] * initialKvDimensions[3]), initialKvDimensions)

		let decodedTokensTimestampLogits: number[][] = [new Array(1501)]

		let lastTimestampTokenIndex = -1

		let timestampsSeenCount = 0

		let decodedTokensCrossAttentionQKs: Onnx.Tensor[] = []

		for (let i = 0; i < decodedTokens.length; i++) {
			decodedTokensCrossAttentionQKs.push(undefined as any)
		}

		// Start decoding loop
		for (let decodedTokenCount = 0; decodedTokenCount < maxDecodedTokenCount; decodedTokenCount++) {
			//logger.log(decodedTokenCount)

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

			const logitsBuffer = decoderOutputs["logits"].data as Float32Array
			kvCacheTensor = decoderOutputs["output_kv_cache"] as any

			// Compute logits
			const resultLogits = splitFloat32Array(logitsBuffer, logitsBuffer.length / decoderOutputs["logits"].dims[1])
			const tokenLogits = resultLogits[resultLogits.length - 1]
			const tokenTimestampLogits = Array.from(tokenLogits.slice(timestampTokensStart))

			// Suppress tokens
			for (let logitIndex = 0; logitIndex < tokenLogits.length; logitIndex++) {
				const isWrongTokenForInitialState = isInitialState && (logitIndex == blankToken || logitIndex == eotToken)
				const isInSupressedList = suppressedTokens.includes(logitIndex)
				const isNoTimestampsToken = logitIndex == noTimestampsToken

				const shouldSupressToken = isWrongTokenForInitialState || isInSupressedList || isNoTimestampsToken

				if (shouldSupressToken) {
					tokenLogits[logitIndex] = -Infinity
				}
			}

			// Compute best token
			const logProbs = logSoftmax(tokenLogits as any)

			const textTokenLogProbs = logProbs.slice(0, timestampTokensStart)
			const timestampTokenLogProbs = logProbs.slice(timestampTokensStart)

			const indexOfMaxTextLogProb = indexOfMax(textTokenLogProbs)
			const valueOfMaxTextLogProb = textTokenLogProbs[indexOfMaxTextLogProb]

			const indexOfMaxTimestampLogProb = indexOfMax(timestampTokenLogProbs)

			const logSumExpOfTimestampTokenLogProbs = logSumExp(timestampTokenLogProbs)

			const isTimestampToken = logSumExpOfTimestampTokenLogProbs > valueOfMaxTextLogProb
			const previousTokenWasTimestamp = decodedTokens[decodedTokens.length - 1] >= timestampTokensStart
			const secondPreviousTokenWasTimestamp = decodedTokens.length < 2 || decodedTokens[decodedTokens.length - 2] >= timestampTokensStart

			if (isTimestampToken && !previousTokenWasTimestamp) {
				timestampsSeenCount += 1
			}

			// Add best token
			function addToken(tokenToAdd: number, timestampLogits: number[]) {
				decodedTokens.push(tokenToAdd)
				decodedTokensTimestampLogits.push(timestampLogits)
				decodedTokensCrossAttentionQKs.push(decoderOutputs["cross_attention_qks"])
			}

			if (isTimestampToken || (previousTokenWasTimestamp && !secondPreviousTokenWasTimestamp)) {
				if (previousTokenWasTimestamp) {
					const previousToken = decodedTokens[decodedTokens.length - 1]
					const previousTokenTimestampLogits = decodedTokensTimestampLogits[decodedTokensTimestampLogits.length - 1]

					addToken(previousToken, previousTokenTimestampLogits)

					lastTimestampTokenIndex = decodedTokens.length

					const previousTokenTimestamp = (previousToken - timestampTokensStart) * 0.02

					if (previousTokenTimestamp >= audioDuration) {
						break
					}
				} else {
					addToken(timestampTokensStart + indexOfMaxTimestampLogProb, tokenTimestampLogits)
				}
			} else if (indexOfMaxTextLogProb == eotToken) {
				break
			} else {
				addToken(indexOfMaxTextLogProb, tokenTimestampLogits)
			}

			await delay(0)
		}

		if (timestampsSeenCount >= 2 && !isFinalPart) {
			decodedTokens = decodedTokens.slice(0, lastTimestampTokenIndex)
			decodedTokensTimestampLogits = decodedTokensTimestampLogits.slice(0, lastTimestampTokenIndex)
			decodedTokensCrossAttentionQKs = decodedTokensCrossAttentionQKs.slice(0, lastTimestampTokenIndex)
		}

		logger.end()

		// Return the tokens
		return { decodedTokens, decodedTokensTimestampLogits, crossAttentionQKs: decodedTokensCrossAttentionQKs }
	}

	async inferCrossAttentionQKs(tokens: number[], audioFeatures: Onnx.Tensor) {
		const offset = 0

		const tokensTensor = new Onnx.Tensor('int64', new BigInt64Array(tokens.map(token => BigInt(token))), [1, tokens.length])
		const offsetTensor = new Onnx.Tensor('int64', new BigInt64Array([BigInt(offset)]), [])

		const initialKvDimensions = this.getKvDimensions(1, tokens.length)
		const kvCacheTensor = new Onnx.Tensor('float32', new Float32Array(initialKvDimensions[0] * initialKvDimensions[1] * initialKvDimensions[2] * initialKvDimensions[3]), initialKvDimensions)

		const decoderInputs = { tokens: tokensTensor, audio_features: audioFeatures, kv_cache: kvCacheTensor, offset: offsetTensor }

		const decoderOutputs = await this.textDecoder!.run(decoderInputs)

		const crossAttentionQKsTensor = decoderOutputs["cross_attention_qks"]

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
		const logger = new Logger()

		const audioSamples = rawAudio.audioChannels[0]
		const sampleRate = rawAudio.sampleRate

		const fftOrder = 400
		const hopLength = 160
		const filterbankCount = 80

		const maxAudioSamples = sampleRate * 30
		const maxAudioFrames = 3000

		await logger.startAsync("Extract mel spectogram from audio part")

		const paddedAudioSamples = new Float32Array(maxAudioSamples)
		paddedAudioSamples.set(audioSamples.subarray(0, maxAudioSamples), 0)

		const rawAudioPart: RawAudio = { audioChannels: [paddedAudioSamples], sampleRate }

		const { melSpectogram } = await computeMelSpectogramUsingFilterbanks(rawAudioPart, fftOrder, fftOrder, hopLength, filterbanks)

		await logger.startAsync("Normalize mel spectogram")

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

		await logger.startAsync("Encode mel spectogram with Whisper encoder model")

		const inputTensor = new Onnx.Tensor('float32', flattenedNormalizedLogMelSpectogram, [1, filterbankCount, maxAudioFrames])

		const encoderInputs = { mel: inputTensor }

		const encoderOutputs = await this.audioEncoder!.run(encoderInputs)
		const encodedAudioFeatures = encoderOutputs["output"]

		logger.end()

		return encodedAudioFeatures
	}

	addSegmentsToTimeline(timeline: Timeline, tokens: number[], initialTimeOffset: number, audioDuration: number) {
		const timestampTokensStart = this.tokenConfig.timestampTokensStart

		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i]

			if (token == this.tokenConfig.sotToken || token == this.tokenConfig.eotToken) {
				continue
			}

			const tokenIsTimestamp = token >= timestampTokensStart
			const previousTokenWasTimestamp = tokens.length > 1 && tokens[i - 1] >= timestampTokensStart

			if (tokenIsTimestamp) {
				if (previousTokenWasTimestamp) {
					continue
				}

				let startTime = initialTimeOffset + (token - timestampTokensStart) * 0.02

				startTime = Math.min(startTime, audioDuration)

				if (timeline.length > 0) {
					timeline[timeline.length - 1].endTime = startTime
				}

				timeline.push({
					type: "segment",
					text: "",
					startTime,
					endTime: -1,
				})
			} else {
				if (timeline.length == 0) {
					timeline.push({
						type: "segment",
						text: "",
						startTime: initialTimeOffset,
						endTime: -1,
					})
				}

				const tokenText = this.tokenToTextLookup.get(token) || ""

				timeline[timeline.length - 1].text += tokenText
			}
		}
	}

	async addWordsToTimeline(timeline: Timeline, tokens: number[], rawAudio: RawAudio, crossAttentionQKs: Onnx.Tensor[], initialAudioTimeOffset: number, duration: number) {
		const timestampTokensStart = this.tokenConfig.timestampTokensStart

		let segmentStartTime = 0
		let segmentTokens: number[] = []
		let segmentCrossAttentionQKs: Onnx.Tensor[] = []

		for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
			const token = tokens[tokenIndex]
			const tokenCrossAttentionQKs = crossAttentionQKs[tokenIndex]

			const segmentTokensWithoutTimestamps = segmentTokens.filter(token => token < this.tokenConfig.timestampTokensStart)

			const isTimestamp = token >= timestampTokensStart

			if (isTimestamp || tokenIndex == tokens.length - 1) {
				let tokenTime: number

				if (isTimestamp) {
					tokenTime = (token - timestampTokensStart) * 0.02
				} else {
					tokenTime = duration
				}

				if (segmentTokensWithoutTimestamps.length > 0) {
					const segmentEndTime = tokenTime

					const segmentStartFrame = Math.floor(segmentStartTime / 0.02)
					let segmentEndFrame = Math.floor(segmentEndTime / 0.02)

					if (segmentStartFrame == segmentEndFrame) {
						segmentEndFrame += 1
					}

					const segmentFrameCount = segmentEndFrame - segmentStartFrame

					const reinferCrossAttentionQKs = true

					if (reinferCrossAttentionQKs) {
						const initialTokens = this.getInitialTokens('en', 'transcribe')
						const tokensToDecode = [...initialTokens, ...segmentTokensWithoutTimestamps]

						//const segmentAudioFeaturesBuffer = audioFeatures.data.slice(segmentStartFrame * audioFeatures.dims[2], segmentEndFrame * audioFeatures.dims[2])
						//const segmentAudioFeatures = new Onnx.Tensor('float32', segmentAudioFeaturesBuffer, [1, segmentFrameCount, audioFeatures.dims[2]])

						const segmentAudioSamples = rawAudio.audioChannels[0].slice(Math.floor(segmentStartTime * rawAudio.sampleRate), Math.floor(segmentEndTime * rawAudio.sampleRate))
						const segmentRawAudio: RawAudio = { audioChannels: [segmentAudioSamples], sampleRate: rawAudio.sampleRate }

						const segmentAudioFeatures = await this.encodeAudio(segmentRawAudio)

						const reinferredCrossAttentionQKs = await this.inferCrossAttentionQKs(tokensToDecode, segmentAudioFeatures)
						reinferredCrossAttentionQKs.slice(initialTokens.length)

						const alignmentPath = await this.findAlignmentPathFromQKs(reinferredCrossAttentionQKs, tokensToDecode, 0, segmentFrameCount)//, alignmentHeadsIndexes[modelName])
						const wordTimeline = await this.getWordTimelineFromAlignmentPath(alignmentPath, segmentTokensWithoutTimestamps, initialAudioTimeOffset + segmentStartTime, initialAudioTimeOffset + segmentEndTime, 0.0)

						timeline.push(...wordTimeline)
					} else {
						const alignmentPath = await this.findAlignmentPathFromQKs(segmentCrossAttentionQKs, segmentTokens, segmentStartFrame, segmentEndFrame)//, alignmentHeadsIndexes[modelName])
						const wordTimeline = await this.getWordTimelineFromAlignmentPath(alignmentPath, segmentTokens, initialAudioTimeOffset, initialAudioTimeOffset + segmentEndTime, 0.0)

						timeline.push(...wordTimeline)
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

	mergeSuccessiveWordFragmentsInTimeline(timeline: Timeline) {
		const resultTimeline: Timeline = []

		for (const entry of timeline) {
			if (entry.type != "word") {
				continue
			}

			if (resultTimeline.length > 0 && !entry.text.startsWith(" ")) {
				const lastEntry = resultTimeline[resultTimeline.length - 1]

				lastEntry.text += entry.text
				lastEntry.endTime = entry.endTime
			} else {
				resultTimeline.push(deepClone(entry))
			}
		}

		return resultTimeline
	}

	async getWordTimelineFromAlignmentPath(alignmentPath: AlignmentPath, tokens: number[], startTimeOffset: number, endTimeOffset: number, correctionAmount = 0.0) {
		const wordTimeline: Timeline = []

		for (let pathIndex = 0; pathIndex < alignmentPath.length; pathIndex++) {
			if (pathIndex != 0 && alignmentPath[pathIndex].source == alignmentPath[pathIndex - 1].source) {
				continue
			}

			const tokenMappingEntry = alignmentPath[pathIndex]

			const token = tokens[tokenMappingEntry.source]
			const tokenText = this.tokenToTextLookup.get(token)

			if (token >= this.tokenConfig.eotToken || !tokenText) {
				continue
			}

			let startTime = startTimeOffset + (tokenMappingEntry.dest * 0.02)

			startTime = Math.max(startTime + correctionAmount, startTimeOffset)

			if (wordTimeline.length > 0) {
				wordTimeline[wordTimeline.length - 1].endTime = startTime
			}

			wordTimeline.push({
				type: "word",
				text: tokenText,
				startTime,
				endTime: -1
			})
		}

		if (wordTimeline.length > 0) {
			wordTimeline[wordTimeline.length - 1].endTime = endTimeOffset
		}

		return wordTimeline
	}

	async findAlignmentPathFromQKs(qksTensors: Onnx.Tensor[], tokens: number[], segmentStartFrame: number, segmentEndFrame: number, headIndexes?: number[]) {
		const segmentFrameCount = segmentEndFrame - segmentStartFrame

		if (segmentFrameCount == 0) {
			throw new Error("Segment has 0 frames")
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
		const attentionHeads: number[][][] = [] // [heads, tokens, frames]

		for (const headIndex of headIndexes) {
			const attentionHead: number[][] = [] // [tokens, frames]

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
					head[tokenIndex] = softMax(head[tokenIndex], softmaxTemperature)
				}
			}
		}

		if (normalize) {
			// Normalize all weights in each individual head
			for (const head of attentionHeads) {
				const allWeightsForHead = head.flatMap(tokenFrames => tokenFrames)

				const meanOfAllWeights = meanOfVector(allWeightsForHead)
				const stdDeviationOfAllWeights = stdDeviationOfVector(allWeightsForHead)

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
			const timestampTokensStart = this.tokenConfig.timestampTokensStart

			for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
				if (tokens[tokenIndex] >= timestampTokensStart) {
					let timestampFrame = tokens[tokenIndex] - timestampTokensStart
					timestampFrame = clip(timestampFrame, segmentStartFrame, segmentEndFrame - 1)

					frameMeansForToken[tokenIndex][timestampFrame] = 100
				}
			}
		}

		// Perform DTW
		const tokenIndexes = [...Array(tokenCount).keys()]
		const frameIndexes = [...Array(segmentFrameCount).keys()]

		let { path } = await alignDTWWindowed(tokenIndexes, frameIndexes, (tokenIndex, frameIndex) => {
			return -frameMeansForToken[tokenIndex][frameIndex]
		}, 1000)

		path = path.map(entry => ({ source: entry.source, dest: segmentStartFrame + entry.dest }))

		return path
	}

	getKvDimensions(groupCount: number, length: number) {
		const modelName = this.modelName

		if (modelName == "tiny" || modelName == "tiny.en") {
			return [8, groupCount, length, 384]
		} else if (modelName == "base" || modelName == "base.en") {
			return [12, groupCount, length, 512]
		} else if (modelName == "small" || modelName == "small.en") {
			return [24, groupCount, length, 768]
		} else if (modelName == "medium" || modelName == "medium.en") {
			return [48, groupCount, length, 1024]
		} else if (modelName == "large" || modelName == "large-v1" || modelName == "large-v2") {
			return [64, groupCount, length, 1280]
		} else {
			throw new Error(`Unsupported model: ${modelName}`)
		}
	}

	getInitialTokens(language: string, task: WhisperTask, disableTimestamps = false) {
		const sotToken = this.tokenConfig.sotToken

		let initialTokens: number[]

		if (this.isMultiligualModel) {
			const languageToken = sotToken + 1 + languageIdLookup[language]
			const translateTaskToken = 50358
			const transcribeTaskToken = 50359
			const taskToken = task == "transcribe" ? transcribeTaskToken : translateTaskToken

			initialTokens = [sotToken, languageToken, taskToken]
		} else {
			initialTokens = [sotToken]
		}

		if (disableTimestamps) {
			initialTokens.push(this.tokenConfig.noTimestampsToken)
		}

		return initialTokens
	}

	getAlignmentHeadIndexes() {
		return alignmentHeadsIndexes[this.modelName]
	}

	tokensToText(tokens: number[]) {
		return tokens.map(token => this.tokenToTextLookup.get(token) || "").join("").trim()
	}

	async textToTokens(text: string, language: string) {
		const resultTokens: number[] = []

		const words = (await splitToWords(text, language)).filter(w => w.trim().length > 0)

		//words = words.filter(word => wordCharacterPattern.test(word))

		for (let i = 1; i < words.length; i++) {
			words[i] = ` ${words[i]}`
		}

		const allResultingSubwords: string[][] = []

		for (const word of words) {
			const tokenForEntireWord = this.textToTokenLookup.get(word)

			if (tokenForEntireWord) {
				resultTokens.push(tokenForEntireWord)
				allResultingSubwords.push([word])
				continue
			}

			const subwords = word.split("")

			for (const mergeRule of this.merges) {
				for (let i = 0; i < subwords.length - 1; i++) {
					const currentSubword = subwords[i]
					const nextSubword = subwords[i + 1]

					if (currentSubword == mergeRule[0] && nextSubword == mergeRule[1]) {
						subwords.splice(i, 2, mergeRule[0] + mergeRule[1])
					}
				}
			}

			for (const subword of subwords) {
				const tokenForSubword = this.textToTokenLookup.get(subword)

				if (!tokenForSubword) {
					throw new Error(`Failed tokenizing the given text. The word '${word}' contains a subword '${subword}' which is not in the vocabulary.`)
				}

				resultTokens.push(tokenForSubword)
			}

			allResultingSubwords.push(subwords)
		}

		return resultTokens
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
	if (!modelName) {
		if (languageCode) {
			const shortLanguageCode = getShortLanguageCode(languageCode)

			modelName = shortLanguageCode == "en" ? "tiny.en" : "tiny"
		} else {
			modelName = "tiny"
		}
	}

	const packageName = modelNameToPackageName[modelName]

	const modelDir = await loadPackage(packageName)

	const tokenizerPackagePath = await loadPackage(tokenizerPackageName)
	const tokenizerDir = isMultiligualModel(modelName) ? path.join(tokenizerPackagePath, "multilingual") : path.join(tokenizerPackagePath, "gpt2")

	return { modelName, modelDir, tokenizerDir }
}

export function isMultiligualModel(modelName: WhisperModelName) {
	return !modelName.endsWith(".en")
}

export type WhisperModelName = "tiny" | "tiny.en" | "base" | "base.en" | "small" | "small.en" | "medium" | "medium.en" | "large" | "large-v1" | "large-v2"
export type WhisperTask = "transcribe" | "translate"

export const modelNameToPackageName: { [modelName in WhisperModelName]: string } = {
	"tiny": "whisper-tiny",
	"tiny.en": "whisper-tiny.en",
	"base": "whisper-base",
	"base.en": "whisper-base.en",
	"small": "whisper-small",
	"small.en": "whisper-small.en",
	"medium": "whisper-medium",
	"medium.en": "whisper-medium.en",
	"large": "whisper-large-v2",
	"large-v1": "whisper-large-v1",
	"large-v2": "whisper-large-v2"
}

export const tokenizerPackageName = "whisper-tokenizer"

const vocabCharacterSetLookup: { [s: string]: number } = {
	"!": 33, "\"": 34, "#": 35, "$": 36, "%": 37, "&": 38, "'": 39, "(": 40, ")": 41, "*": 42, "+": 43, ",": 44, "-": 45, ".": 46, "/": 47, "0": 48, "1": 49, "2": 50, "3": 51, "4": 52, "5": 53, "6": 54,
	"7": 55, "8": 56, "9": 57, ":": 58, ";": 59, "<": 60, "=": 61, ">": 62, "?": 63, "@": 64, "A": 65, "B": 66, "C": 67, "D": 68, "E": 69, "F": 70, "G": 71, "H": 72, "I": 73, "J": 74, "K": 75, "L": 76, "M": 77, "N": 78, "O": 79, "P": 80, "Q": 81, "R": 82, "S": 83, "T": 84, "U": 85, "V": 86, "W": 87, "X": 88, "Y": 89, "Z": 90, "[": 91, "\\": 92, "]": 93, "^": 94, "_": 95, "`": 96, "a": 97, "b": 98, "c": 99, "d": 100, "e": 101, "f": 102, "g": 103, "h": 104, "i": 105, "j": 106, "k": 107, "l": 108, "m": 109, "n": 110, "o": 111, "p": 112, "q": 113, "r": 114, "s": 115, "t": 116, "u": 117, "v": 118, "w": 119, "x": 120, "y": 121, "z": 122, "{": 123, "|": 124, "}": 125, "~": 126, "¡": 161, "¢": 162, "£": 163, "¤": 164, "¥": 165, "¦": 166, "§": 167, "¨": 168, "©": 169, "ª": 170, "«": 171, "¬": 172, "®": 174, "¯": 175, "°": 176, "±": 177, "²": 178, "³": 179, "´": 180, "µ": 181, "¶": 182, "·": 183, "¸": 184, "¹": 185, "º": 186, "»": 187, "¼": 188, "½": 189, "¾": 190, "¿": 191, "À": 192, "Á": 193, "Â": 194, "Ã": 195, "Ä": 196, "Å": 197, "Æ": 198, "Ç": 199, "È": 200, "É": 201, "Ê": 202, "Ë": 203, "Ì": 204, "Í": 205, "Î": 206, "Ï": 207, "Ð": 208, "Ñ": 209, "Ò": 210, "Ó": 211, "Ô": 212, "Õ": 213, "Ö": 214, "×": 215, "Ø": 216, "Ù": 217, "Ú": 218, "Û": 219, "Ü": 220, "Ý": 221, "Þ": 222, "ß": 223, "à": 224, "á": 225, "â": 226, "ã": 227, "ä": 228, "å": 229, "æ": 230, "ç": 231, "è": 232, "é": 233, "ê": 234, "ë": 235, "ì": 236, "í": 237, "î": 238, "ï": 239, "ð": 240, "ñ": 241, "ò": 242, "ó": 243, "ô": 244, "õ": 245, "ö": 246, "÷": 247, "ø": 248, "ù": 249, "ú": 250, "û": 251, "ü": 252, "ý": 253, "þ": 254, "ÿ": 255, "Ā": 0, "ā": 1, "Ă": 2, "ă": 3, "Ą": 4, "ą": 5, "Ć": 6, "ć": 7, "Ĉ": 8, "ĉ": 9, "Ċ": 10, "ċ": 11, "Č": 12, "č": 13, "Ď": 14, "ď": 15, "Đ": 16, "đ": 17, "Ē": 18, "ē": 19, "Ĕ": 20, "ĕ":
		21, "Ė": 22, "ė": 23, "Ę": 24, "ę": 25, "Ě": 26, "ě": 27, "Ĝ": 28, "ĝ": 29, "Ğ": 30, "ğ": 31, "Ġ": 32, "ġ": 127, "Ģ": 128, "ģ": 129, "Ĥ": 130, "ĥ": 131, "Ħ": 132, "ħ": 133, "Ĩ": 134, "ĩ": 135, "Ī": 136, "ī": 137, "Ĭ": 138, "ĭ": 139, "Į": 140, "į": 141, "İ": 142, "ı": 143, "Ĳ": 144, "ĳ": 145, "Ĵ": 146, "ĵ": 147, "Ķ": 148, "ķ": 149, "ĸ": 150, "Ĺ": 151, "ĺ": 152, "Ļ": 153, "ļ": 154, "Ľ": 155, "ľ": 156, "Ŀ": 157, "ŀ": 158, "Ł": 159, "ł": 160, "Ń": 173
}

const languageIdLookup: { [s: string]: number } = {
	"en": 0,
	"zh": 1,
	"de": 2,
	"es": 3,
	"ru": 4,
	"ko": 5,
	"fr": 6,
	"ja": 7,
	"pt": 8,
	"tr": 9,
	"pl": 10,
	"ca": 11,
	"nl": 12,
	"ar": 13,
	"sv": 14,
	"it": 15,
	"id": 16,
	"hi": 17,
	"fi": 18,
	"vi": 19,
	"iw": 20,
	"uk": 21,
	"el": 22,
	"ms": 23,
	"cs": 24,
	"ro": 25,
	"da": 26,
	"hu": 27,
	"ta": 28,
	"no": 29,
	"th": 30,
	"ur": 31,
	"hr": 32,
	"bg": 33,
	"lt": 34,
	"la": 35,
	"mi": 36,
	"ml": 37,
	"cy": 38,
	"sk": 39,
	"te": 40,
	"fa": 41,
	"lv": 42,
	"bn": 43,
	"sr": 44,
	"az": 45,
	"sl": 46,
	"kn": 47,
	"et": 48,
	"mk": 49,
	"br": 50,
	"eu": 51,
	"is": 52,
	"hy": 53,
	"ne": 54,
	"mn": 55,
	"bs": 56,
	"kk": 57,
	"sq": 58,
	"sw": 59,
	"gl": 60,
	"mr": 61,
	"pa": 62,
	"si": 63,
	"km": 64,
	"sn": 65,
	"yo": 66,
	"so": 67,
	"af": 68,
	"oc": 69,
	"ka": 70,
	"be": 71,
	"tg": 72,
	"sd": 73,
	"gu": 74,
	"am": 75,
	"yi": 76,
	"lo": 77,
	"uz": 78,
	"fo": 79,
	"ht": 80,
	"ps": 81,
	"tk": 82,
	"nn": 83,
	"mt": 84,
	"sa": 85,
	"lb": 86,
	"my": 87,
	"bo": 88,
	"tl": 89,
	"mg": 90,
	"as": 91,
	"tt": 92,
	"haw": 93,
	"ln": 94,
	"ha": 95,
	"ba": 96,
	"jw": 97,
	"su": 98,
}

const alignmentHeadsIndexes: { [name in WhisperModelName]: number[] } = {
	"tiny.en": [6, 12, 17, 18, 19, 20, 21, 22],
	"tiny": [14, 18, 20, 21, 22, 23],
	"base.en": [27, 39, 41, 45, 47],
	"base": [25, 34, 35, 39, 41, 42, 44, 46],
	"small.en": [78, 84, 87, 92, 98, 101, 103, 108, 112, 116, 118, 120, 121, 122, 123, 126, 131, 134, 136],
	"small": [63, 69, 96, 100, 103, 104, 108, 115, 117, 125],
	"medium.en": [180, 225, 236, 238, 244, 256, 260, 265, 284, 286, 295, 298, 303, 320, 323, 329, 334, 348],
	"medium": [223, 244, 255, 257, 320, 372],
	"large-v1": [199, 222, 224, 237, 447, 451, 457, 462, 475],
	"large-v2": [212, 277, 331, 332, 333, 355, 356, 364, 371, 379, 391, 422, 423, 443, 449, 452, 465, 467, 473, 505, 521, 532, 555],
	"large": [212, 277, 331, 332, 333, 355, 356, 364, 371, 379, 391, 422, 423, 443, 449, 452, 465, 467, 473, 505, 521, 532, 555],
}
