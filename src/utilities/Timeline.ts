import { ParagraphBreakType, WhitespaceProcessing } from '../api/Common.js'
import { isWordOrSymbolWord, splitToParagraphs, splitToSentences } from '../nlp/Segmentation.js'
import { deepClone } from './ObjectUtilities.js'
import { getUTF32Chars, roundToDigits } from './Utilities.js'

export function addTimeOffsetToTimeline(targetTimeline: Timeline, timeOffset: number) {
	if (!targetTimeline) {
		return targetTimeline
	}

	const newTimeline = deepClone(targetTimeline)

	for (const segmentTimelineEntry of newTimeline) {
		segmentTimelineEntry.startTime = Math.max(segmentTimelineEntry.startTime + timeOffset, 0)
		segmentTimelineEntry.endTime = Math.max(segmentTimelineEntry.endTime + timeOffset, 0)

		if (segmentTimelineEntry.timeline) {
			segmentTimelineEntry.timeline = addTimeOffsetToTimeline(segmentTimelineEntry.timeline, timeOffset)
		}
	}

	return newTimeline
}

export function multiplyTimelineByFactor(targetTimeline: Timeline, factor: number) {
	const newTimeline = deepClone(targetTimeline)

	for (const segmentTimelineEntry of newTimeline) {
		segmentTimelineEntry.startTime = segmentTimelineEntry.startTime * factor
		segmentTimelineEntry.endTime = segmentTimelineEntry.endTime * factor

		if (segmentTimelineEntry.timeline) {
			segmentTimelineEntry.timeline = multiplyTimelineByFactor(segmentTimelineEntry.timeline, factor)
		}
	}

	return newTimeline
}

export function roundTimelineProperties(targetTimeline: Timeline, decimalDigits = 2) {
	const roundedTimeline = deepClone(targetTimeline)

	for (const entry of roundedTimeline) {
		if (entry.startTime) {
			entry.startTime = roundToDigits(entry.startTime, decimalDigits)
		}

		if (entry.endTime) {
			entry.endTime = roundToDigits(entry.endTime, decimalDigits)
		}

		if (entry.confidence) {
			entry.confidence = roundToDigits(entry.confidence, decimalDigits)
		}

		if (entry.timeline) {
			entry.timeline = roundTimelineProperties(entry.timeline)
		}
	}

	return roundedTimeline
}

