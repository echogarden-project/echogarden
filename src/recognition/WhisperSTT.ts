import type * as Onnx from 'onnxruntime-node'

import { Logger } from '../utilities/Logger.js'
import { computeMelSpectogramUsingFilterbanks, Filterbank } from '../dsp/MelSpectogram.js'
import { clip, concatFloat32Arrays, getIntegerRange, splitFloat32Array, yieldToEventLoop } from '../utilities/Utilities.js'
import { indexOfMax, logOfVector, logSumExp, meanOfVector, softmax, stdDeviationOfVector, sumOfSquaresForVector, sumVector } from '../math/VectorMath.js'

import { alignDTWWindowed } from '../alignment/DTWSequenceAlignmentWindowed.js'
import { extendDeep } from '../utilities/ObjectUtilities.js'
import { Timeline, TimelineEntry } from '../utilities/Timeline.js'
import { AlignmentPath } from '../alignment/SpeechAlignment.js'
import { getRawAudioDuration, RawAudio, sliceRawAudio } from '../audio/AudioUtilities.js'
import { readFileAsUtf8 } from '../utilities/FileSystem.js'
import type { LanguageDetectionResults } from '../api/API.js'
import { formatLanguageCodeWithName, getShortLanguageCode, languageCodeToName } from '../utilities/Locale.js'
import { loadPackage } from '../utilities/PackageManager.js'
import chalk from 'chalk'
import { XorShift32PRNG } from '../utilities/RandomGenerator.js'
import { detectSpeechLanguageByParts } from '../api/SpeechLanguageDetection.js'
import { type Tiktoken } from 'tiktoken/lite'
import { isPunctuation, isWhitespace, isWord, splitToSentences, splitToWords } from '../nlp/Segmentation.js'
import { medianOf5Filter } from '../math/MedianFilter.js'
import { getDeflateCompressionMetricsForString } from '../utilities/Compression.js'
import { dmlProviderAvailable, getOnnxSessionOptions, makeOnnxLikeFloat32Tensor, OnnxExecutionProvider, OnnxLikeFloat32Tensor } from '../utilities/OnnxUtilities.js'
import { murmurHash3_int32Input } from '../utilities/Hashing.js'
import { containsInvalidCodepoint, getTokenRepetitionScore } from '../utilities/StringUtilities.js'
import { decodeUtf8 } from '../encodings/Utf8.js'
import { joinPath } from '../utilities/PathUtilities.js'

export async function recognize(
	sourceRawAudio: RawAudio,
	modelName: WhisperModelName,
	modelDir: string,
	task: WhisperTask,
	sourceLanguage: string,
	options: WhisperOptions) {

	options = extendDeep(defaultWhisperOptions, options)

	if (sourceRawAudio.sampleRate != 16000) {
		throw new Error('Source audio must have a sample rate of 16000 Hz')
	}

	sourceLanguage = getShortLanguageCode(sourceLanguage)

	if (!(sourceLanguage in languageIdLookup)) {
		throw new Error(`The language ${formatLanguageCodeWithName(sourceLanguage)} is not supported by the Whisper engine.`)
	}

	if (isEnglishOnlyModel(modelName) && sourceLanguage != 'en') {
		throw new Error(`The model '${modelName}' can only be used with English inputs. However, the given source language was ${languageCodeToName(sourceLanguage)}.`)
	}

	if (modelName === 'large-v3-turbo' && task === 'translate') {
		throw new Error(`The 'large-v3-turbo' model doesn't support translation tasks.`)
	}

	if (options.temperature && options.temperature < 0) {
		throw new Error(`Temperature can't be negative`)
	}

	// Workaround issue with large-v3-turbo that produces invalid results when a prompt is passed to it.
	// Always disable autoprompting for that model.
	if (options.autoPromptParts && modelName == 'large-v3-turbo') {
		options.autoPromptParts = false
	}

	// Select encoder ONNX provider
	const encoderProviders: OnnxExecutionProvider[] =
		options.encoderProvider ? [options.encoderProvider] : getDefaultEncoderProvidersForModel(modelName)

	// Select decoder ONNX provider
	const decoderProviders: OnnxExecutionProvider[] =
		options.decoderProvider ? [options.decoderProvider] : getDefaultDecoderProvidersForModel(modelName)

	const seed = options.seed

	const whisper = new Whisper(
		modelName,
		modelDir,
		encoderProviders,
		decoderProviders,
		seed)

	const result = await whisper.recognize(sourceRawAudio, task, sourceLanguage, options)

	return result
}

export async function align(
	sourceRawAudio: RawAudio,
	transcript: string,
	modelName: WhisperModelName,
	modelDir: string,
	sourceLanguage: string,
	options: WhisperAlignmentOptions) {

	options = extendDeep(defaultWhisperAlignmentOptions, options)

	if (sourceRawAudio.sampleRate != 16000) {
		throw new Error('Source audio must have a sample rate of 16000 Hz')
	}

	sourceLanguage = getShortLanguageCode(sourceLanguage)

	if (!(sourceLanguage in languageIdLookup)) {
		throw new Error(`The language ${formatLanguageCodeWithName(sourceLanguage)} is not supported by the Whisper engine.`)
	}

	if (isEnglishOnlyModel(modelName) && sourceLanguage != 'en') {
		throw new Error(`The model '${modelName}' can only be used with English inputs. However, the given source language was ${languageCodeToName(sourceLanguage)}.`)
	}

	// Select encoder ONNX provider
	const encoderProviders: OnnxExecutionProvider[] =
		options.encoderProvider ? [options.encoderProvider] : getDefaultEncoderProvidersForModel(modelName)

	// Select decoder ONNX provider
	const decoderProviders: OnnxExecutionProvider[] =
		options.decoderProvider ? [options.decoderProvider] : getDefaultDecoderProvidersForModel(modelName)

	const whisper = new Whisper(
		modelName,
		modelDir,
		encoderProviders,
		decoderProviders,)

	const timeline = await whisper.align(sourceRawAudio, transcript, sourceLanguage, 'transcribe', options)

	return timeline
}

export async function alignEnglishTranslation(
	sourceRawAudio: RawAudio,
	translatedTranscript: string,
	modelName: WhisperModelName,
	modelDir: string,
	sourceLanguage: string,
	options: WhisperAlignmentOptions) {

	options = extendDeep(defaultWhisperAlignmentOptions, options)

	if (sourceRawAudio.sampleRate != 16000) {
		throw new Error('Source audio must have a sample rate of 16000 Hz')
	}

	sourceLanguage = getShortLanguageCode(sourceLanguage)

	if (!(sourceLanguage in languageIdLookup)) {
		throw new Error(`The source language ${formatLanguageCodeWithName(sourceLanguage)} is not supported by the Whisper engine.`)
	}

	if (modelName === 'large-v3-turbo') {
		throw new Error(`The 'large-v3-turbo' model doesn't support translation tasks, so cannot be used for translation alignment.`)
	}

	if (isEnglishOnlyModel(modelName)) {
		throw new Error(`Translation alignment can only be done with multilingual models.`)
	}

	// Select encoder ONNX provider
	const encoderProviders: OnnxExecutionProvider[] =
		options.encoderProvider ? [options.encoderProvider] : getDefaultEncoderProvidersForModel(modelName)

	// Select decoder ONNX provider
	const decoderProviders: OnnxExecutionProvider[] =
		options.decoderProvider ? [options.decoderProvider] : getDefaultDecoderProvidersForModel(modelName)

	const whisper = new Whisper(
		modelName,
		modelDir,
		encoderProviders,
		decoderProviders,)

	const timeline = await whisper.align(sourceRawAudio, translatedTranscript, sourceLanguage, 'translate', options)

	return timeline
}

export async function detectLanguage(
	sourceRawAudio: RawAudio,
	modelName: WhisperModelName,
	modelDir: string,
	options: WhisperLanguageDetectionOptions) {

	options = extendDeep(defaultWhisperLanguageDetectionOptions, options)

	if (sourceRawAudio.sampleRate != 16000) {
		throw new Error('Source audio must have a sample rate of 16000 Hz')
	}

	if (!isMultilingualModel(modelName)) {
		throw new Error(`Language detection is only supported with multilingual models.`)
	}

	if (options.temperature! < 0) {
		throw new Error(`Temperature cannot be negative`)
	}

	// Select encoder ONNX provider
	const encoderProviders: OnnxExecutionProvider[] =
		options.encoderProvider ? [options.encoderProvider] : getDefaultEncoderProvidersForModel(modelName)

	// Select decoder ONNX provider
	const decoderProviders: OnnxExecutionProvider[] =
		options.decoderProvider ? [options.decoderProvider] : []

	const whisper = new Whisper(
		modelName,
		modelDir,
		encoderProviders,
		decoderProviders)

	async function detectLanguageForPart(partAudio: RawAudio) {
		const audioFeatures = await whisper.encodeAudio(partAudio)
		const partResults = await whisper.detectLanguage(audioFeatures, options.temperature!)

		return partResults
	}

	const results = await detectSpeechLanguageByParts(sourceRawAudio, detectLanguageForPart)

	results.sort((entry1, entry2) => entry2.probability - entry1.probability)

	return results
}

