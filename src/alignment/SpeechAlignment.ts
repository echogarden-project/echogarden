import { clip, splitFloat32Array } from '../utilities/Utilities.js'

import * as API from '../api/API.js'

import { computeMFCCs, extendDefaultMfccOptions, MfccOptions } from '../dsp/MFCC.js'
import { alignMFCC_DTW, getCostMatrixMemorySizeMB } from './DTWMfccSequenceAlignment.js'
import { Logger } from '../utilities/Logger.js'
import { addTimeOffsetToTimeline, Timeline, TimelineEntry } from '../utilities/Timeline.js'
import { concatAudioSegments, downmixToMonoAndNormalize, getEmptyRawAudio, getEndingSilentSampleCount, getRawAudioDuration, getStartingSilentSampleCount, RawAudio } from '../audio/AudioUtilities.js'
import chalk from 'chalk'
import { synthesize } from '../api/API.js'
import { resampleAudioSpeex } from '../dsp/SpeexResampler.js'
import { deepClone } from '../utilities/ObjectUtilities.js'
import { cosineDistance, euclideanDistance, zeroIfNaN } from '../math/VectorMath.js'
import { EspeakEvent, EspeakOptions } from '../synthesis/EspeakTTS.js'
import { alignDTWWindowed } from './DTWSequenceAlignmentWindowed.js'
import { loadPackage } from '../utilities/PackageManager.js'
import { joinPath } from '../utilities/PathUtilities.js'

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
		const granularity = granularities[passIndex]
		const windowDuration = windowDurations[passIndex]

		logger.logTitledMessage(`\nStarting alignment pass ${passIndex + 1}/${windowDurations.length}`, `granularity: ${granularity}, max window duration: ${windowDuration}s (${(windowDuration / rawAudioDuration * 100).toFixed(1)}%)`, chalk.magentaBright)

		const mfccOptions = extendDefaultMfccOptions({ ...getMfccOptionsForGranularity(granularity), zeroFirstCoefficient: true }) as MfccOptions

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
				logger.logTitledMessage('Warning', `Maximum DTW window duration is set to ${windowDuration.toFixed(1)}s (${(windowDuration / rawAudioDuration * 100).toFixed(1)}%), which is less than 20% of the source audio duration (audio duration is ${rawAudioDuration.toFixed(1)}s and a 20% window would be ${(rawAudioDuration * 0.2).toFixed(1)}s). This may lead to suboptimal results in some cases. Consider increasing window duration if needed.`, chalk.yellowBright, 'warning')
			}
		}

		logger.start('Align reference and source MFCC features using DTW')
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

	const mappedTimeline = referenceTimeline.map(entry => getMappedTimelineEntry(entry, sourceRawAudio, framesPerSecond, compactedPath))

	logger.end()

	return mappedTimeline
}

