import { ParagraphBreakType, WhitespaceProcessing } from '../api/Common.js'
import { applyWhitespaceProcessing, isWord, isWordOrSymbolWord, splitToParagraphs, splitToSentences, splitToWords } from '../nlp/Segmentation.js'
import { deepClone } from './ObjectUtilities.js'
import { getUTF32Chars, splitAndPreserveSeparators } from './StringUtilities.js'
import { roundToDigits } from './Utilities.js'

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
	let segments: string[][] = []

	{
		// Ensure word entries with words that include potential sentence ending characters,
		// like '.', '?' or '!', aren't causing the sentence segmentation
		// to identify them as sentence breaks.
		const maskedTranscript = replaceSentenceEndersWithinWordsWithMaskingCharacter(transcript, wordTimeline, '_')

		// Split to segments and sentences, based on the masked transcript,
		// don't apply any whitespace processing yet.
		let paragraphs: string[]

		if (paragraphBreaks === 'single') {
			paragraphs = splitAndPreserveSeparators(maskedTranscript, /(\r?\n)+/g)
		} else if (paragraphBreaks === 'double') {
			paragraphs = splitAndPreserveSeparators(maskedTranscript, /(\r?\n)(\r?\n)+/g)
		} else {
			throw new Error(`Invalid paragraph break type: '${paragraphBreaks}'`)
		}

		const maskedSegments = paragraphs.map(paragraph => splitToSentences(paragraph, language))

		// Restore the sentence text the original text, using the original transcript,
		// and apply whitespace processing to each sentence.
		let offset = 0

		for (const segment of maskedSegments) {
			const newSegment: string[] = []

			for (let sentenceIndex = 0; sentenceIndex < segment.length; sentenceIndex++) {
				const sentence = segment[sentenceIndex]
				const sentenceLength = sentence.length

				const restoredSentence = transcript.substring(offset, offset + sentenceLength)
				const restoredAndProcessedSentence = applyWhitespaceProcessing(restoredSentence, whitespace).trim()

				if (restoredAndProcessedSentence.length > 0) {
					newSegment.push(restoredAndProcessedSentence)
				}

				offset += sentenceLength
			}

			segments.push(newSegment)
		}

		segments = segments.filter(segment => segment.length > 0)
	}

	// Create a new text based on the processed sentences, new segment and sentence timeline,
	// and store mapping between character indexes and the corresponding sentence they belong to.
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

	// Add the word entries to their corresponding sentence timelines
	{
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
	}

	// Produce a new segment/sentence timeline with rewritten entries,
	// that match the assigned words.
	const newSegmentTimeline: Timeline = []

	for (const segmentEntry of segmentTimeline) {
		const oldSentenceTimeline = segmentEntry.timeline!

		const newSentenceTimeline: Timeline = []

		for (const sentenceEntry of oldSentenceTimeline) {
			const wordTimeline = sentenceEntry.timeline

			if (!wordTimeline || wordTimeline.length === 0) {
				continue
			}

			sentenceEntry.startTime = wordTimeline[0].startTime
			sentenceEntry.endTime = wordTimeline[wordTimeline.length - 1].endTime

			newSentenceTimeline.push(sentenceEntry)
		}

		if (newSentenceTimeline.length === 0) {
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

function replaceSentenceEndersWithinWordsWithMaskingCharacter(transcript: string, wordTimeline: Timeline, maskingCharacter: string) {
	if (maskingCharacter.length !== 1) {
		throw new Error(`Masking character must be of length 1`)
	}

	let modifiedTranscript = transcript

	const sentenceEnders = ['.', '。', '?', '？', '!', '！', '|']

	for (const wordEntry of wordTimeline) {
		const wordText = wordEntry.text

		if (!isWord(wordText)) {
			continue
		}

		let newWordText = ''
		let charIndex = 0

		for (const char of wordText) {
			const isFirstChar = charIndex === 0
			const isLastChar = charIndex + char.length === wordText.length
			const isFirstOrLastChar = isFirstChar || isLastChar

			if (!isLastChar && sentenceEnders.includes(char)) {
				for (let i = 0; i < char.length; i++) {
					newWordText += maskingCharacter
				}
			} else {
				newWordText += char
			}

			charIndex += char.length
		}

		if (newWordText !== wordText) {
			const wordStartOffset = wordEntry.startOffsetUtf16!
			const wordEndOffset = wordEntry.endOffsetUtf16!

			modifiedTranscript =
				modifiedTranscript.substring(0, wordStartOffset) +
				newWordText +
				modifiedTranscript.substring(wordEndOffset)
		}
	}

	return modifiedTranscript
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

////

export async function testTimelineFix() {
	let transcript = 'Hello world how are you? Do you want to play chess?'
	const words = (await splitToWords(transcript, 'en')).filter(word => word.trim() !== '')

	let wordTimeline: Timeline = words.map(wordText => ({
		type: 'word',

		text: wordText,

		startTime: 0,
		endTime: 0,
	}))

	addWordTextOffsetsToTimeline(wordTimeline, transcript)

	wordTimeline[1].text = 'wor.d'
	wordTimeline[8].text = 'wa.t'

	transcript = transcript.replace('world', 'wor.d').replace('want', 'wa.t')

	const result = await wordTimelineToSegmentSentenceTimeline(wordTimeline, transcript, 'en')

	const x = 1
}
