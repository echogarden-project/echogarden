import { clip } from '../utilities/Utilities.js'

import * as API from '../api/API.js'

import { computeMFCCs, extendDefaultMfccOptions, MfccOptions } from '../dsp/MFCC.js'
import { alignMFCC_DTW, getCostMatrixMemorySizeMB } from './DTWMfccSequenceAlignment.js'
import { Logger } from '../utilities/Logger.js'
import { Timeline, TimelineEntry } from '../utilities/Timeline.js'
import { downmixToMonoAndNormalize, getEndingSilentSampleCount, getRawAudioDuration, getStartingSilentSampleCount, RawAudio } from '../audio/AudioUtilities.js'
import chalk from 'chalk'
import { synthesize } from '../api/API.js'
import { resampleAudioSpeex } from '../dsp/SpeexResampler.js'
import { deepClone } from '../utilities/ObjectUtilities.js'
import { zeroIfNaN } from '../math/VectorMath.js'

export async function alignUsingDtw(
	sourceRawAudio: RawAudio,
	referenceRawAudio: RawAudio,
	referenceTimeline: Timeline,
	granularities: DtwGranularity[],
	windowDurations: number[]) {

	const logger = new Logger()

	if (windowDurations.length == 0) {
		throw new Error(`Window durations array has length 0.`)
	}

	if (windowDurations.length != granularities.length) {
		throw new Error(`Window durations and granularities are not the same length.`)
	}

	const rawAudioDuration = getRawAudioDuration(sourceRawAudio)

	let framesPerSecond: number
	let compactedPath: CompactedPath
	let relativeCenters: number[] | undefined

	for (let passIndex = 0; passIndex < windowDurations.length; passIndex++) {
		const windowDuration = windowDurations[passIndex]
		const granularity = resolveAutoGranularityIfNeeded(granularities[passIndex], rawAudioDuration)

		logger.logTitledMessage(`\nStarting alignment pass ${passIndex + 1}/${windowDurations.length}`, `max window duration: ${windowDuration}s, granularity: ${granularity}`, chalk.magentaBright)

		const mfccOptions = extendDefaultMfccOptions({ ...getMfccOptionsForGranularity(granularity, rawAudioDuration), zeroFirstCoefficient: true }) as MfccOptions

		framesPerSecond = 1 / mfccOptions.hopDuration!

		// Compute reference MFCCs
		logger.start('Compute reference MFCC features')
		const referenceMfccs = await computeMFCCs(referenceRawAudio, mfccOptions)

		// Compute source MFCCs
		logger.start('Compute source MFCC features')
		const sourceMfccs = await computeMFCCs(sourceRawAudio, mfccOptions)
		logger.end()

		// Compute path
		logger.logTitledMessage(`DTW cost matrix memory size`, `${getCostMatrixMemorySizeMB(referenceMfccs.length, sourceMfccs.length, windowDuration * framesPerSecond).toFixed(1)}MB`)

		if (passIndex == 0) {
			const minRecommendedWindowDuration = 0.2 * rawAudioDuration

			if (windowDuration < minRecommendedWindowDuration) {
				logger.logTitledMessage('Warning', `Maximum DTW window duration is set to ${windowDuration.toFixed(1)}s, which is smaller than 20% of the source audio duration of ${rawAudioDuration.toFixed(1)}s. This may lead to suboptimal results in some cases. Consider increasing window duration if needed.`, chalk.yellowBright)
			}
		}

		logger.start('Align MFCC features using DTW')
		const dtwWindowLength = Math.floor(windowDuration * framesPerSecond)

		let centerIndexes: number[] | undefined

		if (relativeCenters) {
			centerIndexes = []

			for (let i = 0; i < referenceMfccs.length; i++) {
				const relativeReferencePosition = i / referenceMfccs.length

				const relativeCenterIndex = Math.floor(relativeReferencePosition * relativeCenters!.length)
				const relativeCenter = relativeCenters[relativeCenterIndex]
				const centerIndex = Math.floor(relativeCenter * sourceMfccs.length)

				centerIndexes.push(centerIndex)
			}
		}

		const rawPath = await alignMFCC_DTW(referenceMfccs, sourceMfccs, dtwWindowLength, undefined, centerIndexes)

		compactedPath = compactPath(rawPath)

		relativeCenters = compactedPath.map(entry => (entry.first + entry.last) / 2 / sourceMfccs.length)

		logger.end()
	}

	logger.start('\nConvert path to timeline')

	function getMappedTimelineEntry(timelineEntry: TimelineEntry, recurse = true): TimelineEntry {
		const referenceStartFrameIndex = Math.floor(timelineEntry.startTime * framesPerSecond)
		const referenceEndFrameIndex = Math.floor(timelineEntry.endTime * framesPerSecond)

		if (referenceStartFrameIndex < 0 || referenceEndFrameIndex < 0) {
			throw new Error('Unexpected: encountered a negative timestamp in timeline')
		}

		const mappedStartFrameIndex = getMappedFrameIndexForPath(referenceStartFrameIndex, compactedPath, 'first')
		const mappedEndFrameIndex = getMappedFrameIndexForPath(referenceEndFrameIndex, compactedPath, 'first')

		let innerTimeline: Timeline | undefined

		if (recurse && timelineEntry.timeline != null) {
			innerTimeline = timelineEntry.timeline.map((entry) => getMappedTimelineEntry(entry))
		}

		// Trim silent samples from start and end of mapped entry range
		const sourceSamplesPerFrame = Math.floor(sourceRawAudio.sampleRate / framesPerSecond)

		let startSampleIndex = mappedStartFrameIndex * sourceSamplesPerFrame
		let endSampleIndex = mappedEndFrameIndex * sourceSamplesPerFrame

		const frameSamples = sourceRawAudio.audioChannels[0].subarray(startSampleIndex, endSampleIndex)

		const silenceThresholdDecibels = -40

		startSampleIndex += getStartingSilentSampleCount(frameSamples, silenceThresholdDecibels)
		endSampleIndex -= getEndingSilentSampleCount(frameSamples, silenceThresholdDecibels)

		endSampleIndex = Math.max(endSampleIndex, startSampleIndex)

		// Build mapped timeline entry
		const startTime = startSampleIndex / sourceRawAudio.sampleRate
		const endTime = endSampleIndex / sourceRawAudio.sampleRate

		return {
			type: timelineEntry.type,
			text: timelineEntry.text,

			startTime,
			endTime,

			timeline: innerTimeline
		}
	}

	const mappedTimeline = referenceTimeline.map((timelineEntry) => getMappedTimelineEntry(timelineEntry))

	logger.end()

	return mappedTimeline
}

