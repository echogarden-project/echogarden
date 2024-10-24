import { extendDeep } from '../utilities/ObjectUtilities.js'

import { logToStderr } from '../utilities/Utilities.js'
import { AudioSourceParam, RawAudio, ensureRawAudio, getRawAudioDuration, normalizeAudioLevelInPlace, trimAudioEnd } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'

import * as API from './API.js'
import { Timeline, addTimeOffsetToTimeline, addWordTextOffsetsToTimeline, wordTimelineToSegmentSentenceTimeline } from '../utilities/Timeline.js'
import { formatLanguageCodeWithName, getDefaultDialectForLanguageCodeIfPossible, getShortLanguageCode, parseLangIdentifier } from '../utilities/Locale.js'
import { type WhisperAlignmentOptions } from '../recognition/WhisperSTT.js'
import chalk from 'chalk'
import { DtwGranularity, alignUsingDtwWithEmbeddings, createAlignmentReferenceUsingEspeak } from '../alignment/SpeechAlignment.js'
import { type SubtitlesConfig } from '../subtitles/Subtitles.js'
import { type EspeakOptions, defaultEspeakOptions } from '../synthesis/EspeakTTS.js'
import { isWord } from '../nlp/Segmentation.js'

const log = logToStderr

export async function align(input: AudioSourceParam, transcript: string, options: AlignmentOptions): Promise<AlignmentResult> {
	const logger = new Logger()

	const startTimestamp = logger.getTimestamp()

	options = extendDeep(defaultAlignmentOptions, options)

	const inputRawAudio = await ensureRawAudio(input)

	let sourceRawAudio: RawAudio
	let isolatedRawAudio: RawAudio | undefined
	let backgroundRawAudio: RawAudio | undefined

	if (options.isolate) {
		logger.log(``)
		logger.end();

		({ isolatedRawAudio, backgroundRawAudio } = await API.isolate(inputRawAudio, options.sourceSeparation!))

		logger.end()
		logger.log(``)

		logger.start(`Resample audio to 16kHz mono`)
		sourceRawAudio = await ensureRawAudio(isolatedRawAudio, 16000, 1)
	} else {
		logger.start(`Resample audio to 16kHz mono`)
		sourceRawAudio = await ensureRawAudio(inputRawAudio, 16000, 1)
	}

	let sourceUncropTimeline: Timeline | undefined

	if (options.crop) {
		logger.start('Crop using voice activity detection');
		({ timeline: sourceUncropTimeline, croppedRawAudio: sourceRawAudio } = await API.detectVoiceActivity(sourceRawAudio, options.vad!))

		logger.end()
	}

	logger.start('Normalize and trim audio')

	normalizeAudioLevelInPlace(sourceRawAudio)
	sourceRawAudio.audioChannels[0] = trimAudioEnd(sourceRawAudio.audioChannels[0])

	logger.end()

	let language: string

	if (options.language) {
		const languageData = await parseLangIdentifier(options.language)

		language = languageData.Name

		logger.logTitledMessage('Language specified', formatLanguageCodeWithName(language))
	} else {
		logger.start('No language specified. Detect language using reference text')
		const { detectedLanguage } = await API.detectTextLanguage(transcript, options.languageDetection || {})

		language = detectedLanguage

		logger.end()

		logger.logTitledMessage('Language detected', formatLanguageCodeWithName(language))
	}

	language = getDefaultDialectForLanguageCodeIfPossible(language)

	logger.start('Load alignment module')

	const { alignUsingDtwWithRecognition, alignUsingDtw } = await import('../alignment/SpeechAlignment.js')

	function getDtwWindowGranularitiesAndDurations() {
		const sourceAudioDuration = getRawAudioDuration(sourceRawAudio)

		let granularities: DtwGranularity[]
		let windowDurations: number[]

		const dtwOptions = options.dtw!

		if (typeof dtwOptions.granularity == 'string') {
			granularities = [dtwOptions.granularity]
		} else if (Array.isArray(dtwOptions.granularity)) {
			granularities = dtwOptions.granularity
		} else {
			if (sourceAudioDuration < 1 * 60) {
				// If up to 1 minute, set granularity to high, single pass
				granularities = ['high']
			} else if (sourceAudioDuration < 5 * 60) {
				// If up to 5 minutes, set granularity to medium, single pass
				granularities = ['medium']
			} else if (sourceAudioDuration < 30 * 60) {
				// If up to 30 minutes, set granularity to low, single pass
				granularities = ['low']
			} else {
				// Otherwise, use multipass processing, first with xx-low granularity, then low
				granularities = ['xx-low', 'low']
			}
		}

		if (dtwOptions.windowDuration) {
			function tryParsePercentageWindowDuration(durationString: string) {
				durationString = durationString.trim()

				const parseResult = durationString.match(/^([0-9]+)%$/)

				if (parseResult == null) {
					throw new Error(`A DTW window duration, when provided as a string, must be formatted as an integer percentage value like '15%'.`)
				}

				const percentageValue = parseInt(parseResult[1])

				if (percentageValue == null || isNaN(percentageValue) || percentageValue <= 0 || percentageValue > 100) {
					throw new Error(`'A DTW window duration, when provided as a percentage value, must be between 0 (non-inclusive) and 100 (inclusive).`)
				}

				let durationSeconds = percentageValue / 100 * sourceAudioDuration
				durationSeconds = Math.ceil(durationSeconds)
				durationSeconds = Math.min(durationSeconds, sourceAudioDuration)

				return durationSeconds
			}

			if (typeof dtwOptions.windowDuration === 'number') {
				const duration = Math.min(dtwOptions.windowDuration, sourceAudioDuration)

				windowDurations = [duration]
			} else if (typeof dtwOptions.windowDuration === 'string') {
				const durationString = dtwOptions.windowDuration.trim()

				const durationSeconds = tryParsePercentageWindowDuration(durationString)

				windowDurations = [durationSeconds]
			} else if (Array.isArray(dtwOptions.windowDuration)) {
				const durationsValues = dtwOptions.windowDuration

				if (durationsValues.length < 1) {
					throw new Error(`DTW window durations, when given as an array, must have at least one element.`)
				}

				const durations: number[] = []

				for (const durationValue of durationsValues) {
					let durationSeconds: number

					if (typeof durationValue === 'number') {
						durationSeconds = durationValue
						durationSeconds = Math.min(durationSeconds, sourceAudioDuration)
					} else {
						durationSeconds = tryParsePercentageWindowDuration(durationValue)
					}

					durations.push(durationSeconds)
				}

				windowDurations = durations
			} else {
				throw new Error(`'dtw.windowDuration' must be a number or a percentage string, or array of numbers / percentage strings.`)
			}
		} else {
			if (granularities.length > 2) {
				throw new Error(`More than two passes requested, this requires window durations to be explicitly specified for each pass. For example 'dtw.windowDuration=['20%',60,10]'.`)
			}

			if (sourceAudioDuration < 5 * 60) {
				// If up to 5 minutes, set window duration to one minute
				windowDurations = [60]
			} else if (sourceAudioDuration < 2.5 * 60 * 60) {
				// If less than 2.5 hours, set window duration to 20% of total duration
				windowDurations = [Math.ceil(sourceAudioDuration * 0.2)]
			} else {
				// Otherwise, set window duration to 30 minutes
				windowDurations = [30 * 60]
			}
		}

		if (granularities.length === 2 && windowDurations.length === 1) {
			windowDurations = [windowDurations[0], 15]
		}

		if (granularities.length != windowDurations.length) {
			throw new Error(`The option 'dtw.granularity' has ${granularities.length} values, but 'dtw.windowDuration' has ${windowDurations.length} values. The lengths should be equal.`)
		}

		return { windowDurations, granularities }
	}

	let mappedTimeline: Timeline

	switch (options.engine) {
		case 'dtw': {
			const { windowDurations, granularities } = getDtwWindowGranularitiesAndDurations()

			logger.end()

			const {
				referenceRawAudio,
				referenceTimeline
			} = await createAlignmentReferenceUsingEspeak(transcript, language, options.plainText, options.customLexiconPaths, false, false)

			logger.end()

			mappedTimeline = await alignUsingDtw(sourceRawAudio, referenceRawAudio, referenceTimeline, granularities, windowDurations)

			break
		}

		case 'dtw-ra': {
			const { windowDurations, granularities } = getDtwWindowGranularitiesAndDurations()

			logger.end()

			const recognitionOptions: API.RecognitionOptions =
				extendDeep({ crop: options.crop, language }, options.recognition)

			// Recognize source audio
			let { wordTimeline: recognitionTimeline } = await API.recognize(sourceRawAudio, recognitionOptions)

			logger.log('')

			// Remove non-word entries from recognition timeline
			recognitionTimeline = recognitionTimeline.filter(entry => isWord(entry.text))

			// Synthesize the ground-truth transcript and get its timeline
			logger.start('Synthesize ground-truth transcript with eSpeak')

			const {
				referenceRawAudio,
				referenceTimeline,
				espeakVoice,
			} = await createAlignmentReferenceUsingEspeak(transcript, language, options.plainText, options.customLexiconPaths, false, false)

			logger.end()

			const phoneAlignmentMethod = options.dtw!.phoneAlignmentMethod!

			const espeakOptions: EspeakOptions = {
				...defaultEspeakOptions,
				voice: espeakVoice,
				useKlatt: false,
				insertSeparators: true
			}

			// Align the ground-truth transcript and the recognized transcript
			mappedTimeline = await alignUsingDtwWithRecognition(
				sourceRawAudio,
				referenceRawAudio,
				referenceTimeline,

				recognitionTimeline,

				granularities,
				windowDurations,
				espeakOptions,
				phoneAlignmentMethod)

			break
		}

		case 'dtw-ea': {
			const { windowDurations, granularities } = getDtwWindowGranularitiesAndDurations()

			logger.end()

			logger.logTitledMessage(`Warning`, `The dtw-ea alignment engine is just an early experiment and doesn't currently perform as well as, or as efficiently as other alignment engines.`, chalk.yellow, 'warning')

			const {
				referenceRawAudio,
				referenceTimeline
			} = await createAlignmentReferenceUsingEspeak(transcript, language, options.plainText, options.customLexiconPaths, false, true)

			logger.end()

			const shortLanguageCode = getShortLanguageCode(language)

			mappedTimeline = await alignUsingDtwWithEmbeddings(
				sourceRawAudio,
				referenceRawAudio,
				referenceTimeline,
				shortLanguageCode,
				granularities,
				windowDurations)

			break
		}

		case 'whisper': {
			const WhisperSTT = await import('../recognition/WhisperSTT.js')

			const whisperAlignmnentOptions = options.whisper!

			const shortLanguageCode = getShortLanguageCode(language)

			const { modelName, modelDir } = await WhisperSTT.loadPackagesAndGetPaths(whisperAlignmnentOptions.model, shortLanguageCode)

			logger.end()

			mappedTimeline = await WhisperSTT.align(sourceRawAudio, transcript, modelName, modelDir, shortLanguageCode, whisperAlignmnentOptions)

			break
		}

		default: {
			throw new Error(`Engine '${options.engine}' is not supported`)
		}
	}

	logger.start(`Postprocess timeline`)

	// If the audio was cropped before recognition, map the timestamps back to the original audio
	if (sourceUncropTimeline && sourceUncropTimeline.length > 0) {
		API.convertCroppedToUncroppedTimeline(mappedTimeline, sourceUncropTimeline)
	}

	// Add text offsets
	addWordTextOffsetsToTimeline(mappedTimeline, transcript)

	// Make segment timeline
	const { segmentTimeline } = await wordTimelineToSegmentSentenceTimeline(mappedTimeline, transcript, language, options.plainText?.paragraphBreaks, options.plainText?.whitespace)

	logger.end()
	logger.logDuration(`Total alignment time`, startTimestamp, chalk.magentaBright)

	return {
		timeline: segmentTimeline,
		wordTimeline: mappedTimeline,

		transcript,
		language,

		inputRawAudio,
		isolatedRawAudio,
		backgroundRawAudio,
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
	isolatedRawAudio?: RawAudio
	backgroundRawAudio?: RawAudio
}

export type AlignmentEngine = 'dtw' | 'dtw-ra' | 'dtw-ea' | 'whisper'
export type PhoneAlignmentMethod = 'interpolation' | 'dtw'

export interface AlignmentOptions {
	engine?: AlignmentEngine

	language?: string

	isolate?: boolean

	crop?: boolean

	customLexiconPaths?: string[]

	languageDetection?: API.TextLanguageDetectionOptions

	vad?: API.VADOptions

	plainText?: API.PlainTextOptions

	subtitles?: SubtitlesConfig

	dtw?: {
		granularity?: DtwGranularity | DtwGranularity[]
		windowDuration?: number | string | (string | number)[]
		phoneAlignmentMethod?: PhoneAlignmentMethod
	}

	recognition?: API.RecognitionOptions

	sourceSeparation?: API.SourceSeparationOptions

	whisper?: WhisperAlignmentOptions
}

export const defaultAlignmentOptions: AlignmentOptions = {
	engine: 'dtw',

	language: undefined,

	isolate: false,

	crop: true,

	customLexiconPaths: undefined,

	languageDetection: {
	},

	plainText: {
		paragraphBreaks: 'double',
		whitespace: 'collapse'
	},

	subtitles: {
	},

	dtw: {
		granularity: undefined,
		windowDuration: undefined,
		phoneAlignmentMethod: 'dtw'
	},

	recognition: {
		whisper: {
			temperature: 0.15,
			topCandidateCount: 5,
			punctuationThreshold: 0.2,
			maxTokensPerPart: 250,
			autoPromptParts: false,
			suppressRepetition: true,
			decodeTimestampTokens: true,
		}
	},

	vad: {
		engine: 'adaptive-gate'
	},

	sourceSeparation: {
	},

	whisper: {
	}
}

export const alignmentEngines: API.EngineMetadata[] = [
	{
		id: 'dtw',
		name: 'Dynamic Time Warping',
		description: 'Makes use of a synthesized reference to find the best mapping between the spoken audio and its transcript.',
		type: 'local'
	},
	{
		id: 'dtw-ra',
		name: 'Dynamic Time Warping with Recognition Assist',
		description: 'Makes use of both a synthesized reference and a synthsized recognized transcript to find the best mapping between the spoken audio and its transcript.',
		type: 'local'
	},
	{
		id: 'whisper',
		name: 'OpenAI Whisper',
		description: 'Extracts timestamps by guiding the Whisper recognition model to recognize the transcript tokens.',
		type: 'local'
	}
]