export async function detectVoiceActivity(
	sourceRawAudio: RawAudio,
	modelName: WhisperModelName,
	modelDir: string,
	options: WhisperVADOptions) {

	options = extendDeep(defaultWhisperVADOptions, options)

	if (sourceRawAudio.sampleRate != 16000) {
		throw new Error('Source audio must have a sample rate of 16000 Hz')
	}

	if (options.temperature! < 0) {
		throw new Error(`Temperature cannot be negative`)
	}

	const audioSamples = sourceRawAudio.audioChannels[0]

	const partDuration = 5
	const maxSamplesCountForPart = sourceRawAudio.sampleRate * partDuration

	// Select encoder ONNX provider
	const encoderProviders: OnnxExecutionProvider[] =
		options.encoderProvider ? [options.encoderProvider] : getDefaultEncoderProvidersForModel(modelName)

	// Select decoder ONNX provider
	const decoderProviders: OnnxExecutionProvider[] =
		options.decoderProvider ? [options.decoderProvider] : []

	const whisper = new Whisper(
		modelName,
		modelDir,
		encoderProviders,
		decoderProviders)

	const partProbabilities: Timeline = []

	for (let sampleOffset = 0; sampleOffset < audioSamples.length; sampleOffset += maxSamplesCountForPart) {
		const partSamples = sliceRawAudio(sourceRawAudio, sampleOffset, sampleOffset + maxSamplesCountForPart)

		const samplesCountForPart = partSamples.audioChannels[0].length

		const startTime = sampleOffset / sourceRawAudio.sampleRate
		const endTime = (sampleOffset + samplesCountForPart) / sourceRawAudio.sampleRate

		const encodedPartSamples = await whisper.encodeAudio(partSamples)
		const probabilityForPart = await whisper.detectVoiceActivity(encodedPartSamples, options.temperature!)

		partProbabilities.push({
			type: 'segment',
			text: '',
			startTime,
			endTime,
			confidence: probabilityForPart,
		})
	}

	return { partProbabilities }
}

export class Whisper {
	isMultiligualModel: boolean

	audioEncoder?: Onnx.InferenceSession
	textDecoder?: Onnx.InferenceSession

	tiktoken?: Tiktoken

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

	randomGen: XorShift32PRNG

	constructor(
		public readonly modelName: WhisperModelName,
		public readonly modelDir: string,
		public readonly encoderExecutionProviders: OnnxExecutionProvider[],
		public readonly decoderExecutionProviders: OnnxExecutionProvider[],
		prngSeed = 1234) {

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

		this.randomGen = new XorShift32PRNG(murmurHash3_int32Input(prngSeed))
	}

	async recognize(
		rawAudio: RawAudio,
		task: WhisperTask,
		language: string,
		options: WhisperOptions,
		logitFilter?: WhisperLogitFilter,
	) {
		await this.initializeIfNeeded()

		const logger = new Logger()

		options = extendDeep(defaultWhisperOptions, options)
		options.model = this.modelName

		if (!options.timestampAccuracy) {
			options.timestampAccuracy = this.defaultTimestampAccuracy
		}

		const audioSamples = rawAudio.audioChannels[0]
		const sampleRate = rawAudio.sampleRate
		const prompt = options.prompt
		const decodeTimestampTokens = options.decodeTimestampTokens!

		const maxAudioSamplesPerPart = sampleRate * 30

		let previousPartTextTokens: number[] = []

		let timeline: Timeline = []
		let allDecodedTokens: number[] = []

		let wrappedLogitFilter: WhisperLogitFilter | undefined

		if (logitFilter) {
			wrappedLogitFilter = (logits, partDecodedTokens, isFirstPart, isFinalPart) => {
				return logitFilter(logits, [...allDecodedTokens, ...partDecodedTokens], isFirstPart, isFinalPart)
			}
		}

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
				decodedTokensConfidence: partTokensConfidence,
				decodedTokensCrossAttentionQKs: partCrossAttentionQKs,
			} = await this.decodeTokens(
				audioPartFeatures,
				initialTokens,
				audioPartDuration,
				isFirstPart,
				isFinalPart,
				options,
				wrappedLogitFilter,
			)

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

			await logger.startAsync(`Extract timeline for part (timestamp accuracy: ${options.timestampAccuracy!})`)

			if (partTokens.length != partCrossAttentionQKs.length) {
				throw new Error('Unexpected: partTokens.length != partCrossAttentionQKs.length')
			}

			// Prepare tokens
			partTokens = partTokens.slice(initialTokens.length)
			partTokensConfidence = partTokensConfidence.slice(initialTokens.length)
			partCrossAttentionQKs = partCrossAttentionQKs.slice(initialTokens.length)

			// Find alignment path
			let alignmentHeads: number[] | undefined

			if (options.timestampAccuracy === 'medium' || options.model == 'large-v3-turbo') {
				alignmentHeads = this.alignmentHeadIndexes
			} else if (options.timestampAccuracy === 'high') {
				alignmentHeads = undefined
			} else {
				throw new Error(`Unsupported timestamp accuracy '${options.timestampAccuracy}', can only be 'medium' or 'high'.`)
			}

			const alignmentPath = await this.findAlignmentPathFromQKs(partCrossAttentionQKs, partTokens, 0, segmentFrameCount, alignmentHeads)

			// Generate timeline from alignment path
			const partTimeline = await this.getTokenTimelineFromAlignmentPath(alignmentPath, partTokens, segmentStartTime, segmentEndTime, partTokensConfidence)

			// Add tokens to output
			allDecodedTokens.push(...partTokens)
			timeline.push(...partTimeline)

			// Determine compression ratio for recognized text (normalized to lowercase) of this part
			const compressionRatioForPart = (await getDeflateCompressionMetricsForString(this.tokensToText(partTokens).toLocaleLowerCase())).ratio

			// If the recognized text isn't too repetitive
			if (compressionRatioForPart < options.repetitionThreshold!) {
				// Set current part tokens as the previous part text tokens
				previousPartTextTokens = partTokens.filter(token => this.isTextToken(token))
			} else {
				// Otherwise, set previous part tokens to an empty array
				previousPartTextTokens = []
			}

			audioOffset = audioEndOffset