export async function alignUsingDtwWithRecognition(
	sourceRawAudio: RawAudio,
	referenceRawAudio: RawAudio,
	referenceTimeline: Timeline,
	recognitionTimeline: Timeline,
	synthesizedRecognizedTranscriptRawAudio: RawAudio,
	synthesizedRecognitionTimeline: Timeline,
	granularities: DtwGranularity[],
	windowDurations: number[],
	phoneAlignmentMethod: API.PhoneAlignmentMethod = 'interpolation') {

	const logger = new Logger()

	if (recognitionTimeline.length == 0) {
		const sourceDuration = getRawAudioDuration(sourceRawAudio)
		const referenceDuration = getRawAudioDuration(referenceRawAudio)
		const ratio = sourceDuration / referenceDuration

		const interpolatedTimeline: Timeline = []

		for (const entry of referenceTimeline) {
			interpolatedTimeline.push({
				type: entry.type,
				text: entry.text,
				startTime: entry.startTime * ratio,
				endTime: entry.endTime * ratio
			})
		}

		return interpolatedTimeline
	}

	let recognitionTimelineWithPhones: Timeline

	if (phoneAlignmentMethod == 'interpolation') {
		// Add phone timelines by interpolating from reference words
		logger.start('Interpolate phone timing')

		recognitionTimelineWithPhones = await interpolatePhoneTimelines(recognitionTimeline, synthesizedRecognitionTimeline)
	} else if (phoneAlignmentMethod == 'dtw') {
		logger.start('Align phone timing')

		// Add phone timelines by aligning each individual recognized word with the corresponding word
		// in the reference timeline
		recognitionTimelineWithPhones = await alignPhoneTimelines(
			sourceRawAudio,
			recognitionTimeline,
			synthesizedRecognizedTranscriptRawAudio,
			synthesizedRecognitionTimeline,
			60)
	} else {
		throw new Error(`Unknown phone alignment method: ${phoneAlignmentMethod}`)
	}

	// Create a mapping from the synthesized recognized timeline to the recognized timeline
	logger.start('Map from the synthesized recognized timeline to the recognized timeline')

	type SynthesizedToRecognizedTimeMappingEntry = {
		synthesized: number
		recognized: number
	}

	type SynthesizedToRecognizedTimeMapping = SynthesizedToRecognizedTimeMappingEntry[]

	const synthesizedToRecognizedTimeMapping: SynthesizedToRecognizedTimeMapping = []

	for (let wordEntryIndex = 0; wordEntryIndex < synthesizedRecognitionTimeline.length; wordEntryIndex++) {
		const synthesizedWordTimelineEntry = synthesizedRecognitionTimeline[wordEntryIndex]
		const recognitionWordTimelineEntry = recognitionTimelineWithPhones[wordEntryIndex]

		for (let tokenEntryIndex = 0; tokenEntryIndex < synthesizedWordTimelineEntry.timeline!.length; tokenEntryIndex++) {
			const synthesizedTokenTimelineEntry = synthesizedWordTimelineEntry.timeline![tokenEntryIndex]
			const recognitionTokenTimelineEntry = recognitionWordTimelineEntry.timeline![tokenEntryIndex]

			for (let phoneEntryIndex = 0; phoneEntryIndex < synthesizedTokenTimelineEntry.timeline!.length; phoneEntryIndex++) {
				const synthesizedPhoneTimelineEntry = synthesizedTokenTimelineEntry.timeline![phoneEntryIndex]
				const recognitionPhoneTimelineEntry = recognitionTokenTimelineEntry.timeline![phoneEntryIndex]

				synthesizedToRecognizedTimeMapping.push({
					synthesized: synthesizedPhoneTimelineEntry.startTime,
					recognized: recognitionPhoneTimelineEntry.startTime
				})

				synthesizedToRecognizedTimeMapping.push({
					synthesized: synthesizedPhoneTimelineEntry.endTime,
					recognized: recognitionPhoneTimelineEntry.endTime
				})
			}
		}
	}

	logger.start('Align the synthesized recognized transcript with the synthesized ground-truth transcript')
	// Align the synthesized recognized transcript to the synthesized reference transcript
	const alignedSynthesizedRecognitionTimeline = await alignUsingDtw(
		synthesizedRecognizedTranscriptRawAudio,
		referenceRawAudio,
		referenceTimeline,
		granularities,
		windowDurations)

	function mapTimeline(timeline: Timeline) {
		function mapSynthesizedToRecognizedTime(synthesizedTime: number) {
			for (let mappingIndex = 0; ; mappingIndex += 1) {
				const left = synthesizedToRecognizedTimeMapping[mappingIndex].synthesized

				let right: number

				if (mappingIndex < synthesizedToRecognizedTimeMapping.length - 1) {
					right = synthesizedToRecognizedTimeMapping[mappingIndex + 1].synthesized
				} else {
					right = Infinity
				}

				if (left > right) {
					throw new Error('Left is greater than right!')
				}

				if (Math.abs(synthesizedTime - left) < Math.abs(synthesizedTime - right)) {
					return synthesizedToRecognizedTimeMapping[mappingIndex].recognized
				}
			}
		}

		const mappedTimeline: Timeline = []

		for (const entry of timeline) {
			const mappedEntry = deepClone(entry)

			mappedEntry.startTime = mapSynthesizedToRecognizedTime(entry.startTime)
			mappedEntry.endTime = mapSynthesizedToRecognizedTime(entry.endTime)

			if (entry.timeline) {
				mappedEntry.timeline = mapTimeline(entry.timeline)
			}

			mappedTimeline.push(mappedEntry)
		}

		return mappedTimeline
	}

	const result = mapTimeline(alignedSynthesizedRecognitionTimeline)

	logger.end()

	return result
}