export async function wordTimelineToSegmentSentenceTimeline(wordTimeline: Timeline, transcript: string, language: string, paragraphBreaks: ParagraphBreakType = 'double', whitespace: WhitespaceProcessing = 'collapse') {
	const paragraphs = splitToParagraphs(transcript, paragraphBreaks, whitespace)

	const segments = paragraphs
		.map(segment =>
			splitToSentences(segment, language).map(sentence =>
				sentence.trim()))

	let text = ''
	const charIndexToSentenceEntryMapping: TimelineEntry[] = []

	const segmentTimeline: Timeline = []

	for (const segment of segments) {
		const sentencesInSegment: Timeline = []

		const segmentEntry: TimelineEntry = {
			type: 'segment',
			text: '',
			startTime: -1,
			endTime: -1,
			timeline: sentencesInSegment
		}

		for (const sentence of segment) {
			const sentenceEntry: TimelineEntry = {
				type: 'sentence',
				text: sentence,
				startTime: -1,
				endTime: -1,
				timeline: []
			}

			for (const char of sentence + ' ') {
				text += char
				charIndexToSentenceEntryMapping.push(sentenceEntry)
			}

			sentencesInSegment.push(sentenceEntry)
		}

		segmentTimeline.push(segmentEntry)
	}

	let wordSearchStartOffset = 0

	for (let wordIndex = 0; wordIndex < wordTimeline.length; wordIndex++) {
		const wordEntry = wordTimeline[wordIndex]
		const wordText = wordEntry.text

		if (!isWordOrSymbolWord(wordText)) {
			continue
		}

		const indexOfWordInText = text.indexOf(wordText, wordSearchStartOffset)

		if (indexOfWordInText == -1) {
			throw new Error(`Couldn't find the word '${wordText}' in the text at start position ${wordSearchStartOffset}`)
		}

		const targetSentenceEntry = charIndexToSentenceEntryMapping[indexOfWordInText]
		targetSentenceEntry.timeline!.push(deepClone(wordEntry))

		wordSearchStartOffset = indexOfWordInText + wordText.length
	}

	const newSegmentTimeline: Timeline = []

	for (const segmentEntry of segmentTimeline) {
		const oldSentenceTimeline = segmentEntry.timeline!

		const newSentenceTimeline: Timeline = []

		for (const sentenceEntry of oldSentenceTimeline) {
			const wordTimeline = sentenceEntry.timeline

			if (!wordTimeline || wordTimeline.length == 0) {
				continue
			}

			sentenceEntry.startTime = wordTimeline[0].startTime
			sentenceEntry.endTime = wordTimeline[wordTimeline.length - 1].endTime

			newSentenceTimeline.push(sentenceEntry)
		}

		if (newSentenceTimeline.length == 0) {
			continue
		}

		segmentEntry.text = newSentenceTimeline.map(sentenceEntry => sentenceEntry.text).join(' ')

		segmentEntry.startTime = newSentenceTimeline[0].startTime
		segmentEntry.endTime = newSentenceTimeline[newSentenceTimeline.length - 1].endTime

		newSegmentTimeline.push(segmentEntry)
	}

	return { segmentTimeline: newSegmentTimeline }
}

export function addWordTextOffsetsToTimeline(timeline: Timeline, text: string, currentOffset = 0) {
	const { mapping } = getUTF32Chars(text)

	for (const entry of timeline) {
		if (entry.type == 'word') {
			let word = entry.text

			word = word.trim().replaceAll(/\s+/g, ' ')

			const wordParts = word.split(' ')

			let startOffset: number | undefined
			let endOffset: number | undefined

			for (let i = 0; i < wordParts.length; i++) {
				let wordPart = wordParts[i]

				let wordPartOffset = text.indexOf(wordPart, currentOffset)

				if (wordPartOffset == -1) {
					continue
				}

				currentOffset = wordPartOffset + wordParts[i].length

				if (i == 0) {
					startOffset = wordPartOffset
				}

				endOffset = currentOffset
			}

			entry.startOffsetUtf16 = startOffset
			entry.endOffsetUtf16 = endOffset

			entry.startOffsetUtf32 = startOffset != undefined ? mapping[startOffset] : undefined
			entry.endOffsetUtf32 = endOffset != undefined ? mapping[endOffset] : undefined
		} else if (entry.timeline) {
			currentOffset = addWordTextOffsetsToTimeline(entry.timeline, text, currentOffset)
		}
	}

	return currentOffset
}

export function extractEntries(timeline: Timeline, predicate: (entry: TimelineEntry) => boolean): TimelineEntry[] {
	const timelineWordEntries: TimelineEntry[] = []

	for (const entry of timeline) {
		if (predicate(entry)) {
			timelineWordEntries.push(entry)
		} else if (entry.timeline) {
			timelineWordEntries.push(...extractEntries(entry.timeline, predicate))
		}
	}

	return timelineWordEntries
}

export type TimelineEntryType = 'segment' | 'paragraph' | 'sentence' | 'clause' | 'phrase' | 'word' | 'token' | 'letter' | 'phone' | 'subphone'

export type TimelineEntry = {
	type: TimelineEntryType

	text: string,

	startTime: number,
	endTime: number,

	startOffsetUtf16?: number
	endOffsetUtf16?: number

	startOffsetUtf32?: number
	endOffsetUtf32?: number

	confidence?: number

	id?: number

	timeline?: Timeline
}

export type Timeline = TimelineEntry[]
