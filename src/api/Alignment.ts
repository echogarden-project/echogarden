import { extendDeep } from "../utilities/ObjectUtilities.js"

import { logToStderr } from "../utilities/Utilities.js"
import { AudioSourceParam, RawAudio, downmixToMonoAndNormalize, ensureRawAudio, getRawAudioDuration, normalizeAudioLevel, trimAudioEnd } from "../audio/AudioUtilities.js"
import { Logger } from "../utilities/Logger.js"
import { resampleAudioSpeex } from "../dsp/SpeexResampler.js"

import * as API from "./API.js"
import { Timeline, addTimeOffsetToTimeline, addWordTextOffsetsToTimeline, wordTimelineToSegmentSentenceTimeline } from "../utilities/Timeline.js"
import { formatLanguageCodeWithName, getDefaultDialectForLanguageCodeIfPossible, getShortLanguageCode, normalizeLanguageCode } from "../utilities/Locale.js"
import { WhisperOptions, whisperOptionsDefaults } from "../recognition/WhisperSTT.js"
import chalk from "chalk"
import { createAlignmentReferenceUsingEspeakPreprocessed } from "../alignment/SpeechAlignment.js"
import { loadLexiconsForLanguage } from "../nlp/Lexicon.js"
import { SubtitlesConfig, defaultSubtitlesConfig } from "../subtitles/Subtitles.js"
import { type MfccOptions } from "../dsp/MFCC.js"

const log = logToStderr

export async function align(input: AudioSourceParam, transcript: string, options: AlignmentOptions): Promise<AlignmentResult> {
	const logger = new Logger()
	const startTimestamp = logger.getTimestamp()

	logger.start("Prepare for alignment")

	const inputRawAudio = await ensureRawAudio(input)

	let sourceRawAudio = await ensureRawAudio(inputRawAudio, 16000, 1)
	sourceRawAudio = normalizeAudioLevel(sourceRawAudio)
	sourceRawAudio.audioChannels[0] = trimAudioEnd(sourceRawAudio.audioChannels[0], 0, -40)

	options = extendDeep(defaultAlignmentOptions, options)

	const dtwWindowDuration = options.dtw!.windowDuration!

	let language: string

	if (options.language) {
		language = normalizeLanguageCode(options.language!)
	} else {
		logger.start("No language specified. Detecting language")
		const { detectedLanguage } = await API.detectTextLanguage(transcript, options.languageDetection || {})
		language = detectedLanguage

		logger.end()
		logger.logTitledMessage('Language detected', formatLanguageCodeWithName(detectedLanguage))
	}

	language = getDefaultDialectForLanguageCodeIfPossible(language)

	logger.start("Get espeak voice list and select best matching voice")
	const { bestMatchingVoice } = await API.requestVoiceList({ engine: "espeak", language })

	if (!bestMatchingVoice) {
		throw new Error("No matching voice found")
	}

	const espeakVoice = bestMatchingVoice.name

	logger.end()
	logger.logTitledMessage('Selected voice', `'${espeakVoice}' (${formatLanguageCodeWithName(bestMatchingVoice.languages[0], 2)})`)

	logger.start("Load alignment module")

	const { alignUsingDtwWithRecognition, alignUsingDtw } = await import("../alignment/SpeechAlignment.js")

	async function getAlignmentReference() {
		logger.start("Create alignment reference with eSpeak")

		const espeakLanguage = bestMatchingVoice.languages[0]
		const lexicons = await loadLexiconsForLanguage(espeakLanguage, options.customLexiconPaths)

		let { rawAudio: referenceRawAudio, timeline: referenceTimeline } = await createAlignmentReferenceUsingEspeakPreprocessed(transcript, espeakLanguage, espeakVoice, lexicons)

		referenceRawAudio = await resampleAudioSpeex(referenceRawAudio, 16000)
		referenceRawAudio = downmixToMonoAndNormalize(referenceRawAudio)

		return { referenceRawAudio, referenceTimeline }
	}

	let mappedTimeline: Timeline

	switch (options.engine) {
		case "dtw": {
			const { referenceRawAudio, referenceTimeline } = await getAlignmentReference()
			logger.end()

			const mfccOptions = getMfccOptionsForGranularity(options.dtw!.granularity!)

			mappedTimeline = await alignUsingDtw(sourceRawAudio, referenceRawAudio, referenceTimeline, dtwWindowDuration, mfccOptions)

			break
		}

		case "dtw-ra": {
			/*
			const promptWords = (await splitToWords(prompt, language)).filter(word => isWord(word))

			shuffleArrayInPlace(promptWords, this.randomGen)
			//promptWords.reverse()

			prompt = promptWords.join(" ")
			*/

			const recognitionOptionsDefaults: API.RecognitionOptions = {
				engine: "whisper",
				language,
			}

			const recognitionOptions: API.RecognitionOptions = extendDeep(recognitionOptionsDefaults, options.recognition || {})

			logger.end()

			const { wordTimeline: recognitionTimeline } = await API.recognize(sourceRawAudio, recognitionOptions)

			const { referenceRawAudio, referenceTimeline } = await getAlignmentReference()

			logger.end()

			const phoneAlignmentMethod = options.dtw!.phoneAlignmentMethod!

			const mfccOptions = getMfccOptionsForGranularity(options.dtw!.granularity!)

			mappedTimeline = await alignUsingDtwWithRecognition(sourceRawAudio, referenceRawAudio, referenceTimeline, recognitionTimeline, espeakVoice, phoneAlignmentMethod, dtwWindowDuration, mfccOptions)

			break
		}

		case "whisper": {
			const WhisperSTT = await import("../recognition/WhisperSTT.js")

			const whisperOptions = options.whisper!

			const shortLanguageCode = getShortLanguageCode(language)

			const { modelName, modelDir, tokenizerDir } = await WhisperSTT.loadPackagesAndGetPaths(whisperOptions.model, language)

			if (modelName.endsWith(".en") && shortLanguageCode != "en") {
				throw new Error(`The model '${modelName}' is English only and cannot transcribe language '${shortLanguageCode}'`)
			}

			if (getRawAudioDuration(sourceRawAudio) > 30) {
				throw new Error("Whisper based alignment currently only supports audio inputs that are 30s or less")
			}

			logger.end()

			mappedTimeline = await WhisperSTT.align(sourceRawAudio, transcript, modelName, modelDir, tokenizerDir, shortLanguageCode)

			break
		}

		default: {
			throw new Error(`Engine '${options.engine}' is not supported`)
		}
	}

	addWordTextOffsetsToTimeline(mappedTimeline, transcript)

	const { segmentTimeline } = await wordTimelineToSegmentSentenceTimeline(mappedTimeline, transcript, language, options.plainText?.paragraphBreaks, options.plainText?.whitespace)

	logger.end()
	logger.logDuration(`Total alignment time`, startTimestamp, chalk.magentaBright)

	return {
		timeline: segmentTimeline,
		wordTimeline: mappedTimeline,
		inputRawAudio,
		transcript,
		language
	}
}