export async function interpolatePhoneTimelines(sourceTimeline: Timeline, referenceTimeline: Timeline) {
	const interpolatedTimeline: Timeline = []

	for (let i = 0; i < sourceTimeline.length; i++) {
		const referenceEntry = referenceTimeline[i]

		const interpolatedEntry = deepClone(sourceTimeline[i])
		interpolatedTimeline.push(interpolatedEntry)

		if (interpolatedEntry.type != 'word') {
			continue
		}

		const interpolatedEntryDuration = interpolatedEntry.endTime - interpolatedEntry.startTime
		const synthesisEntryDuration = referenceEntry.endTime - referenceEntry.startTime

		function mapEntry(targetEntry: TimelineEntry): TimelineEntry {
			const targetStartTimePercentageRelativeToWord =
				(targetEntry.startTime - referenceEntry.startTime) / synthesisEntryDuration

			const targetEndTimePercentageRelativeToWord =
				(targetEntry.endTime - referenceEntry.startTime) / synthesisEntryDuration

			const interpolatedStartTime =
				interpolatedEntry.startTime + (zeroIfNaN(targetStartTimePercentageRelativeToWord) * interpolatedEntryDuration)

			const interpolatedEndTime =
				interpolatedEntry.startTime + (zeroIfNaN(targetEndTimePercentageRelativeToWord) * interpolatedEntryDuration)

			return {
				...targetEntry,

				startTime: interpolatedStartTime,
				endTime: interpolatedEndTime
			}
		}

		const interpolatedTokenEntries: Timeline = []

		for (const tokenEntry of (referenceEntry.timeline || [])!) {
			const interpolatedTokenEntry = mapEntry(tokenEntry)

			const interpolatedPhoneEntries: Timeline = []

			for (const phoneEntry of (tokenEntry.timeline || [])) {
				interpolatedPhoneEntries.push(mapEntry(phoneEntry))
			}

			interpolatedTokenEntry.timeline = interpolatedPhoneEntries

			interpolatedTokenEntries.push(interpolatedTokenEntry)
		}

		interpolatedEntry.timeline = interpolatedTokenEntries
	}

	return interpolatedTimeline
}