			logger.end()
		}

		// Convert token timeline to word timeline
		timeline = this.tokenTimelineToWordTimeline(timeline, language)

		// Convert tokens to transcript
		const transcript = this.tokensToText(allDecodedTokens).trim()

		logger.end()

		return { transcript, timeline, allDecodedTokens }
	}

	async align(rawAudio: RawAudio, transcript: string, sourceLanguage: string, task: 'transcribe' | 'translate', whisperAlignmentOptions: WhisperAlignmentOptions) {
		await this.initializeTokenizerIfNeeded()

		whisperAlignmentOptions = extendDeep(defaultWhisperAlignmentOptions, whisperAlignmentOptions)

		if (!whisperAlignmentOptions.timestampAccuracy) {
			whisperAlignmentOptions.timestampAccuracy = this.defaultTimestampAccuracy
		}

		const targetLanguage = task === 'transcribe' ? sourceLanguage : 'en'

		const shouldSplitToSentences = false

		let simplifiedTranscript = ''

		if (shouldSplitToSentences) {
			const sentences = splitToSentences(transcript, targetLanguage)

			for (const sentence of sentences) {
				let sentenceWords = await splitToWords(sentence, targetLanguage)
				sentenceWords = sentenceWords.filter(word => isWord(word))

				simplifiedTranscript += sentenceWords.join(' ')
				simplifiedTranscript += ' '
			}
		} else {
			let words = await splitToWords(transcript, targetLanguage)

			words = words.map(word => word.trim())
			words = words.filter(word => isWord(word))

			simplifiedTranscript = words.join(' ')
		}

		// Tokenize the transcript
		const simplifiedTranscriptTokens = this.textToTokens(simplifiedTranscript)

		// Initialize custom logit filter that allows only the transcript tokens to be decoded
		// in order.
		const endOfTextToken = this.tokenConfig.endOfTextToken

		const logitFilter: WhisperLogitFilter = (logits, decodedTokens, isFirstPart, isFinalPart) => {
			const decodedTextTokens = decodedTokens.filter(token => this.isTextToken(token))

			const nextTokenToDecode = simplifiedTranscriptTokens[decodedTextTokens.length] ?? endOfTextToken

			const newLogits = logits.map((logit, index) => {
				if (index === nextTokenToDecode) {
					return logit
				}

				// If it's the final part, the ent-of-text token logit is set to -Infinity.
				// This will force to force all transcript tokens to be decoded even if the model doesn't
				// recognize them.
				if (!isFinalPart && index === endOfTextToken) {
					return logit
				}

				return -Infinity
			})

			return newLogits
		}

		// Set options for alignment
		const options: WhisperOptions = {
			model: this.modelName,
			temperature: 0.0,
			prompt: undefined,
			topCandidateCount: 1,
			punctuationThreshold: Infinity,
			autoPromptParts: false,
			maxTokensPerPart: whisperAlignmentOptions.maxTokensPerPart!,
			suppressRepetition: false,
			repetitionThreshold: Infinity,
			decodeTimestampTokens: true,
			endTokenThreshold: whisperAlignmentOptions.endTokenThreshold!,
			includeEndTokenInCandidates: false,
			timestampAccuracy: whisperAlignmentOptions.timestampAccuracy!,
			encoderProvider: whisperAlignmentOptions.encoderProvider!,
			decoderProvider: whisperAlignmentOptions.decoderProvider!,
			seed: undefined,
		}

		// Recognize
		const { timeline, allDecodedTokens } = await this.recognize(rawAudio, task, sourceLanguage, options, logitFilter)

		{
			// If not all tokens were decoded, add the remaining ones to the timeline
			const lastKnownWordStartTime = timeline.length > 0 ? timeline[timeline.length - 1].startTime : 0

			const allDecodedTextTokens = allDecodedTokens.filter(token => this.isTextToken(token))

			while (allDecodedTextTokens.length < simplifiedTranscriptTokens.length) {
				const token = simplifiedTranscriptTokens[allDecodedTextTokens.length]
				const tokenText = this.tokenToText(token)

				allDecodedTextTokens.push(token)

				const newTokenEntry: TimelineEntry = {
					type: 'token',
					text: tokenText,

					startTime: lastKnownWordStartTime,
					endTime: lastKnownWordStartTime,

					id: token,
					confidence: 0,
				}

				if (tokenText.startsWith(' ') || timeline.length === 0) {
					timeline.push({
						type: 'word',
						text: tokenText.trim(),

						startTime: lastKnownWordStartTime,
						endTime: lastKnownWordStartTime,

						timeline: [newTokenEntry],

						confidence: 0,
					})
				} else {
					const lastWordEntry = timeline[timeline.length - 1]

					lastWordEntry.timeline!.push(newTokenEntry)
					lastWordEntry.text += tokenText
				}
			}
		}

		return timeline
	}

	async detectLanguage(audioFeatures: Onnx.Tensor, temperature: number): Promise<LanguageDetectionResults> {
		if (!this.isMultiligualModel) {
			throw new Error('Language detection is only supported with multilingual models')
		}

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

	async detectVoiceActivity(audioFeatures: Onnx.Tensor, temperature: number): Promise<number> {
		await this.initializeDecoderSessionIfNeeded()

		// Prepare and run decoder
		const logger = new Logger()
		await logger.startAsync('Detect voice activity with Whisper model')

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

		const logits = Array.from(logitsBuffer)

		const probabilities = softmax(logits, temperature)

		const noSpeechProbability = probabilities[tokenConfig.nonSpeechToken]

		return 1.0 - noSpeechProbability
	}

	// Decode tokens using the decoder model
	async decodeTokens(
		audioFeatures: Onnx.Tensor,
		initialTokens: number[],
		audioDuration: number,
		isFirstPart: boolean,
		isFinalPart: boolean,
		options: WhisperOptions,
		logitFilter?: WhisperLogitFilter) {

		// Initialize
		await this.initializeTokenizerIfNeeded()
		await this.initializeDecoderSessionIfNeeded()

		const logger = new Logger()

		await logger.startAsync('Decode text tokens with Whisper decoder model')

		options = extendDeep(defaultWhisperOptions, options)

		const Onnx = await import('onnxruntime-node')

		// Get token information
		const endOfTextToken = this.tokenConfig.endOfTextToken
		const timestampTokensStart = this.tokenConfig.timestampTokensStart

		const suppressedTextTokens = this.getSuppressedTextTokens()
		const suppressedMetadataTokens = this.getSuppressedMetadataTokens()

		const allowedPunctuationMarks = this.getAllowedPunctuationMarks()

		const spaceToken = this.textToTokens(' ')[0]

		// Initialize variables for decoding loop
		let decodedTokens = initialTokens.slice()
		const initialKvDimensions = this.getKvDimensions(1, decodedTokens.length)
		let kvCacheTensor = new Onnx.Tensor('float32', new Float32Array(initialKvDimensions[0] * initialKvDimensions[1] * initialKvDimensions[2] * initialKvDimensions[3]), initialKvDimensions)

		let decodedTokensTimestampLogits: number[][] = []
		let decodedTokensConfidence: number[] = []
		let decodedTokensCrossAttentionQKs: OnnxLikeFloat32Tensor[] = []

		for (let i = 0; i < decodedTokens.length; i++) {
			decodedTokensTimestampLogits.push(new Array(1501))
			decodedTokensConfidence.push(1.0)
			decodedTokensCrossAttentionQKs.push(undefined as any)
		}

		let lastTimestampTokenIndex = -1
		let timestampTokenSeenCount = 0
		let bufferedTokensToPrint: number[] = []

		// Define method to add a token to output
		function addToken(tokenToAdd: number, timestampLogits: number[], confidence: number, crossAttentionQKs: OnnxLikeFloat32Tensor) {
			decodedTokens.push(tokenToAdd)
			decodedTokensTimestampLogits.push(timestampLogits)
			decodedTokensConfidence.push(confidence)
			decodedTokensCrossAttentionQKs.push(crossAttentionQKs)
		}

		// Start decoding loop
		for (let decodedTokenCount = 0; decodedTokenCount < options.maxTokensPerPart!; decodedTokenCount++) {
			const isInitialState = decodedTokens.length === initialTokens.length
			const atLeastOneTextTokenDecoded = decodedTokens.slice(initialTokens.length).some(token => this.isTextToken(token))

			// If not in initial state, reshape KV Cache tensor to accomodate a new output token
			if (!isInitialState) {
				const dims = kvCacheTensor.dims

				const currentKvCacheGroups = splitFloat32Array(kvCacheTensor.data as Float32Array, dims[2] * dims[3])

				const reshapedKvCacheTensor = new Onnx.Tensor('float32', new Float32Array(dims[0] * dims[1] * (decodedTokens.length) * dims[3]), [dims[0], dims[1], decodedTokens.length, dims[3]])
				const reshapedKvCacheGroups = splitFloat32Array(reshapedKvCacheTensor.data, decodedTokens.length * dims[3])

				for (let i = 0; i < dims[0]; i++) {
					reshapedKvCacheGroups[i].set(currentKvCacheGroups[i])
				}

				kvCacheTensor = reshapedKvCacheTensor
			}

			// Prepare values for decoder
			const tokensToDecode = isInitialState ? decodedTokens : [decodedTokens[decodedTokens.length - 1]]
			const offset = isInitialState ? 0 : decodedTokens.length

			const tokensTensor = new Onnx.Tensor('int64', new BigInt64Array(tokensToDecode.map(token => BigInt(token))), [1, tokensToDecode.length])
			const offsetTensor = new Onnx.Tensor('int64', new BigInt64Array([BigInt(offset)]), [])

			const decoderInputs = {
				tokens: tokensTensor,
				audio_features: audioFeatures,
				kv_cache: kvCacheTensor,
				offset: offsetTensor
			}

			// Run decoder model
			const decoderOutputs = await this.textDecoder!.run(decoderInputs)

			// Extract decoder model results
			const logitsBuffer = decoderOutputs['logits'].data as Float32Array
			kvCacheTensor = decoderOutputs['output_kv_cache'] as any

			const crossAttentionQKsForTokenOnnx = decoderOutputs['cross_attention_qks']
			const crossAttentionQKsForToken = makeOnnxLikeFloat32Tensor(crossAttentionQKsForTokenOnnx)
			crossAttentionQKsForTokenOnnx.dispose()

			// Get logits
			const resultLogitsFloatArrays = splitFloat32Array(logitsBuffer, logitsBuffer.length / decoderOutputs['logits'].dims[1])
			const allTokenLogits = Array.from(resultLogitsFloatArrays[resultLogitsFloatArrays.length - 1])

			// Suppress metadata tokens in the suppression set
			for (const suppressedTokenIndex of suppressedMetadataTokens) {
				allTokenLogits[suppressedTokenIndex] = -Infinity
			}

			if (!atLeastOneTextTokenDecoded) {
				// If in initial state, suppress end-of-text token
				allTokenLogits[endOfTextToken] = -Infinity
			}

			const timestampTokenLogits = allTokenLogits.slice(timestampTokensStart)

			const decodeTimestampTokenIfNeeded = () => {
				// Try to decode a timestamp token, if needed

				// If timestamp tokens is disabled in options, don't decode a timestamp
				if (!options.decodeTimestampTokens) {
					return false
				}

				// If this is the first token in the part, unconditionally decode a timestamp token
				// for time 0.0
				if (isInitialState) {
					addToken(timestampTokensStart, timestampTokenLogits, 1.0, crossAttentionQKsForToken)

					return true
				}

				const previousTokenWasTimestamp = this.isTimestampToken(decodedTokens[decodedTokens.length - 1])
				const secondPreviousTokenWasTimestamp = this.isTimestampToken(decodedTokens[decodedTokens.length - 2])

				// If there are two successive timestamp tokens decoded, or the previous timestamp was the first token,
				// don't decode a timestamp
				if (previousTokenWasTimestamp &&
					((decodedTokens.length === initialTokens.length + 1) || secondPreviousTokenWasTimestamp)) {
					return false
				}

				// Derive token probabilities
				const allTokenProbabilities = softmax(allTokenLogits as any, 1.0)
				const allTokenLogProbabilities = logOfVector(allTokenProbabilities)

				const nonTimestampTokenLogProbs = allTokenLogProbabilities.slice(0, timestampTokensStart)

				// Find highest non-timestamp token
				const indexOfMaxNonTimestampLogProb = indexOfMax(nonTimestampTokenLogProbs)
				const valueOfMaxNonTimestampLogProb = nonTimestampTokenLogProbs[indexOfMaxNonTimestampLogProb]

				// Find highest timestamp token
				const timestampTokenLogProbs = allTokenLogProbabilities.slice(timestampTokensStart)
				const indexOfMaxTimestampLogProb = indexOfMax(timestampTokenLogProbs)

				// Compute the log of the sum of exponentials of the log probabilities
				// of the timestamp tokens
				const logSumExpOfTimestampTokenLogProbs = logSumExp(timestampTokenLogProbs)

				// If the sum isn't greater than the log probability of the highest non-timestamp token,
				// don't decode a timestamp
				if (logSumExpOfTimestampTokenLogProbs <= valueOfMaxNonTimestampLogProb) {
					return false
				}

				// Decode a timestamp token
				timestampTokenSeenCount += 1

				if (previousTokenWasTimestamp) {
					// If previously decoded token was a timestamp token, repeat it
					const previousToken = decodedTokens[decodedTokens.length - 1]
					const previousTokenTimestampLogits = decodedTokensTimestampLogits[decodedTokensTimestampLogits.length - 1]
					const previousTokenConfidence = decodedTokensConfidence[decodedTokensConfidence.length - 1]

					addToken(previousToken, previousTokenTimestampLogits, previousTokenConfidence, crossAttentionQKsForToken)

					lastTimestampTokenIndex = decodedTokens.length
				} else {
					// Otherwise decode the highest probability timestamp
					const timestampToken = timestampTokensStart + indexOfMaxTimestampLogProb
					const confidence = allTokenProbabilities[timestampToken]

					addToken(timestampToken, timestampTokenLogits, confidence, crossAttentionQKsForToken)
				}

				return true
			}

			// Call the method to decode timestamp token if needed
			const timestampTokenDecoded = decodeTimestampTokenIfNeeded()

			if (timestampTokenDecoded) {
				await yieldToEventLoop()

				continue
			}

			// Decode a non-timestamp token
			let nonTimestampTokenLogits = allTokenLogits.slice(0, timestampTokensStart)

			let shouldDecodeEndfOfTextToken = false

			// If at least one text token was decoded, and the end-of-text token's probability is
			// sufficiently higher than the second highest ranked token, then accept end-of-text
			if (atLeastOneTextTokenDecoded) {
				const endOfTextTokenLogit = nonTimestampTokenLogits[endOfTextToken]

				const otherTokensLogits = nonTimestampTokenLogits.slice()
				otherTokensLogits[endOfTextToken] = -Infinity

				const indexOfMaximumOtherTokenLogit = indexOfMax(otherTokensLogits)
				const maximumOtherTokenLogit = nonTimestampTokenLogits[indexOfMaximumOtherTokenLogit]

				const endProbabilities = softmax([endOfTextTokenLogit, maximumOtherTokenLogit], 1.0)

				if (endProbabilities[0] > options.endTokenThreshold!) {
					shouldDecodeEndfOfTextToken = true
				}
			}

			if (logitFilter) {
				// Apply custom logit filter function if given
				nonTimestampTokenLogits = logitFilter(nonTimestampTokenLogits, decodedTokens, isFirstPart, isFinalPart)

				// If the custom filter set the end-of-text token to be Infinity, or -Infinity,
				// then override any previous decision and accept or reject it, respectively
				if (nonTimestampTokenLogits[endOfTextToken] === Infinity) {
					shouldDecodeEndfOfTextToken = true
				} else if (nonTimestampTokenLogits[endOfTextToken] === -Infinity) {
					shouldDecodeEndfOfTextToken = false
				}

				// If filter caused all word token logits to be -Infinity, then there is no
				// other token to decode. Fall back to accept end-of-text
				if (nonTimestampTokenLogits.slice(0, endOfTextToken).every(logit => logit === -Infinity)) {
					shouldDecodeEndfOfTextToken = true
				}
			} else {
				// Otherwise, suppress text tokens in the suppression set
				for (const suppressedTokenIndex of suppressedTextTokens) {
					nonTimestampTokenLogits[suppressedTokenIndex] = -Infinity
				}

				// Suppress the space token if at initial state
				if (isInitialState) {
					nonTimestampTokenLogits[spaceToken] = -Infinity
				}
			}

			// If end-of-text token should be decoded, then add it and break
			// out of the loop
			if (shouldDecodeEndfOfTextToken) {
				addToken(endOfTextToken, timestampTokenLogits, 1.0, crossAttentionQKsForToken)

				break
			}

			// Suppress end-of-text token if it shouldn't be included in candidates
			if (!options.includeEndTokenInCandidates) {
				nonTimestampTokenLogits[endOfTextToken] = -Infinity
			}

			// Find top candidates
			const sortedNonTimestampLogitsWithIndexes =
				Array.from(nonTimestampTokenLogits).map((logit, index) => ({ token: index, logit }))

			sortedNonTimestampLogitsWithIndexes.sort((a, b) => b.logit - a.logit)

			let topCandidates = sortedNonTimestampLogitsWithIndexes.slice(0, options.topCandidateCount!)
				.map(entry => ({
					token: entry.token,
					logit: entry.logit,
					text: this.tokenToText(entry.token, true)
				}))

			// Apply repetition suppression if enabled
			if (options.suppressRepetition) {
				// Using some hardcoded constants, for now
				const tokenWindowSize = 30
				const thresholdMatchLength = 4
				const thresholdCycleRepetition = 3

				const filteredCandidates: typeof topCandidates = []

				for (const candidate of topCandidates) {
					const lastDecodedTextTokens = decodedTokens
						.filter(token => this.isTextToken(token))
						.reverse()
						.slice(0, tokenWindowSize)

					const { longestMatch, longestCycleRepetition } = getTokenRepetitionScore([candidate.token, ...lastDecodedTextTokens])

					if (longestMatch >= thresholdMatchLength || longestCycleRepetition >= thresholdCycleRepetition) {
						continue
					}

					filteredCandidates.push(candidate)
				}

				// If all candidates have been filtered out, accept an end-of-text token
				if (filteredCandidates.length === 0) {
					filteredCandidates.push({
						token: endOfTextToken,
						logit: Infinity,
						text: this.tokenToText(endOfTextToken, true)
					})
				}

				topCandidates = filteredCandidates
			}

			// Compute top candidate probabilities
			const topCandidateProbabilities = softmax(topCandidates.map(a => a.logit), options.temperature)

			// Find highest ranking punctuation token
			const rankOfPromisingPunctuationToken = topCandidates.findIndex((entry, index) => {
				const tokenText = this.tokenToText(entry.token).trim()

				const isPunctuationToken = allowedPunctuationMarks.includes(tokenText)

				if (!isPunctuationToken) {
					return false
				}

				const tokenProb = topCandidateProbabilities[index]

				return tokenProb >= options.punctuationThreshold!
			})

			// Find rank of space token
			let rankOfSpaceToken = topCandidates.findIndex(candidate => candidate.token === spaceToken)

			if (rankOfSpaceToken < 0) {
				rankOfSpaceToken = Infinity
			}

			// Choose token
			let chosenCandidateRank: number

			// Select a high-ranking punctuation token if found, and it has
			// a rank higher than the space token,
			if (rankOfPromisingPunctuationToken >= 0 &&
				rankOfPromisingPunctuationToken < rankOfSpaceToken) {

				chosenCandidateRank = rankOfPromisingPunctuationToken
			} else {
				// Otherwise, select randomly from top k distribution
				chosenCandidateRank = this.randomGen.selectRandomIndexFromDistribution(topCandidateProbabilities)
			}

			// Add chosen token
			const chosenToken = topCandidates[chosenCandidateRank].token
			const chosenTokenConfidence = topCandidateProbabilities[chosenCandidateRank]

			addToken(chosenToken, timestampTokenLogits, chosenTokenConfidence, crossAttentionQKsForToken)

			// If chosen token is the end-of-text token, break
			if (chosenToken === endOfTextToken) {
				break
			}

			// Print token if needed
			if (this.isTextToken(chosenToken)) {
				bufferedTokensToPrint.push(chosenToken)

				let textToPrint = this.tokensToText(bufferedTokensToPrint)

				// If the decoded text is valid, print it
				if (!containsInvalidCodepoint(textToPrint)) {
					if (isFirstPart && decodedTokens.every(token => this.isMetadataToken(token))) {
						textToPrint = textToPrint.trimStart()
					}

					logger.write(textToPrint)

					bufferedTokensToPrint = []
				}
			}

			await yieldToEventLoop()
		}

		// If at least two timestamp tokens were decoded and it's not the final part,
		// truncate up to the last timestamp token
		if (timestampTokenSeenCount >= 2 && !isFinalPart) {
			const sliceEndTokenIndex = lastTimestampTokenIndex

			decodedTokens = decodedTokens.slice(0, sliceEndTokenIndex)
			decodedTokensTimestampLogits = decodedTokensTimestampLogits.slice(0, sliceEndTokenIndex)
			decodedTokensCrossAttentionQKs = decodedTokensCrossAttentionQKs.slice(0, sliceEndTokenIndex)
			decodedTokensConfidence = decodedTokensConfidence.slice(0, sliceEndTokenIndex)
		}

		logger.write('\n')
		logger.end()

		// Return the decoded tokens
		return {
			decodedTokens,
			decodedTokensTimestampLogits,
			decodedTokensConfidence,
			decodedTokensCrossAttentionQKs,
		}
	}

	// Encode audio using the encoder model
	async encodeAudio(rawAudio: RawAudio) {
		await this.initializeEncoderSessionIfNeeded()

		const Onnx = await import('onnxruntime-node')

		const logger = new Logger()

		const audioSamples = rawAudio.audioChannels[0]
		const sampleRate = rawAudio.sampleRate

		const fftOrder = 400
		const fftWindowSize = 400
		const fftHopLength = 160

		const filterbankCount = this.filterbankCount
		const filterbanks = this.filterbanks

		const maxAudioSamples = sampleRate * 30
		const maxAudioFrames = 3000

		if (sampleRate != 16000) {
			throw new Error('Audio must have a sample rate of 16000 Hz')
		}

		if (audioSamples.length > maxAudioSamples) {
			throw new Error(`Audio part is longer than 30 seconds`)
		}

		// Compute a mel spectogram
		await logger.startAsync('Extract mel spectogram from audio part')

		// Pad audio samples to ensure that have a duration of 30 seconds
		const paddedAudioSamples = new Float32Array(maxAudioSamples)
		paddedAudioSamples.set(audioSamples, 0)

		const rawAudioPart: RawAudio = { audioChannels: [paddedAudioSamples], sampleRate }

		const { melSpectogram } = await computeMelSpectogramUsingFilterbanks(rawAudioPart, fftOrder, fftWindowSize, fftHopLength, filterbanks)

		await logger.startAsync('Normalize mel spectogram')

		const logMelSpectogram = melSpectogram.map(spectrum => spectrum.map(mel => Math.log10(Math.max(mel, 1e-10))))

		// Find maximum log mel value in the spectrum
		let maxLogMel = -Infinity

		for (const spectrum of logMelSpectogram) {
			for (const mel of spectrum) {
				if (mel > maxLogMel) {
					maxLogMel = mel
				}
			}
		}

		// Normalize log mel spectogram (based on Python reference code)
		const normalizedLogMelSpectogram = logMelSpectogram.map(spectrum => spectrum.map(
			logMel => (Math.max(logMel, maxLogMel - 8) + 4) / 4))

		// Flatten the normalized log mel spectogram
		const flattenedNormalizedLogMelSpectogram = new Float32Array(maxAudioFrames * filterbankCount)

		for (let i = 0; i < filterbankCount; i++) {
			for (let j = 0; j < maxAudioFrames; j++) {
				flattenedNormalizedLogMelSpectogram[(i * maxAudioFrames) + j] = normalizedLogMelSpectogram[j][i]
			}
		}

		// Run the encoder model
		await logger.startAsync('Encode mel spectogram with Whisper encoder model')

		const inputTensor = new Onnx.Tensor('float32', flattenedNormalizedLogMelSpectogram, [1, filterbankCount, maxAudioFrames])

		const encoderInputs = { mel: inputTensor }

		const encoderOutputs = await this.audioEncoder!.run(encoderInputs)
		const encodedAudioFeatures = encoderOutputs['output']

		logger.end()

		return encodedAudioFeatures
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

		if (language != 'zh' && language != 'ja') {
			tokenTimeline = tokenTimeline.filter(entry => this.isTextToken(entry.id!))
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

	async findAlignmentPathFromQKs(qksTensors: OnnxLikeFloat32Tensor[], tokens: number[], segmentStartFrame: number, segmentEndFrame: number, headIndexes?: number[]) {
		const segmentFrameCount = segmentEndFrame - segmentStartFrame

		if (segmentFrameCount === 0 || tokens.length === 0 || qksTensors.length === 0) {
			return []
		}

		const tokenCount = qksTensors.length
		const layerCount = qksTensors[0].dims[0]
		const headCount = qksTensors[0].dims[2]
		const frameCount = qksTensors[0].dims[4]

		if (!headIndexes) {
			headIndexes = getIntegerRange(0, layerCount * headCount)
		}

		// Load attention head weights from tensors
		const attentionHeads: Float32Array[][] = [] // structure: [heads, tokens, frames]

		for (const headIndex of headIndexes) {
			const attentionHead: Float32Array[] = [] // structure: [tokens, frames]

			for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex++) {
				const bufferOffset = headIndex * frameCount
				const startIndexInBuffer = bufferOffset + segmentStartFrame
				const endIndexInBuffer = bufferOffset + segmentEndFrame

				const framesForHead = qksTensors[tokenIndex].data.slice(startIndexInBuffer, endIndexInBuffer)

				attentionHead.push(framesForHead)
			}

			attentionHeads.push(attentionHead)
		}

		const applySoftmax = true
		const normalize = true
		const applyMedianFilter = true
		const anchorTimestampTokens = false

		const softmaxTemperature = 1.0

		// Apply softmax to each token's frames, if enabled
		if (applySoftmax) {
			for (const head of attentionHeads) {
				for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex++) {
					head[tokenIndex] = softmax(head[tokenIndex], softmaxTemperature)
				}
			}
		}

		// Normalize all weights in each individual head, if enabled
		if (normalize) {
			for (const head of attentionHeads) {
				let sumOfAllWeightsForHead = 0
				let sumOfAllSquaredWeightsForHead = 0
				let countOfAllWeightsForHead = 0

				for (const tokenFrames of head) {
					sumOfAllWeightsForHead += sumVector(tokenFrames)
					sumOfAllSquaredWeightsForHead += sumOfSquaresForVector(tokenFrames)
					countOfAllWeightsForHead += tokenFrames.length
				}

				const meanOfAllWeightsForHead = sumOfAllWeightsForHead / countOfAllWeightsForHead
				const varianceOfAllWeightsForHead = sumOfAllSquaredWeightsForHead / countOfAllWeightsForHead
				const stdDeviationOfAllWeightsForHead = Math.sqrt(varianceOfAllWeightsForHead)

				const stdDeviationReciprocal = 1.0 / (stdDeviationOfAllWeightsForHead + 1e-10)

				for (const tokenFrames of head) {
					for (let frameIndex = 0; frameIndex < tokenFrames.length; frameIndex++) {
						tokenFrames[frameIndex] = (tokenFrames[frameIndex] - meanOfAllWeightsForHead) * stdDeviationReciprocal
					}
				}
			}
		}

		// Apply median filter to each token's frames, if enabled
		if (applyMedianFilter) {
			for (const head of attentionHeads) {
				for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex++) {
					head[tokenIndex] = medianOf5Filter(head[tokenIndex])
				}
			}
		}

		// Compute the mean of the selected attention heads for all layers
		const frameMeansForToken: Float32Array[] = []

		for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex++) {
			const meansForFrames = new Float32Array(segmentFrameCount)

			for (let frameIndex = 0; frameIndex < segmentFrameCount; frameIndex++) {
				let sum = 0

				for (const head of attentionHeads) {
					sum += head[tokenIndex][frameIndex]
				}

				const frameMean = sum / attentionHeads.length

				meansForFrames[frameIndex] = frameMean
			}

			frameMeansForToken.push(meansForFrames)
		}

		// Anchor timestamp tokens timestamps to their original values, if enabled
		if (anchorTimestampTokens) {
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

		// Perform DTW to align tokens indexes to frame indexes
		const tokenIndexes = getIntegerRange(0, tokenCount)
		const frameIndexes = getIntegerRange(0, segmentFrameCount)

		let { path } = alignDTWWindowed(tokenIndexes, frameIndexes, (tokenIndex, frameIndex) => {
			return -frameMeansForToken[tokenIndex][frameIndex]
		}, segmentFrameCount)

		path = path.map(entry => ({ source: entry.source, dest: segmentStartFrame + entry.dest }))

		return path
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

		const tiktokenDataFilePath = joinPath(tiktokenModulePackagePath, this.isMultiligualModel ? 'multilingual.tiktoken' : 'gpt2.tiktoken')
		let tiktokenData = await readFileAsUtf8(tiktokenDataFilePath)

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

		const onnxSessionOptions = getOnnxSessionOptions({ executionProviders: this.encoderExecutionProviders })

		const onnxProvidersString = onnxSessionOptions.executionProviders!.length > 0 ? `${ onnxSessionOptions.executionProviders!.join(', ') }` : `default`

		await logger.startAsync(`Create encoder inference session for model '${this.modelName}' (ONNX provider: ${onnxProvidersString})`)

		const encoderFilePath = joinPath(this.modelDir, 'encoder.onnx')

		const Onnx = await import('onnxruntime-node')

		this.audioEncoder = await Onnx.InferenceSession.create(encoderFilePath, onnxSessionOptions)

		logger.end()
	}

	async initializeDecoderSessionIfNeeded() {
		if (this.textDecoder) {
			return
		}

		const logger = new Logger()

		const onnxSessionOptions = getOnnxSessionOptions({ executionProviders: this.decoderExecutionProviders })

		const onnxProvidersString = onnxSessionOptions.executionProviders!.length > 0 ? `${onnxSessionOptions.executionProviders!.join(', ')}` : `default`

		await logger.startAsync(`Create decoder inference session for model '${this.modelName}' (ONNX provider: ${onnxProvidersString})`)

		const decoderFilePath = joinPath(this.modelDir, 'decoder.onnx')

		const Onnx = await import('onnxruntime-node')

		this.textDecoder = await Onnx.InferenceSession.create(decoderFilePath, onnxSessionOptions)

		logger.end()
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
		} else if (modelName == 'large-v1' || modelName == 'large-v2' || modelName == 'large-v3' || modelName == 'large-v3-turbo') {
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
			return decodeUtf8(this.tiktoken!.decode(new Uint32Array(tokens)))
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

	get isLargeModel() {
		return this.modelName.startsWith('large')
	}

	get filterbankCount() {
		return this.isLargeModel ? 128 : 80
	}

	get filterbanks() {
		return this.isLargeModel ? filterbanks_128 : filterbanks_80
	}

	get alignmentHeadIndexes() {
		return alignmentHeadsIndexes[this.modelName]
	}

	get defaultTimestampAccuracy() {
		if (this.modelName.startsWith('tiny') || this.modelName.startsWith('base')) {
			return 'high'
		} else {
			return 'medium'
		}
	}

	getSuppressedTokens() {
		return [
			...this.getSuppressedTextTokens(),
			...this.getSuppressedMetadataTokens(),
		]
	}

	getSuppressedTextTokens() {
		const allowedPunctuationMarks = this.getAllowedPunctuationMarks()

		const nonWordTokensData = this.getWordTokenData().nonWordTokenData

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

	getWordTokenData() {
		const wordTokenData: WhisperTokenData[] = []
		const nonWordTokenData: WhisperTokenData[] = []

		for (let i = 0; i < this.tokenConfig.endOfTextToken; i++) {
			const tokenText = this.tokenToText(i, false)

			const isNonWordToken = /^[\s\p{Punctuation}\p{Symbol}]+$/u.test(tokenText)

			const containsInvalidUTF8 = containsInvalidCodepoint(tokenText)

			if (isNonWordToken && (this.isEnglishOnlyModel || !containsInvalidUTF8)) {
				nonWordTokenData.push({
					id: i,
					text: tokenText,
				})
			} else {
				wordTokenData.push({
					id: i,
					text: tokenText,
				})
			}
		}

		return { wordTokenData, nonWordTokenData }
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

	if (modelName.startsWith('large') && modelName !== 'large-v3-turbo') {
		throw new Error(`Models 'large-v1', 'large-v2', 'large-v3' are not currently supported by the integrated Whisper engine due to model size restrictions of onnxruntime-node. To use large models, you can either select large-v3-turbo use the whisper.cpp engine instead.`)
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
		logger.logTitledMessage(`Warning`, `The model '${originalModelName}' is English only and cannot be used to transcribe language '${languageCode}'. Using '${modelName}' instead.`, chalk.yellowBright, 'warning')
	}

	return modelName
}

export function isMultilingualModel(modelName: WhisperModelName) {
	return !isEnglishOnlyModel(modelName)
}

export function isEnglishOnlyModel(modelName: WhisperModelName) {
	return modelName.endsWith('.en')
}

export function getDefaultEncoderProvidersForModel(modelName: WhisperModelName): OnnxExecutionProvider[] {
	if (dmlProviderAvailable()) {
		return ['dml', 'cpu']
	} else {
		return []
	}
}

export function getDefaultDecoderProvidersForModel(modelName: WhisperModelName): OnnxExecutionProvider[] {
	if (modelName.startsWith('small') || modelName.startsWith('medium') || modelName.startsWith('large')) {
		if (dmlProviderAvailable()) {
			return ['dml', 'cpu']
		} else {
			return []
		}
	} else {
		return []
	}
}

export type WhisperTokenData = {
	id: number
	text: string
}

export type WhisperLogitFilter = (logits: number[], decodedTokens: number[], isFirstPart: boolean, isFinalPart: boolean) => number[]

export type WhisperModelName = 'tiny' | 'tiny.en' | 'base' | 'base.en' | 'small' | 'small.en' | 'medium' | 'medium.en' | 'large-v1' | 'large-v2' | 'large-v3' | 'large-v3-turbo'
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
	'large-v1': 'whisper-large-v1',
	'large-v2': 'whisper-large-v2',
	'large-v3': 'whisper-large-v3',
	'large-v3-turbo': 'whisper-large-v3-turbo-fp16',
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
	'tiny.en': [6, 12, 17, 18, 19, 20, 21, 22,],
	'tiny': [14, 18, 20, 21, 22, 23,],
	'base.en': [27, 39, 41, 45, 47,],
	'base': [25, 34, 35, 39, 41, 42, 44, 46,],
	'small.en': [78, 84, 87, 92, 98, 101, 103, 108, 112, 116, 118, 120, 121, 122, 123, 126, 131, 134, 136,],
	'small': [63, 69, 96, 100, 103, 104, 108, 115, 117, 125,],
	'medium.en': [180, 225, 236, 238, 244, 256, 260, 265, 284, 286, 295, 298, 303, 320, 323, 329, 334, 348,],
	'medium': [223, 244, 255, 257, 320, 372,],
	'large-v1': [199, 222, 224, 237, 447, 451, 457, 462, 475,],
	'large-v2': [212, 277, 331, 332, 333, 355, 356, 364, 371, 379, 391, 422, 423, 443, 449, 452, 465, 467, 473, 505, 521, 532, 555,],
	'large-v3': [140, 217, 258, 272, 321, 354, 391, 424, 481, 506,],
	'large-v3-turbo': [44, 51, 63, 66, 71, 74,],
}

const filterbanks_80: Filterbank[] = [
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

const filterbanks_128: Filterbank[] = [
/* 0 */ { startIndex: 1, weights: [0.012373986653983593,] },

/* 1 */ { startIndex: 1, weights: [0.030392564833164215,] },

/* 2 */ { startIndex: 2, weights: [0.024747973307967186,] },

/* 3 */ { startIndex: 2, weights: [0.018018579110503197,] },

/* 4 */ { startIndex: 3, weights: [0.037121959030628204,] },

/* 5 */ { startIndex: 3, weights: [0.005644591990858316, 0.006729394197463989,] },

/* 6 */ { startIndex: 4, weights: [0.03603715822100639,] },

/* 7 */ { startIndex: 5, weights: [0.019103379920125008,] },

/* 8 */ { startIndex: 5, weights: [0.023663168773055077,] },

/* 9 */ { startIndex: 6, weights: [0.031477365642786026,] },

/* 10 */ { startIndex: 6, weights: [0.011289183981716633, 0.0010848019737750292,] },

/* 11 */ { startIndex: 7, weights: [0.04168175160884857,] },

/* 12 */ { startIndex: 8, weights: [0.013458788394927979,] },

/* 13 */ { startIndex: 8, weights: [0.029307762160897255,] },

/* 14 */ { startIndex: 9, weights: [0.025832774117588997,] },

/* 15 */ { startIndex: 9, weights: [0.016933776438236237,] },

/* 16 */ { startIndex: 10, weights: [0.038206759840250015,] },

/* 17 */ { startIndex: 10, weights: [0.004559790249913931, 0.007814195938408375,] },

/* 18 */ { startIndex: 11, weights: [0.03495235741138458,] },

/* 19 */ { startIndex: 12, weights: [0.020188182592391968,] },

/* 20 */ { startIndex: 12, weights: [0.022578367963433266,] },

/* 21 */ { startIndex: 13, weights: [0.032562170177698135,] },

/* 22 */ { startIndex: 13, weights: [0.010204383172094822, 0.0021696039475500584,] },

/* 23 */ { startIndex: 14, weights: [0.04059694707393646,] },

/* 24 */ { startIndex: 15, weights: [0.01454358920454979,] },

/* 25 */ { startIndex: 15, weights: [0.028222959488630295,] },

/* 26 */ { startIndex: 16, weights: [0.026917576789855957,] },

/* 27 */ { startIndex: 16, weights: [0.015848975628614426,] },

/* 28 */ { startIndex: 17, weights: [0.039291560649871826,] },

/* 29 */ { startIndex: 17, weights: [0.0034749882761389017, 0.008898998610675335,] },

/* 30 */ { startIndex: 18, weights: [0.03386755287647247,] },

/* 31 */ { startIndex: 19, weights: [0.021272985264658928,] },

/* 32 */ { startIndex: 19, weights: [0.021493567153811455,] },

/* 33 */ { startIndex: 20, weights: [0.033646970987319946,] },

/* 34 */ { startIndex: 20, weights: [0.009119580499827862, 0.003254405688494444,] },

/* 35 */ { startIndex: 21, weights: [0.03951214626431465,] },

/* 36 */ { startIndex: 22, weights: [0.01562839187681675,] },

/* 37 */ { startIndex: 22, weights: [0.027138158679008484,] },

/* 38 */ { startIndex: 23, weights: [0.028002377599477768,] },

/* 39 */ { startIndex: 23, weights: [0.014764172956347466,] },

/* 40 */ { startIndex: 24, weights: [0.040376365184783936,] },

/* 41 */ { startIndex: 24, weights: [0.0023806870449334383, 0.010202637873589993,] },

/* 42 */ { startIndex: 25, weights: [0.03161146119236946,] },

/* 43 */ { startIndex: 26, weights: [0.024547001346945763,] },

/* 44 */ { startIndex: 26, weights: [0.015329193323850632, 0.001665837480686605,] },

/* 45 */ { startIndex: 27, weights: [0.036729052662849426,] },

/* 46 */ { startIndex: 28, weights: [0.020097099244594574,] },

/* 47 */ { startIndex: 28, weights: [0.016931025311350822, 0.0029026553966104984,] },

/* 48 */ { startIndex: 29, weights: [0.032844990491867065,] },

/* 49 */ { startIndex: 30, weights: [0.023520048707723618,] },

/* 50 */ { startIndex: 30, weights: [0.011038944125175476, 0.010725829750299454,] },

/* 51 */ { startIndex: 31, weights: [0.022718291729688644,] },

/* 52 */ { startIndex: 32, weights: [0.03227872774004936,] },

/* 53 */ { startIndex: 32, weights: [0.00011626833293121308, 0.022853482514619827,] },

/* 54 */ { startIndex: 33, weights: [0.008563440293073654, 0.014979788102209568,] },

/* 55 */ { startIndex: 34, weights: [0.015513983555138111, 0.008514906279742718,] },

/* 56 */ { startIndex: 35, weights: [0.02110680378973484, 0.003326520323753357,] },

/* 57 */ { startIndex: 36, weights: [0.02547064796090126,] },

/* 58 */ { startIndex: 37, weights: [0.02735907956957817,] },

/* 59 */ { startIndex: 37, weights: [0.0006585361552424729, 0.02383812516927719,] },

/* 60 */ { startIndex: 38, weights: [0.0034435924608260393, 0.021224552765488625,] },

/* 61 */ { startIndex: 39, weights: [0.0053584217093884945, 0.019425557926297188,] },

/* 62 */ { startIndex: 40, weights: [0.006493247114121914, 0.018355421721935272,] },

/* 63 */ { startIndex: 41, weights: [0.006931380834430456, 0.017935046926140785,] },

/* 64 */ { startIndex: 42, weights: [0.0067496825940907, 0.018091518431901932,] },

/* 65 */ { startIndex: 43, weights: [0.006018991116434336, 0.018757672980427742,] },

/* 66 */ { startIndex: 44, weights: [0.004804528318345547, 0.019871728494763374,] },

/* 67 */ { startIndex: 45, weights: [0.0031662785913795233, 0.02137690968811512, 0.001253173453733325,] },

/* 68 */ { startIndex: 46, weights: [0.0011593446834012866, 0.02080361731350422, 0.004044868052005768,] },

/* 69 */ { startIndex: 48, weights: [0.017553631216287613, 0.007083200383931398,] },

/* 70 */ { startIndex: 49, weights: [0.014075386337935925, 0.010326550342142582,] },

/* 71 */ { startIndex: 50, weights: [0.010409214533865452, 0.013736963272094727,] },

/* 72 */ { startIndex: 51, weights: [0.006591876968741417, 0.017279881983995438, 0.0014680421445518732,] },

/* 73 */ { startIndex: 52, weights: [0.0026568188332021236, 0.01809193193912506, 0.005856557283550501,] },

/* 74 */ { startIndex: 54, weights: [0.013342779129743576, 0.010282675735652447,] },

/* 75 */ { startIndex: 55, weights: [0.00856800377368927, 0.01472230814397335, 0.001040398608893156,] },

/* 76 */ { startIndex: 56, weights: [0.003790855873376131, 0.01714678481221199, 0.006116092670708895,] },

/* 77 */ { startIndex: 58, weights: [0.011759290471673012, 0.011133937165141106,] },

/* 78 */ { startIndex: 59, weights: [0.006438578478991985, 0.01607806235551834, 0.004239172209054232,] },

/* 79 */ { startIndex: 60, weights: [0.0011998937698081136, 0.012756715528666973, 0.00965298991650343,] },

/* 80 */ { startIndex: 62, weights: [0.007069352548569441, 0.014940546825528145, 0.004190248437225819,] },

/* 81 */ { startIndex: 63, weights: [0.0015148338861763477, 0.012008999474346638, 0.009848233312368393,] },

/* 82 */ { startIndex: 65, weights: [0.006102240178734064, 0.01533857174217701, 0.005576768424361944,] },

/* 83 */ { startIndex: 66, weights: [0.00036827256553806365, 0.00989749375730753, 0.011353404261171818, 0.0020512230694293976,] },

/* 84 */ { startIndex: 68, weights: [0.003892971435561776, 0.012973522767424583, 0.00806631613522768,] },

/* 85 */ { startIndex: 70, weights: [0.006744932383298874, 0.013858746737241745, 0.005411905236542225,] },

/* 86 */ { startIndex: 71, weights: [0.0007422015769407153, 0.008987790904939175, 0.011378713883459568, 0.003329580882564187,] },

/* 87 */ { startIndex: 73, weights: [0.0028231353498995304, 0.010680492967367172, 0.00943340640515089, 0.0017632555682212114,] },

/* 88 */ { startIndex: 75, weights: [0.0043901861645281315, 0.011877589859068394, 0.007970058359205723, 0.0006610470009036362,] },

/* 89 */ { startIndex: 77, weights: [0.005494666751474142, 0.012629535980522633, 0.00693987961858511,] },

/* 90 */ { startIndex: 79, weights: [0.006184019148349762, 0.0129347313195467, 0.00629778765141964,] },

/* 91 */ { startIndex: 80, weights: [2.3252101527759805e-05, 0.006502066273242235, 0.0123266177251935, 0.006002165377140045,] },

/* 92 */ { startIndex: 82, weights: [0.00031548753031529486, 0.006489255465567112, 0.012041302397847176, 0.006014628801494837,] },

/* 93 */ { startIndex: 84, weights: [0.00029979555984027684, 0.006182880140841007, 0.012042728252708912, 0.006299811881035566, 0.0005568959750235081,] },

/* 94 */ { startIndex: 86, weights: [1.1204706424905453e-05, 0.005617291666567326, 0.011223378591239452, 0.0068251630291342735, 0.0013526449911296368,] },

/* 95 */ { startIndex: 89, weights: [0.004824100062251091, 0.010166232474148273, 0.007560755126178265, 0.002345903078094125,] },

/* 96 */ { startIndex: 91, weights: [0.003832357469946146, 0.008922962471842766, 0.00847910437732935, 0.003509786445647478,] },

/* 97 */ { startIndex: 93, weights: [0.0026687318459153175, 0.007519651670008898, 0.009555005468428135, 0.004819661378860474, 8.431751484749839e-05,] },

/* 98 */ { startIndex: 95, weights: [0.001357673667371273, 0.005980195011943579, 0.01060271542519331, 0.0062529849819839, 0.0017405991675332189,] },

/* 99 */ { startIndex: 98, weights: [0.004326442256569862, 0.008731318637728691, 0.007789165247231722, 0.003489238675683737,] },

/* 100 */ { startIndex: 100, weights: [0.0025783509481698275, 0.006775828544050455, 0.00940941646695137, 0.005311945918947458, 0.0012144759530201554,] },

/* 101 */ { startIndex: 102, weights: [0.0007541119121015072, 0.004753957036882639, 0.008753802627325058, 0.007192090153694153, 0.003287544008344412,] },

/* 102 */ { startIndex: 105, weights: [0.0026817969046533108, 0.0064933146350085735, 0.009114579297602177, 0.005393873900175095, 0.0016731682699173689,] },

/* 103 */ { startIndex: 107, weights: [0.0005739429616369307, 0.0042060003615915775, 0.007838058285415173, 0.007520230021327734, 0.003974708262830973, 0.00042918731924146414,] },

/* 104 */ { startIndex: 110, weights: [0.0019046447705477476, 0.005365691613405943, 0.008826738223433495, 0.0062760948203504086, 0.0028975096065551043,] },

/* 105 */ { startIndex: 113, weights: [0.0028988525737076998, 0.006196940783411264, 0.008566990494728088, 0.005347481928765774, 0.002127972897142172,] },

/* 106 */ { startIndex: 115, weights: [0.0004475022724363953, 0.0035903039388358593, 0.006733105983585119, 0.007770236115902662, 0.004702313803136349, 0.0016343912575393915,] },

/* 107 */ { startIndex: 118, weights: [0.0010153602343052626, 0.004010187461972237, 0.007005014456808567, 0.007234429940581322, 0.0043109566904604435, 0.0013874832075089216,] },

/* 108 */ { startIndex: 121, weights: [0.0013334885006770492, 0.004187308251857758, 0.007041127886623144, 0.0069318837486207485, 0.004146058112382889, 0.0013602323597297072,] },

/* 109 */ { startIndex: 124, weights: [0.0014287971425801516, 0.004148248583078384, 0.006867699790745974, 0.006837052758783102, 0.004182394593954086, 0.0015277357306331396,] },

/* 110 */ { startIndex: 127, weights: [0.0013261043932288885, 0.003917513880878687, 0.006508923601359129, 0.006926396861672401, 0.0043967291712760925, 0.0018670617137104273,] },

/* 111 */ { startIndex: 130, weights: [0.0010482777142897248, 0.0035176740493625402, 0.0059870705008506775, 0.007178240455687046, 0.004767679143697023, 0.002357117598876357,] },

/* 112 */ { startIndex: 133, weights: [0.0006163640646263957, 0.0029694922268390656, 0.005322620272636414, 0.007572650909423828, 0.005275587551295757, 0.0029785241931676865, 0.0006814609514549375,] },

/* 113 */ { startIndex: 136, weights: [4.9713995394995436e-05, 0.0022920481860637665, 0.004534382373094559, 0.006776716560125351, 0.0059024072252213955, 0.00371349835768342, 0.0015245892573148012,] },

/* 114 */ { startIndex: 140, weights: [0.0015028533525764942, 0.0036396104842424393, 0.005776367150247097, 0.0066315908916294575, 0.004545743577182293, 0.002459896495565772, 0.00037404923932626843,] },

/* 115 */ { startIndex: 143, weights: [0.0006179586052894592, 0.00265410915017128, 0.004690259229391813, 0.006726410239934921, 0.005460347048938274, 0.0034727093297988176, 0.0014850713778287172,] },

/* 116 */ { startIndex: 147, weights: [0.001592335756868124, 0.0035326166544109583, 0.005472897551953793, 0.0064436825923621655, 0.004549629986286163, 0.002655577613040805, 0.0007615251233801246,] },

/* 117 */ { startIndex: 150, weights: [0.00046749351895414293, 0.0023164190351963043, 0.004165344405919313, 0.0060142697766423225, 0.005678446963429451, 0.0038735736161470413, 0.002068700036033988, 0.0002638266596477479,] },

/* 118 */ { startIndex: 154, weights: [0.0010534910252317786, 0.002815362298861146, 0.0045772334560751915, 0.006339104846119881, 0.0051281568594276905, 0.0034082632046192884, 0.0016883700154721737,] },

/* 119 */ { startIndex: 158, weights: [0.0014335009036585689, 0.0031124167144298553, 0.00479133240878582, 0.00640943692997098, 0.004770522005856037, 0.0031316077802330256, 0.0014926930889487267,] },

/* 120 */ { startIndex: 161, weights: [2.9323589842533693e-05, 0.001629189937375486, 0.003229056019335985, 0.00482892245054245, 0.006146714556962252, 0.004584966227412224, 0.0030232176650315523, 0.0014614691026508808,] },

/* 121 */ { startIndex: 165, weights: [0.00013601698447018862, 0.001660555717535317, 0.003185094567015767, 0.004709633067250252, 0.006040723994374275, 0.0045525087043643, 0.003064292948693037, 0.001576077425852418, 8.786193211562932e-05,] },

/* 122 */ { startIndex: 169, weights: [9.328097075922415e-05, 0.001546038780361414, 0.002998796757310629, 0.004451554734259844, 0.0059043122455477715, 0.0046556610614061356, 0.003237516153603792, 0.0018193712458014488, 0.00040122633799910545,] },

/* 123 */ { startIndex: 174, weights: [0.0013026263331994414, 0.002686982974410057, 0.004071339499205351, 0.005455696024000645, 0.004878324922174215, 0.0035269514191895723, 0.0021755779162049294, 0.0008242045878432691,] },

/* 124 */ { startIndex: 178, weights: [0.0009459502762183547, 0.002265126211568713, 0.0035843022633343935, 0.0049034785479307175, 0.005205697845667601, 0.0039179520681500435, 0.00263020652346313, 0.001342460629530251, 5.471494296216406e-05,] },

/* 125 */ { startIndex: 182, weights: [0.0004903789376839995, 0.0017474433407187462, 0.003004507627338171, 0.004261571913957596, 0.005518636200577021, 0.004397072363644838, 0.0031699584797024727, 0.001942844595760107, 0.0007157306536100805,] },

/* 126 */ { startIndex: 187, weights: [0.0011469805613160133, 0.002344857668504119, 0.0035427347756922245, 0.004740611650049686, 0.0049519846215844154, 0.003782647429034114, 0.002613310469314456, 0.0014439737424254417, 0.0002746368118096143,] },

/* 127 */ { startIndex: 191, weights: [0.0004756950947921723, 0.0016171716852113605, 0.002758648479357362, 0.0039001251570880413, 0.005041601601988077, 0.004457120783627033, 0.003342840587720275, 0.0022285603918135166, 0.0011142801959067583,] },
]

// Recognition options
export interface WhisperOptions {
	model?: WhisperModelName
	temperature?: number
	prompt?: string
	topCandidateCount?: number
	punctuationThreshold?: number
	autoPromptParts?: boolean
	maxTokensPerPart?: number
	suppressRepetition?: boolean
	repetitionThreshold?: number
	decodeTimestampTokens?: boolean
	endTokenThreshold?: number
	includeEndTokenInCandidates?: boolean
	timestampAccuracy?: WhisperTimestampAccuracy,
	encoderProvider?: OnnxExecutionProvider
	decoderProvider?: OnnxExecutionProvider
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
	repetitionThreshold: 2.4,
	decodeTimestampTokens: true,
	endTokenThreshold: 0.9,
	includeEndTokenInCandidates: true,
	timestampAccuracy: undefined,
	encoderProvider: undefined,
	decoderProvider: undefined,
	seed: undefined,
}

// Alignment options
export interface WhisperAlignmentOptions {
	model?: WhisperModelName
	endTokenThreshold?: number
	maxTokensPerPart?: number
	timestampAccuracy?: WhisperTimestampAccuracy,

	encoderProvider?: OnnxExecutionProvider
	decoderProvider?: OnnxExecutionProvider
}

export const defaultWhisperAlignmentOptions: WhisperAlignmentOptions = {
	model: undefined,
	endTokenThreshold: 0.9,
	maxTokensPerPart: 250,
	timestampAccuracy: undefined,

	encoderProvider: undefined,
	decoderProvider: undefined,
}

// Language detection options
export interface WhisperLanguageDetectionOptions {
	model?: WhisperModelName
	temperature?: number
	encoderProvider?: OnnxExecutionProvider
	decoderProvider?: OnnxExecutionProvider
}

export const defaultWhisperLanguageDetectionOptions: WhisperLanguageDetectionOptions = {
	model: undefined,
	temperature: 1.0,
	encoderProvider: undefined,
	decoderProvider: undefined,
}

// Voice activity detection options
export interface WhisperVADOptions {
	model?: WhisperModelName
	temperature?: number
	encoderProvider?: OnnxExecutionProvider
	decoderProvider?: OnnxExecutionProvider
}

export const defaultWhisperVADOptions: WhisperVADOptions = {
	model: undefined,
	temperature: 1.0,
	encoderProvider: undefined,
	decoderProvider: undefined,
}

type WhisperTimestampAccuracy = 'medium' | 'high'
