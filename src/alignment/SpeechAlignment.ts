import { clip } from '../utilities/Utilities.js'

import * as API from '../api/API.js'

import { computeMFCCs, extendDefaultMfccOptions, MfccOptions } from '../dsp/MFCC.js'
import { alignMFCC_DTW, getCostMatrixMemorySizeMB } from './DTWMfccSequenceAlignment.js'
import { Logger } from '../utilities/Logger.js'
import { Timeline, TimelineEntry } from '../utilities/Timeline.js'
import { getEndingSilentSampleCount, getRawAudioDuration, getStartingSilentSampleCount, RawAudio } from '../audio/AudioUtilities.js'
import { type EspeakOptions } from '../synthesis/EspeakTTS.js'
import chalk from 'chalk'

export async function alignUsingDtw(sourceRawAudio: RawAudio, referenceRawAudio: RawAudio, referenceTimeline: Timeline, granularities: DtwGranularity[], windowDurations: number[]) {
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

			if (windowDuration < minRecommendedWindowDuration ) {
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

export async function alignUsingDtwWithRecognition(sourceRawAudio: RawAudio, referenceRawAudio: RawAudio, referenceTimeline: Timeline, recognitionTimeline: Timeline, granularities: DtwGranularity[], windowDurations: number[], espeakOptions: EspeakOptions, phoneAlignmentMethod: API.PhoneAlignmentMethod = 'interpolation') {
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

	// Synthesize the recognized transcript and get its timeline
	logger.start('Synthesize recognized transcript with eSpeak')
	const recognizedWords = recognitionTimeline.map(entry => entry.text)

	const { rawAudio: synthesizedRecognizedTranscriptRawAudio, timeline: synthesizedRecognitionTimeline } = await createAlignmentReferenceUsingEspeakForFragments(recognizedWords, espeakOptions)

	let recognitionTimelineWithPhones: Timeline

	if (phoneAlignmentMethod == 'interpolation') {
		// Add phone timelines by interpolating from reference words
		logger.start('Interpolate phone timing')

		recognitionTimelineWithPhones = await interpolatePhoneTimelines(recognitionTimeline, synthesizedRecognitionTimeline)
	} else if (phoneAlignmentMethod == 'dtw') {
		logger.start('Align phone timing')

		// Add phone timelines by aligning each individual recognized word with the corresponding word
		// in the reference timeline
		recognitionTimelineWithPhones = await alignPhoneTimelines(sourceRawAudio, recognitionTimeline, synthesizedRecognizedTranscriptRawAudio, synthesizedRecognitionTimeline)
	} else if (phoneAlignmentMethod == 'dtw-knn') {
		logger.start('Align phone timing')
		throw new Error('Not implemented')
	} else {
		throw new Error(`Unknown phone alignment method: ${phoneAlignmentMethod}`)
	}

	logger.start('Map from the synthesized recognized timeline to the recognized timeline')
	// Create a mapping from the synthesized recognized timeline to the recognized timeline
	type SynthesizedToRecognizedTimeMapping = SynthesizedToRecognizedTimeMappingEntry[]
	type SynthesizedToRecognizedTimeMappingEntry = { synthesized: number, recognized: number }

	const synthesizedToRecognizedTimeMapping: SynthesizedToRecognizedTimeMapping = []

	for (let i = 0; i < synthesizedRecognitionTimeline.length; i++) {
		const synthesizedTimelineEntry = synthesizedRecognitionTimeline[i]
		const recognitionTimelineEntry = recognitionTimelineWithPhones[i]

		synthesizedToRecognizedTimeMapping.push({ synthesized: synthesizedTimelineEntry.startTime, recognized: recognitionTimelineEntry.startTime })

		if (synthesizedTimelineEntry.timeline) {
			for (let j = 0; j < synthesizedTimelineEntry.timeline.length; j++) {
				const synthesizedPhoneTimelineEntry = synthesizedTimelineEntry.timeline[j]
				const recognitionPhoneTimelineEntry = recognitionTimelineEntry.timeline![j]

				synthesizedToRecognizedTimeMapping.push({ synthesized: synthesizedPhoneTimelineEntry.startTime, recognized: recognitionPhoneTimelineEntry.startTime })
				synthesizedToRecognizedTimeMapping.push({ synthesized: synthesizedPhoneTimelineEntry.endTime, recognized: recognitionPhoneTimelineEntry.endTime })
			}
		}

		synthesizedToRecognizedTimeMapping.push({ synthesized: synthesizedTimelineEntry.endTime, recognized: recognitionTimelineEntry.endTime })
	}

	logger.start('Align the synthesized recognized transcript with the synthesized ground-truth transcript')
	// Align the synthesized recognized transcript to the synthesized reference transcript
	const alignedSynthesizedRecognitionTimeline = await alignUsingDtw(synthesizedRecognizedTranscriptRawAudio, referenceRawAudio, referenceTimeline, granularities, windowDurations)

	let currentSynthesizedToRecognizedMappingIndex = 0

	function mapSynthesizedToRecognizedTimeAndAdvance(synthesizedTime: number) {
		for (; ; currentSynthesizedToRecognizedMappingIndex += 1) {
			const left = synthesizedToRecognizedTimeMapping[currentSynthesizedToRecognizedMappingIndex].synthesized

			let right: number

			if (currentSynthesizedToRecognizedMappingIndex < synthesizedToRecognizedTimeMapping.length - 1) {
				right = synthesizedToRecognizedTimeMapping[currentSynthesizedToRecognizedMappingIndex + 1].synthesized
			} else {
				right = Infinity
			}

			if (left > right) {
				throw new Error('left is larger than right!')
			}

			if (Math.abs(synthesizedTime - left) < Math.abs(synthesizedTime - right)) {
				return synthesizedToRecognizedTimeMapping[currentSynthesizedToRecognizedMappingIndex].recognized
			}
		}
	}

	function mapTimeline(timeline: Timeline) {
		const mappedTimeline: Timeline = []

		for (const entry of timeline) {
			const mappedEntry = { ...entry }

			mappedEntry.startTime = mapSynthesizedToRecognizedTimeAndAdvance(entry.startTime)

			if (entry.timeline) {
				mappedEntry.timeline = mapTimeline(entry.timeline)
			}

			mappedEntry.endTime = mapSynthesizedToRecognizedTimeAndAdvance(entry.endTime)

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

		const interpolatedEntry = { ...sourceTimeline[i] }
		interpolatedTimeline.push(interpolatedEntry)

		if (interpolatedEntry.type != 'word') {
			continue
		}

		const interpolatedEntryDuration = interpolatedEntry.endTime - interpolatedEntry.startTime
		const synthesisEntryDuration = referenceEntry.endTime - referenceEntry.startTime

		interpolatedEntry.timeline = []

		for (const phoneEntry of referenceEntry.timeline!) {
			const phoneStartTimePercentageRelativeToWord =
				(phoneEntry.startTime - referenceEntry.startTime) / synthesisEntryDuration

			const phoneEndTimePercentageRelativeToWord =
				(phoneEntry.endTime - referenceEntry.startTime) / synthesisEntryDuration

			const interpolatedPhoneStartTime = interpolatedEntry.startTime + (phoneStartTimePercentageRelativeToWord * interpolatedEntryDuration)
			const interpolatedPhoneEndTime = interpolatedEntry.startTime + (phoneEndTimePercentageRelativeToWord * interpolatedEntryDuration)

			interpolatedEntry.timeline.push({
				...phoneEntry,

				startTime: interpolatedPhoneStartTime,
				endTime: interpolatedPhoneEndTime
			})
		}
	}

	return interpolatedTimeline
}

export async function alignPhoneTimelines(sourceRawAudio: RawAudio, sourceWordTimeline: Timeline, referenceRawAudio: RawAudio, referenceTimeline: Timeline) {
	const mfccOptions: MfccOptions = extendDefaultMfccOptions({ zeroFirstCoefficient: true })

	const framesPerSecond = 1 / mfccOptions.hopDuration!

	const referenceMfccs = await computeMFCCs(referenceRawAudio, mfccOptions)
	const sourceMfccs = await computeMFCCs(sourceRawAudio, mfccOptions)

	const alignedWordTimeline: Timeline = []

	for (let i = 0; i < referenceTimeline.length; i++) {
		const referenceWordEntry = referenceTimeline[i]

		const alignedWordEntry = { ...sourceWordTimeline[i] }
		alignedWordTimeline.push(alignedWordEntry)

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
		const rawPath = await alignMFCC_DTW(referenceWordMfccs, sourceWordMfccs, 60)
		const compactedPath = compactPath(rawPath)

		// Add phone timeline using the mapped time information
		alignedWordEntry.timeline = []

		for (const referencePhoneEntry of referenceWordEntry.timeline!) {
			const referencePhoneStartFrameOffset = Math.floor((referencePhoneEntry.startTime - referenceWordEntry.startTime) * framesPerSecond)
			const alignedPhoneStartFrameOffset = getMappedFrameIndexForPath(referencePhoneStartFrameOffset, compactedPath)
			const alignedPhoneStartTime = alignedWordEntry.startTime + (alignedPhoneStartFrameOffset / framesPerSecond)

			const referencePhoneEndFrameOffset = Math.floor((referencePhoneEntry.endTime - referenceWordEntry.startTime) * framesPerSecond)
			const alignedPhoneEndFrameOffset = getMappedFrameIndexForPath(referencePhoneEndFrameOffset, compactedPath)
			const alignedPhoneEndTime = alignedWordEntry.startTime + (alignedPhoneEndFrameOffset / framesPerSecond)

			alignedWordEntry.timeline.push({
				...referencePhoneEntry,
				startTime: alignedPhoneStartTime,
				endTime: alignedPhoneEndTime
			})
		}
	}

	return alignedWordTimeline
}

export async function createAlignmentReferenceUsingEspeakForFragments(fragments: string[], espeakOptions: EspeakOptions, insertSeparators = true) {
	const progressLogger = new Logger()

	progressLogger.start('Load espeak module')
	const Espeak = await import('../synthesis/EspeakTTS.js')

	progressLogger.start('Create alignment reference with eSpeak')

	const result = await Espeak.synthesizeFragments(fragments, espeakOptions, insertSeparators)

	result.timeline = result.timeline.flatMap(clause => clause.timeline!)

	for (const wordEntry of result.timeline) {
		wordEntry.timeline = wordEntry.timeline!.flatMap(tokenEntry => tokenEntry.timeline!)
	}

	progressLogger.end()

	return result
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