export async function alignPhoneTimelines(
	sourceRawAudio: RawAudio,
	sourceWordTimeline: Timeline,
	referenceRawAudio: RawAudio,
	referenceTimeline: Timeline,
	windowDuration: number) {

	const mfccOptions: MfccOptions = extendDefaultMfccOptions({ zeroFirstCoefficient: true })

	const framesPerSecond = 1 / mfccOptions.hopDuration!

	const referenceMfccs = await computeMFCCs(referenceRawAudio, mfccOptions)
	const sourceMfccs = await computeMFCCs(sourceRawAudio, mfccOptions)

	const alignedWordTimeline: Timeline = []

	for (let i = 0; i < referenceTimeline.length; i++) {
		const referenceWordEntry = referenceTimeline[i]

		const alignedWordEntry = deepClone(sourceWordTimeline[i])

		if (alignedWordEntry.type != 'word') {
			continue
		}

		const referenceWordStartFrameIndex = Math.floor(referenceWordEntry.startTime * framesPerSecond)
		let referenceWordEndFrameIndex = Math.floor(referenceWordEntry.endTime * framesPerSecond)

		// Ensure there is at least one frame in range
		if (referenceWordEndFrameIndex <= referenceWordStartFrameIndex) {
			referenceWordEndFrameIndex = referenceWordEndFrameIndex + 1
		}

		const referenceWordMfccs = referenceMfccs.slice(referenceWordStartFrameIndex, referenceWordEndFrameIndex)

		const alignedWordStartFrameIndex = Math.floor(alignedWordEntry.startTime * framesPerSecond)
		let alignedWordEndFrameIndex = Math.floor(alignedWordEntry.endTime * framesPerSecond)

		// Ensure there is at least one frame in range
		if (alignedWordEndFrameIndex <= alignedWordStartFrameIndex) {
			alignedWordEndFrameIndex = alignedWordStartFrameIndex + 1
		}

		const sourceWordMfccs = sourceMfccs.slice(alignedWordStartFrameIndex, alignedWordEndFrameIndex)

		// Compute DTW path
		const rawPath = await alignMFCC_DTW(referenceWordMfccs, sourceWordMfccs, windowDuration * framesPerSecond)
		const compactedPath = compactPath(rawPath)

		function mapEntry(referenceEntry: TimelineEntry): TimelineEntry {
			const referenceStartFrameOffset = Math.floor((referenceEntry.startTime - referenceWordEntry.startTime) * framesPerSecond)
			const alignedStartFrameOffset = getMappedFrameIndexForPath(referenceStartFrameOffset, compactedPath)
			const alignedStartTime = alignedWordEntry.startTime + (alignedStartFrameOffset / framesPerSecond)

			const referenceEndFrameOffset = Math.floor((referenceEntry.endTime - referenceWordEntry.startTime) * framesPerSecond)
			const alignedEndFrameOffset = getMappedFrameIndexForPath(referenceEndFrameOffset, compactedPath)
			const alignedEndTime = alignedWordEntry.startTime + (alignedEndFrameOffset / framesPerSecond)

			return {
				...referenceEntry,

				startTime: alignedStartTime,
				endTime: alignedEndTime
			}
		}

		// Add phone timeline using the mapped time information
		const alignedTokenTimeline: Timeline = []

		for (const referenceTokenEntry of (referenceWordEntry.timeline || [])) {
			const alignedPhoneTimeline: Timeline = []

			for (const referencePhoneEntry of (referenceTokenEntry.timeline || [])) {
				alignedPhoneTimeline.push(mapEntry(referencePhoneEntry))
			}

			alignedTokenTimeline.push({
				...mapEntry(referenceTokenEntry),

				timeline: alignedPhoneTimeline
			})
		}

		alignedWordEntry.timeline = alignedTokenTimeline

		alignedWordTimeline.push(alignedWordEntry)
	}

	return alignedWordTimeline
}

