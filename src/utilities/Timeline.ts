import { ParagraphBreakType, WhitespaceProcessing } from "../api/Common.js"
import { isWordOrSymbolWord, splitToParagraphs, splitToSentences } from "../nlp/Segmentation.js"
import { deepClone } from "./ObjectUtilities.js"
import { roundToDigits } from "./Utilities.js"

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
	const paragraphs = await splitToParagraphs(transcript, paragraphBreaks, whitespace)

	const segments = paragraphs
			.map(segment =>
				splitToSentences(segment, language).map(sentence =>
					sentence.trim()))

	let text = ""
	const charIndexToSentenceEntryMapping: TimelineEntry[] = []

	const segmentTimeline: Timeline = []

	for (const segment of segments) {
		const sentencesInSegment: Timeline = []

		const segmentEntry: TimelineEntry = {
			type: "segment",
			text: "",
			startTime: -1,
			endTime: -1,
			timeline: sentencesInSegment
		}

		for (const sentence of segment) {
			const sentenceEntry: TimelineEntry = {
				type: "sentence",
				text: sentence,
				startTime: -1,
				endTime: -1,
				timeline: []
			}

			for (const char of sentence + " ") {
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
		targetSentenceEntry.timeline!.push(wordEntry)

		wordSearchStartOffset = indexOfWordInText + wordText.length
	}

	for (const segmentEntry of segmentTimeline) {
		const sentenceTimeline = segmentEntry.timeline!

		if (sentenceTimeline.length == 0) {
			throw new Error("Segment has no sentence entries")
		}

		for (const sentenceEntry of sentenceTimeline) {
			const wordTimeline = sentenceEntry.timeline!

			if (wordTimeline.length == 0) {
				throw new Error("Sentence has no word entries")
			}

			sentenceEntry.startTime = wordTimeline[0].startTime
			sentenceEntry.endTime = wordTimeline[wordTimeline.length - 1].endTime
		}

		segmentEntry.text = sentenceTimeline.map(sentenceEntry => sentenceEntry.text).join(" ")

		segmentEntry.startTime = sentenceTimeline[0].startTime
		segmentEntry.endTime = sentenceTimeline[sentenceTimeline.length - 1].endTime
	}

	return { segmentTimeline }
}

export type TimelineEntryType = "segment" | "paragraph" | "sentence" | "clause" | "phrase" | "word" | "token" | "letter" | "phone" | "subphone"

export type TimelineEntry = {
	type: TimelineEntryType

	text: string,

	startTime: number,
	endTime: number,

	timeline?: Timeline

	startSample?: number
	endSample?: number

	textStartOffset?: number
	textEndOffset?: number

	confidence?: number
}

export type Timeline = TimelineEntry[]
