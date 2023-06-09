import { extendDeep } from "../utilities/ObjectUtilities.js"

import * as FFMpegTranscoder from "../codecs/FFMpegTranscoder.js"

import { logToStderr } from "../utilities/Utilities.js"
import { RawAudio, downmixToMonoAndNormalize, getRawAudioDuration } from "../audio/AudioUtilities.js"
import { Logger } from "../utilities/Logger.js"
import { resampleAudioSpeex } from "../dsp/SpeexResampler.js"

import * as API from "./API.js"
import { Timeline, addTimeOffsetToTimeline } from "../utilities/Timeline.js"
import { formatLanguageCodeWithName, getShortLanguageCode, normalizeLanguageCode } from "../utilities/Locale.js"
import { WhisperModelName } from "../recognition/WhisperSTT.js"

const log = logToStderr

export async function alignFile(audioFilename: string, text: string, options: AlignmentOptions) {
	const rawAudio = await FFMpegTranscoder.decodeToChannels(audioFilename)

	return align(rawAudio, text, options)
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

export async function align(inputRawAudio: RawAudio, transcript: string, options: AlignmentOptions): Promise<AlignmentResult> {
	const logger = new Logger()

	const startTimestamp = logger.getTimestamp()
	logger.start("Prepare for alignment")

	options = extendDeep(defaultAlignmentOptions, options)

	let sourceRawAudio = downmixToMonoAndNormalize(inputRawAudio)
	sourceRawAudio = await resampleAudioSpeex(sourceRawAudio, 16000)

	let language: string

	if (options.language) {
		language = normalizeLanguageCode(options.language!)

		if (language == 'en') {
			language = 'en-us'
		}
	} else {
		logger.start("No language specified. Detecting language")
		const { detectedLanguage } = await API.detectTextLanguage(transcript, {})
		language = detectedLanguage

		logger.end()
		logger.log(`Language detected: ${formatLanguageCodeWithName(detectedLanguage)}`)
	}

	logger.start("Get espeak voice list and select best matching voice")
	const { bestMatchingVoice } = await API.requestVoiceList({ engine: "espeak", language })

	if (!bestMatchingVoice) {
		throw new Error("No matching voice found")
	}

	const espeakVoice = bestMatchingVoice.name
	const dtwWindowDuration = options.dtw!.windowDuration!

	logger.start("Load alignment module")

	const { alignUsingDtwWithRecognition: alignUsingDtwWithRecognitionAssist, createAlignmentReferenceUsingEspeak, alignUsingDtw } = await import("../alignment/SpeechAlignment.js")

	async function getAlignmentReference() {
		logger.start("Create alignment reference with eSpeak")
		let { rawAudio: referenceRawAudio, timeline: referenceTimeline } = await createAlignmentReferenceUsingEspeak(transcript, language, espeakVoice, true)

		referenceRawAudio = await resampleAudioSpeex(referenceRawAudio, 16000)
		referenceRawAudio = downmixToMonoAndNormalize(referenceRawAudio)

		return { referenceRawAudio, referenceTimeline }
	}

	let mappedTimeline: Timeline

	switch (options.engine) {
		case "dtw": {
			const { referenceRawAudio, referenceTimeline } = await getAlignmentReference()
			logger.end()

			mappedTimeline = await alignUsingDtw(sourceRawAudio, referenceRawAudio, referenceTimeline, dtwWindowDuration)

			break
		}

		case "dtw-ra": {
			const recognitionOptionsDefaults: API.RecognitionOptions = {
				engine: "whisper",
				language,
			}

			const engineOptions = options.dtw!

			const recognitionOptions: API.RecognitionOptions = extendDeep(recognitionOptionsDefaults, engineOptions.recognition)

			logger.end()

			const { timeline: recognitionTimeline } = await API.recognize(sourceRawAudio, recognitionOptions)

			const { referenceRawAudio, referenceTimeline } = await getAlignmentReference()

			logger.end()

			const phoneAlignmentMethod = options.dtw!.phoneAlignmentMethod!

			mappedTimeline = await alignUsingDtwWithRecognitionAssist(sourceRawAudio, referenceRawAudio, referenceTimeline, recognitionTimeline, espeakVoice, phoneAlignmentMethod, dtwWindowDuration)

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

	logger.end()
	logger.logDuration(`Total alignment time`, startTimestamp)

	return {
		wordTimeline: mappedTimeline,
		rawAudio: inputRawAudio,
		transcript,
		language
	}
}

export interface AlignmentResult {
	wordTimeline: Timeline,
	rawAudio: RawAudio,
	transcript: string
	language: string
}

export type AlignmentEngine = "dtw" | "dtw-ra" | "whisper"
export type PhoneAlignmentMethod = "interpolation" | "dtw"

export interface AlignmentOptions {
	engine?: AlignmentEngine

	language?: string

	dtw?: {
		windowDuration?: number,
		recognition?: API.RecognitionOptions
		phoneAlignmentMethod?: PhoneAlignmentMethod,
	}

	whisper?: {
		model?: WhisperModelName
	}
}

export const defaultAlignmentOptions: AlignmentOptions = {
	engine: "dtw",

	language: undefined,

	dtw: {
		windowDuration: 120,
		recognition: undefined,
		phoneAlignmentMethod: "dtw",
	},

	whisper: {
		model: undefined
	}
}