export async function alignSegments(sourceRawAudio: RawAudio, segmentTimeline: Timeline, alignmentOptions: AlignmentOptions) {
	const timeline: Timeline = []

	for (const segmentEntry of segmentTimeline) {
		const segmentText = segmentEntry.text

		const segmentStartTime = segmentEntry.startTime
		const segmentEndTime = segmentEntry.endTime

		const segmentStartSampleIndex = Math.floor(segmentStartTime * sourceRawAudio.sampleRate)
		const segmentEndSampleIndex = Math.floor(segmentEndTime * sourceRawAudio.sampleRate)

		const segmentAudioSamples = sourceRawAudio.audioChannels[0].slice(segmentStartSampleIndex, segmentEndSampleIndex)
		const segmentRawAudio: RawAudio = {
			audioChannels: [segmentAudioSamples],
			sampleRate: sourceRawAudio.sampleRate
		}

		const { wordTimeline: mappedTimeline } = await align(segmentRawAudio, segmentText, alignmentOptions)

		const segmentTimelineWithOffset = addTimeOffsetToTimeline(mappedTimeline, segmentStartTime)

		timeline.push(...segmentTimelineWithOffset)
	}

	return timeline
}

function getMfccOptionsForGranularity(granularity: DtwGranularity) {
	let result: MfccOptions

	if (granularity == 'high') {
		result = { windowDuration: 0.025, hopDuration: 0.010, fftOrder: 512 }
	} else if (granularity == 'medium') {
		result = { windowDuration: 0.050, hopDuration: 0.025, fftOrder: 1024 }
	} else if (granularity == 'low') {
		result = { windowDuration: 0.100, hopDuration: 0.050, fftOrder: 2048 }
	} else {
		throw new Error(`Invalid granularity setting: '${granularity}'`)
	}

	return result
}

export interface AlignmentResult {
	timeline: Timeline
	wordTimeline: Timeline
	transcript: string
	language: string
	inputRawAudio: RawAudio
}

export type AlignmentEngine = "dtw" | "dtw-ra" | "whisper"
export type PhoneAlignmentMethod = "interpolation" | "dtw"
export type DtwGranularity = 'high' | 'medium' | 'low'

export interface AlignmentOptions {
	engine?: AlignmentEngine

	language?: string

	languageDetection?: API.TextLanguageDetectionOptions

	customLexiconPaths?: string[]

	plainText?: API.PlainTextOptions

	subtitles?: SubtitlesConfig

	dtw?: {
		windowDuration?: number,
		phoneAlignmentMethod?: PhoneAlignmentMethod,
		granularity: DtwGranularity
	}

	recognition?: API.RecognitionOptions

	whisper?: WhisperOptions
}

export const defaultAlignmentOptions: AlignmentOptions = {
	engine: "dtw",

	language: undefined,

	languageDetection: {
	},

	customLexiconPaths: undefined,

	plainText: {
		paragraphBreaks: 'double',
		whitespace: 'collapse'
	},

	subtitles: defaultSubtitlesConfig,

	dtw: {
		windowDuration: 120,
		phoneAlignmentMethod: 'dtw',
		granularity: 'high'
	},

	recognition: {
	},

	whisper: whisperOptionsDefaults
}

export const alignmentEngines: API.EngineMetadata[] = [
	{
		id: 'dtw',
		name: 'Dynamic Time Warping',
		description: 'Makes use of synthesis to find the best mapping between the original audio and its transcript.',
		type: 'local'
	},
	{
		id: 'dtw-ra',
		name: 'Dynamic Time Warping with Recognition Assist',
		description: 'Makes use of both synthesis and recognition to find the best mapping between the original audio and its transcript.',
		type: 'local'
	},
	{
		id: 'whisper',
		name: 'OpenAI Whisper',
		description: 'Extracts timestamps from the internal state of the Whisper recognition model (note: currently limited to a maximum of 30s audio length).',
		type: 'local'
	}
]