export async function createAlignmentReferenceUsingEspeak(transcript: string, language: string, plaintextOptions?: API.PlainTextOptions, customLexiconPaths?: string[], insertSeparators?: boolean) {
	const logger = new Logger()

	logger.start('Create alignment reference with eSpeak')

	const synthesisOptions: API.SynthesisOptions = {
		engine: 'espeak',
		language,

		plainText: plaintextOptions,
		customLexiconPaths: customLexiconPaths,

		espeak: {
			useKlatt: false,
			insertSeparators,
		}
	}

	let {
		audio: referenceRawAudio,
		timeline: segmentTimeline,
		voice: espeakVoice
	} = await synthesize(transcript, synthesisOptions)

	const sentenceTimeline = segmentTimeline.flatMap(entry => entry.timeline!)
	const wordTimeline = sentenceTimeline.flatMap(entry => entry.timeline!)

	referenceRawAudio = await resampleAudioSpeex(referenceRawAudio as RawAudio, 16000)
	referenceRawAudio = downmixToMonoAndNormalize(referenceRawAudio)

	logger.end()

	return { referenceRawAudio, referenceTimeline: wordTimeline, espeakVoice }
}

function compactPath(path: AlignmentPath) {
	const compactedPath: CompactedPath = []

	for (let i = 0; i < path.length; i++) {
		const pathEntry = path[i]

		if (compactedPath.length <= pathEntry.source) {
			compactedPath.push({ first: pathEntry.dest, last: pathEntry.dest })
		} else {
			compactedPath[compactedPath.length - 1].last = pathEntry.dest
		}
	}

	return compactedPath
}

function getMappedFrameIndexForPath(referenceFrameIndex: number, compactedPath: CompactedPath, mappingKind: 'first' | 'last' = 'first') {
	if (compactedPath.length == 0) {
		return 0
	}

	referenceFrameIndex = clip(referenceFrameIndex, 0, compactedPath.length - 1)

	const compactedPathEntry = compactedPath[referenceFrameIndex]

	let mappedFrameIndex: number

	if (mappingKind == 'first') {
		mappedFrameIndex = compactedPathEntry.first
	} else {
		mappedFrameIndex = compactedPathEntry.last
	}

	return mappedFrameIndex
}

function resolveAutoGranularityIfNeeded(granularity: DtwGranularity, audioDuration: number) {
	if (granularity != 'auto') {
		return granularity
	}

	if (audioDuration < 60) {
		return 'high'
	} else if (audioDuration < 60 * 10) {
		return 'medium'
	} else {
		return 'low'
	}
}

function getMfccOptionsForGranularity(granularity: DtwGranularity, audioDuration: number) {
	let mfccOptions: MfccOptions

	granularity = resolveAutoGranularityIfNeeded(granularity, audioDuration)

	if (granularity == 'xx-low') {
		mfccOptions = { windowDuration: 0.400, hopDuration: 0.160, fftOrder: 8192 }
	} else if (granularity == 'x-low') {
		mfccOptions = { windowDuration: 0.200, hopDuration: 0.080, fftOrder: 4096 }
	} else if (granularity == 'low') {
		mfccOptions = { windowDuration: 0.100, hopDuration: 0.040, fftOrder: 2048 }
	} else if (granularity == 'medium') {
		mfccOptions = { windowDuration: 0.050, hopDuration: 0.020, fftOrder: 1024 }
	} else if (granularity == 'high') {
		mfccOptions = { windowDuration: 0.025, hopDuration: 0.010, fftOrder: 512 }
	} else if (granularity == 'x-high') {
		mfccOptions = { windowDuration: 0.020, hopDuration: 0.005, fftOrder: 512 }
	} else {
		throw new Error(`Invalid granularity setting: '${granularity}'`)
	}

	return mfccOptions
}

export type AlignmentPath = AlignmentPathEntry[]

export type AlignmentPathEntry = {
	source: number,
	dest: number
}

export type CompactedPath = CompactedPathEntry[]

export type CompactedPathEntry = {
	first: number, last: number
}

export type DtwGranularity = 'auto' | 'xx-low' | 'x-low' | 'low' | 'medium' | 'high' | 'x-high'