export async function alignUsingDtwWithRecognition(
	sourceRawAudio: RawAudio,
	referenceRawAudio: RawAudio,
	referenceTimeline: Timeline,
	recognitionTimeline: Timeline,
	granularities: DtwGranularity[],
	windowDurations: number[],
	espeakOptions: EspeakOptions,
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

	// Synthesize the recognized transcript and get its timeline
	logger.start("Synthesize recognized transcript with eSpeak")
	const recognizedWords = recognitionTimeline.map(entry => entry.text)

	const {
		rawAudio: synthesizedRecognizedTranscriptRawAudio,
		timeline: synthesizedRecognitionTimeline
	} = await createAlignmentReferenceUsingEspeakForFragments(recognizedWords, espeakOptions)

	let recognitionTimelineWithPhones: Timeline

	if (phoneAlignmentMethod == 'interpolation') {
		// Add phone timelines by interpolating from reference words
		logger.start('Interpolate phone timing')

		recognitionTimelineWithPhones = await interpolatePhoneTimelines(
			recognitionTimeline,
			synthesizedRecognitionTimeline
		)
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
	logger.start("Map from the synthesized recognized timeline to the recognized timeline")

	type SynthesizedToRecognizedTimeMappingEntry = {
		synthesized: number
		recognized: number
	}

	type SynthesizedToRecognizedTimeMapping = SynthesizedToRecognizedTimeMappingEntry[]

	const synthesizedToRecognizedTimeMapping: SynthesizedToRecognizedTimeMapping = []

	for (let wordEntryIndex = 0; wordEntryIndex < synthesizedRecognitionTimeline.length; wordEntryIndex++) {
		const synthesizedTimelineEntry = synthesizedRecognitionTimeline[wordEntryIndex]
		const recognitionTimelineEntry = recognitionTimelineWithPhones[wordEntryIndex]

		synthesizedToRecognizedTimeMapping.push({
			synthesized: synthesizedTimelineEntry.startTime,
			recognized: recognitionTimelineEntry.startTime
		})

		if (synthesizedTimelineEntry.timeline) {
			for (let tokenEntryIndex = 0; tokenEntryIndex < synthesizedTimelineEntry.timeline.length; tokenEntryIndex++) {
				const synthesizedPhoneTimelineEntry = synthesizedTimelineEntry.timeline[tokenEntryIndex]
				const recognitionPhoneTimelineEntry = recognitionTimelineEntry.timeline![tokenEntryIndex]

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

		synthesizedToRecognizedTimeMapping.push({
			synthesized: synthesizedTimelineEntry.endTime,
			recognized: recognitionTimelineEntry.endTime
		})
	}

	// Align the synthesized recognized transcript to the synthesized reference transcript
	logger.start("Align the synthesized recognized transcript with the synthesized ground-truth transcript")

	const alignedSynthesizedRecognitionTimeline = await alignUsingDtw(
		synthesizedRecognizedTranscriptRawAudio,
		referenceRawAudio,
		referenceTimeline,
		granularities,
		windowDurations)

	let currentSynthesizedToRecognizedMappingIndex = 0

	// Map from synthesized reference timestamps to the recognition timestamps
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
				throw new Error("Left is larger than right!")
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

// This is experimental code. It doesn't work well enough to be usable for anything.
// Just testing some alternative approaches.
export async function alignUsingDtwWithEmbeddings(
	sourceRawAudio: RawAudio,
	referenceRawAudio: RawAudio,
	referenceTimeline: Timeline,
	language: string,
	granularities: DtwGranularity[],
	windowDurations: number[]) {

	const logger = new Logger()

	if (sourceRawAudio.sampleRate != 16000) {
		throw new Error('Source audio must have a sample rate of 16000 Hz')
	}

	if (referenceRawAudio.sampleRate != 16000) {
		throw new Error('Reference audio must have a sample rate of 16000 Hz')
	}

	const embeddingType: 'w2v-bert-2.0' | 'whisper' = 'w2v-bert-2.0'

	let sourceEmbeddings: Float32Array[]
	let referenceEmbeddings: Float32Array[]
	let framesPerSecond: number

	if (embeddingType === 'w2v-bert-2.0') {
		const packageName = 'w2v-bert-2.0-uint8'
		const modelDir = await loadPackage(packageName)
		const modelFilePath = joinPath(modelDir, `${packageName}.onnx`)

		const { Wav2Vec2BertFeatureEmbeddings } = await import('../speech-embeddings/WavToVec2BertFeatureEmbeddings.js')

		const wav2vecBert = new Wav2Vec2BertFeatureEmbeddings(
			modelFilePath,
			['cpu'],
		)

		logger.start(`Extract source audio embeddings using the W2V-BERT-2.0 model`)
		sourceEmbeddings = await wav2vecBert.computeEmbeddings(sourceRawAudio)

		logger.start(`Extract reference audio embeddings using the W2V-BERT-2.0 model`)
		referenceEmbeddings = await wav2vecBert.computeEmbeddings(referenceRawAudio)

		framesPerSecond = 1000 / 10 / 2
	} else if (embeddingType === 'whisper') {
		const sourceSamples = sourceRawAudio.audioChannels[0]
		const referenceSamples = referenceRawAudio.audioChannels[0]

		const WhisperSTT = await import(`../recognition/WhisperSTT.js`)

		const { modelName, modelDir } = await WhisperSTT.loadPackagesAndGetPaths('base.en', language)

		const whisper = new WhisperSTT.Whisper(modelName, modelDir, ['dml', 'cpu'], ['cpu'])

		async function encodeToAudioFeatures(samples: Float32Array) {
			const featureVectors: Float32Array[] = []

			for (let i = 0; i < samples.length; i += 16000 * 30) {
				const startSampleIndex = i
				const endSampleIndex = Math.min(samples.length, i + 16000 * 30)
				const partSampleCount = endSampleIndex - startSampleIndex

				const audioPart = samples.subarray(startSampleIndex, endSampleIndex)
				const rawAudioForPart = { audioChannels: [audioPart], sampleRate: 16000 } as RawAudio

				const resultTensor = await whisper.encodeAudio(rawAudioForPart)

				const vectorLength = resultTensor.dims[2]

				let featureVectorsForPart = splitFloat32Array(resultTensor.data as Float32Array, vectorLength)

				featureVectorsForPart = featureVectorsForPart.slice(0, Math.floor((partSampleCount / (16000 * 30)) * 1500))

				featureVectors.push(...featureVectorsForPart)
			}

			return featureVectors
		}

		logger.start(`Extract source audio embeddings using the Whisper encoder model`)
		sourceEmbeddings = await encodeToAudioFeatures(sourceSamples)

		logger.start(`Extract reference audio embeddings using the Whisper encoder model`)
		referenceEmbeddings = await encodeToAudioFeatures(referenceSamples)

		framesPerSecond = 1500 / 30
	} else {
		throw new Error(`Unknown embedding type: ${embeddingType}`)
	}

	logger.start(`Align source and reference audio embeddings using DTW`)

	const { path: alignmentPath } = alignDTWWindowed(
		referenceEmbeddings,
		sourceEmbeddings,
		cosineDistance,
		1000 * 1000
	)

	const compactedPath = compactPath(alignmentPath)

	logger.start('\nConvert path to timeline')

	const mappedTimeline = referenceTimeline.map(entry => getMappedTimelineEntry(entry, sourceRawAudio, framesPerSecond, compactedPath))

	logger.end()

	return mappedTimeline
}

function getMappedTimelineEntry(
	timelineEntry: TimelineEntry,
	sourceRawAudio: RawAudio,
	framesPerSecond: number,
	compactedPath: CompactedPath,
	recurse = true): TimelineEntry {

	const referenceStartFrameIndex = Math.floor(timelineEntry.startTime * framesPerSecond)
	const referenceEndFrameIndex = Math.floor(timelineEntry.endTime * framesPerSecond)

	if (referenceStartFrameIndex < 0 || referenceEndFrameIndex < 0) {
		throw new Error('Unexpected: encountered a negative timestamp in timeline')
	}

	const mappedStartFrameIndex = getMappedFrameIndexForPath(referenceStartFrameIndex, compactedPath, 'first')
	const mappedEndFrameIndex = getMappedFrameIndexForPath(referenceEndFrameIndex, compactedPath, 'first')

	let innerTimeline: Timeline | undefined

	if (recurse && timelineEntry.timeline != null) {
		innerTimeline = timelineEntry.timeline.map((entry) => getMappedTimelineEntry(entry, sourceRawAudio, framesPerSecond, compactedPath, recurse))
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

export async function interpolatePhoneTimelines(sourceTimeline: Timeline, referenceTimeline: Timeline) {
	const interpolatedTimeline: Timeline = []

	for (let wordEntryIndex = 0; wordEntryIndex < sourceTimeline.length; wordEntryIndex++) {
		const referenceEntry = referenceTimeline[wordEntryIndex]

		const interpolatedEntry = deepClone(sourceTimeline[wordEntryIndex])
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

		const interpolatedPhoneEntries: Timeline = []

		for (const phoneEntry of (referenceEntry.timeline || [])) {
			interpolatedPhoneEntries.push(mapEntry(phoneEntry))
		}

		interpolatedEntry.timeline = interpolatedPhoneEntries
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
		const alignedPhoneTimeline: Timeline = []

		for (const referencePhoneEntry of (referenceWordEntry.timeline || [])) {
			alignedPhoneTimeline.push(mapEntry(referencePhoneEntry))
		}

		alignedWordEntry.timeline = alignedPhoneTimeline

		alignedWordTimeline.push(alignedWordEntry)
	}

	return alignedWordTimeline
}

export async function createAlignmentReferenceUsingEspeakForFragments(fragments: string[], espeakOptions: EspeakOptions) {
	const progressLogger = new Logger()

	progressLogger.start("Load espeak module")
	const Espeak = await import("../synthesis/EspeakTTS.js")

	progressLogger.start("Synthesize alignment reference using eSpeak")

	const result = {
		rawAudio: getEmptyRawAudio(1, await Espeak.getSampleRate()) as RawAudio,
		timeline: [] as Timeline,
		events: [] as EspeakEvent[],
	}

	{
		// Split fragments to chunks, process each chunk individually,
		// and incrementally merge the chunks to the final result.

		const maxCharactersInChunk = 1000

		let timeOffset = 0

		let currentChunk: string[] = []
		let currentChunkCharacterCount = 0

		for (let fragmentIndex = 0; fragmentIndex < fragments.length; fragmentIndex++) {
			const fragment = fragments[fragmentIndex]

			currentChunk.push(fragment)
			currentChunkCharacterCount += fragment.length

			if (currentChunkCharacterCount >= maxCharactersInChunk || fragmentIndex === fragments.length - 1) {
				// Process current chunk

				const chunkResult = await Espeak.synthesizeFragments(currentChunk, espeakOptions)

				result.rawAudio = {
					sampleRate: result.rawAudio.sampleRate,
					audioChannels: concatAudioSegments([result.rawAudio.audioChannels, chunkResult.rawAudio.audioChannels])
				}

				const chunkTimeline = addTimeOffsetToTimeline(chunkResult.timeline, timeOffset)

				result.timeline = [...result.timeline, ...chunkTimeline]

				result.events = [...result.events, ...chunkResult.events]

				timeOffset += getRawAudioDuration(chunkResult.rawAudio)

				currentChunk = []
				currentChunkCharacterCount = 0
			}
		}
	}

	result.timeline = result.timeline.flatMap(clause => clause.timeline!)

	for (const wordEntry of result.timeline) {
		wordEntry.timeline = wordEntry.timeline!.flatMap(tokenEntry => tokenEntry.timeline!)
	}

	progressLogger.end()

	return result
}

export async function createAlignmentReferenceUsingEspeak(
	transcript: string,
	language: string,
	plaintextOptions?: API.PlainTextOptions,
	customLexiconPaths?: string[],
	insertSeparators?: boolean,
	useKlatt?: boolean) {

	const logger = new Logger()

	logger.start('Synthesize alignment reference using eSpeak')

	const synthesisOptions: API.SynthesisOptions = {
		engine: 'espeak',
		language,

		plainText: plaintextOptions,
		customLexiconPaths: customLexiconPaths,

		espeak: {
			useKlatt,
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

export function getMfccOptionsForGranularity(granularity: DtwGranularity) {
	let mfccOptions: MfccOptions

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

export type DtwGranularity = 'xx-low' | 'x-low' | 'low' | 'medium' | 'high' | 'x-high'
