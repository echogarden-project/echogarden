import { addMissingPunctuationWordsToWordSequence, segmentWordSequence, WordSequence } from '@echogarden/text-segmentation'
import { ParagraphBreakType, WhitespaceProcessing } from '../api/Common.js'
import { applyWhitespaceProcessing, isWord, isWordOrSymbolWord, splitToParagraphs } from '../nlp/Segmentation.js'
import { deepClone } from './ObjectUtilities.js'
import { getUTF32Chars } from './StringUtilities.js'
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

export async function wordTimelineToSegmentSentenceTimeline(wordTimelineWithOffsets: Timeline, transcript: string, language: string, paragraphBreaks: ParagraphBreakType = 'double', whitespace: WhitespaceProcessing = 'preserve') {
	const wordSequence = new WordSequence()

	for (const wordEntry of wordTimelineWithOffsets) {
		const wordStartOffset = wordEntry.startOffsetUtf16!
		const wordEndOffset = wordEntry.endOffsetUtf16!

		const isPunctuation = !isWordOrSymbolWord(wordEntry.text)

		wordSequence.addWord(wordEntry.text, wordStartOffset, isPunctuation)
	}

	const { wordSequenceWithPunctuation, originalWordsReverseMapping } = addMissingPunctuationWordsToWordSequence(wordSequence, transcript)

	const segmentedWordSequence = await segmentWordSequence(wordSequenceWithPunctuation)

	const segmentSentenceRanges = segmentedWordSequence.segmentSentenceRanges

	const segmentTimeline: Timeline = []
	let wordIndex = 0

	let lastKnownTimestamp = wordTimelineWithOffsets?.[0].startTime ?? 0

	let segmentText = ''
	let sentenceTimeline: Timeline = []

	for (const segmentSentenceRange of segmentSentenceRanges) {
		for (let sentenceIndex = segmentSentenceRange.start; sentenceIndex < segmentSentenceRange.end; sentenceIndex++) {
			const sentenceEntry = segmentedWordSequence.sentences[sentenceIndex]
			const wordTimeline: Timeline = []

			for (const _ of sentenceEntry.words.entries) {
				const originalWordIndex = originalWordsReverseMapping.get(wordIndex)

				if (originalWordIndex !== undefined) {
					const wordTimelineEntry = wordTimelineWithOffsets[originalWordIndex]

					wordTimeline.push(wordTimelineEntry)

					lastKnownTimestamp = wordTimelineEntry.endTime ?? lastKnownTimestamp
				}

				wordIndex += 1
			}

			const sentenceText = sentenceEntry.text

			const sentenceTimelineEntry: TimelineEntry = {
				type: 'sentence',
				text: sentenceText,
				startTime: wordTimeline[0]?.startTime ?? lastKnownTimestamp,
				endTime: wordTimeline[wordTimeline.length - 1]?.endTime ?? lastKnownTimestamp,

				timeline: wordTimeline,
			}

			sentenceTimeline.push(sentenceTimelineEntry)
			segmentText += sentenceText
		}

		if (paragraphBreaks === 'single' ||
			segmentSentenceRange.end === segmentedWordSequence.sentences.length ||
			/\r?\n\r?\n$/.test(segmentText)) {

			const segmentTimelineEntry: TimelineEntry = {
				type: 'segment',
				text: applyWhitespaceProcessing(segmentText, whitespace),
				startTime: sentenceTimeline[0]?.startTime ?? lastKnownTimestamp,
				endTime: sentenceTimeline[sentenceTimeline.length - 1]?.endTime ?? lastKnownTimestamp,

				timeline: sentenceTimeline,
			}

			segmentTimeline.push(segmentTimelineEntry)

			segmentText = ''
			sentenceTimeline = []
		}
	}

	return { segmentTimeline }
}

export function addWordTextOffsetsToTimelineInPlace(timeline: Timeline, text: string) {
	const { utf16To32Mapping } = getUTF32Chars(text)

	let currentOffset = 0

	function processTimeline(timeline: Timeline) {
		let lastEndOffset = 0

		for (const entry of timeline) {
			if (entry.type === 'word') {
				let word = entry.text

				word = word.trim().replaceAll(/\s+/g, ' ')

				const wordParts = word.split(' ')

				let startOffset: number | undefined
				let endOffset: number | undefined

				for (let i = 0; i < wordParts.length; i++) {
					const wordPart = wordParts[i]

					const wordPartOffset = text.indexOf(wordPart, currentOffset)

					if (wordPartOffset === -1) {
						continue
					}

					currentOffset = wordPartOffset + wordParts[i].length

					if (i === 0) {
						startOffset = wordPartOffset
					}

					endOffset = currentOffset
				}

				entry.startOffsetUtf16 = startOffset ?? lastEndOffset
				entry.endOffsetUtf16 = endOffset ?? lastEndOffset

				entry.startOffsetUtf32 = utf16To32Mapping[entry.startOffsetUtf16]
				entry.endOffsetUtf32 = utf16To32Mapping[entry.endOffsetUtf16]

				if (endOffset !== undefined) {
					lastEndOffset = endOffset
				}
			} else if (entry.timeline) {
				processTimeline(entry.timeline)
			}
		}
	}

	return processTimeline(timeline)
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
