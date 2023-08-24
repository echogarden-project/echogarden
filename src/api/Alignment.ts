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
import { DtwGranularity } from "../alignment/SpeechAlignment.js"
import { SubtitlesConfig, defaultSubtitlesConfig } from "../subtitles/Subtitles.js"
import { synthesize } from "./API.js"

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

	if (options.dtw!.windowDuration == null) {
		const sourceAudioDuration = getRawAudioDuration(sourceRawAudio)

		if (sourceAudioDuration < 5 * 60) { // If up to 5 minutes, set window to one minute
			options.dtw!.windowDuration = 60
		} else if (sourceAudioDuration < 60 * 60) { // If up to 1 hour, set window to 20% of total duration
			options.dtw!.windowDuration = Math.ceil(sourceAudioDuration * 0.2)
		} else { // If 1 hour or more, set window to 12 minutes
			options.dtw!.windowDuration = 12 * 60
		}
	}

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

	logger.start("Load alignment module")

	const { alignUsingDtwWithRecognition, alignUsingDtw } = await import("../alignment/SpeechAlignment.js")

	async function getAlignmentReference() {
		logger.start("Create alignment reference with eSpeak")

		const synthesisOptions: API.SynthesisOptions = {
			engine: "espeak",
			language,
			plainText: options.plainText,
			customLexiconPaths: options.customLexiconPaths,

			espeak: {
			}
		}

		let { audio: referenceRawAudio,  timeline: segmentTimeline, voice: espeakVoice } = await synthesize(transcript, synthesisOptions)

		const sentenceTimeline = segmentTimeline.flatMap(entry => entry.timeline!)
		const wordTimeline = sentenceTimeline.flatMap(entry => entry.timeline!)

		referenceRawAudio = await resampleAudioSpeex(referenceRawAudio as RawAudio, 16000)
		referenceRawAudio = downmixToMonoAndNormalize(referenceRawAudio)

		return { referenceRawAudio, referenceTimeline: wordTimeline, espeakVoice }
	}

	function getDtwWindowDurationsAndGranularities() {
		let granularities: DtwGranularity[]
		let windowDurations: number[]

		if (typeof options.dtw!.granularity == 'string') {
			granularities = [options.dtw!.granularity]
		} else if (Array.isArray(options.dtw!.granularity)) {
			granularities = options.dtw!.granularity
		} else {
			granularities = ['auto']
		}

		if (typeof options.dtw!.windowDuration == 'number') {
			if (granularities.length == 1) {
				windowDurations = [options.dtw!.windowDuration]
			} else if (granularities.length == 2) {
				windowDurations = [options.dtw!.windowDuration, 15]
			} else {
				throw new Error(`More than two passes requested, this requires window durations to be explicitly specified for each pass. For example 'dtw.windowDuration=[600,60,10]'.`)
			}
		} else if (Array.isArray(options.dtw!.windowDuration)) {
			windowDurations = options.dtw!.windowDuration
		} else {
			throw new Error('No window duration given')
		}

		if (granularities.length != windowDurations.length) {
			throw new Error(`Unequal element counts in options. 'dtw.granularity' has ${granularities.length} items, but 'dtw.windowDuration' has ${windowDurations.length} items. Can't infer what number of DTW passes were intended.`)
		}

		return { windowDurations, granularities }
	}

	let mappedTimeline: Timeline

	switch (options.engine) {
		case "dtw": {
			const { referenceRawAudio, referenceTimeline } = await getAlignmentReference()
			logger.end()

			const { windowDurations, granularities } = getDtwWindowDurationsAndGranularities()

			mappedTimeline = await alignUsingDtw(sourceRawAudio, referenceRawAudio, referenceTimeline, windowDurations, granularities)

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

			const { referenceRawAudio, referenceTimeline, espeakVoice } = await getAlignmentReference()

			logger.end()

			const phoneAlignmentMethod = options.dtw!.phoneAlignmentMethod!

			const { windowDurations, granularities } = getDtwWindowDurationsAndGranularities()

			mappedTimeline = await alignUsingDtwWithRecognition(sourceRawAudio, referenceRawAudio, referenceTimeline, recognitionTimeline, espeakVoice, phoneAlignmentMethod, windowDurations, granularities)

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

export interface AlignmentResult {
	timeline: Timeline
	wordTimeline: Timeline
	transcript: string
	language: string
	inputRawAudio: RawAudio
}

export type AlignmentEngine = "dtw" | "dtw-ra" | "whisper"
export type PhoneAlignmentMethod = "interpolation" | "dtw"

export interface AlignmentOptions {
	engine?: AlignmentEngine

	language?: string

	languageDetection?: API.TextLanguageDetectionOptions

	customLexiconPaths?: string[]

	plainText?: API.PlainTextOptions

	subtitles?: SubtitlesConfig

	dtw?: {
		granularity?: DtwGranularity | DtwGranularity[]
		windowDuration?: number | number[]
		phoneAlignmentMethod?: PhoneAlignmentMethod
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
		granularity: 'auto',
		windowDuration: undefined,
		phoneAlignmentMethod: 'dtw'
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
