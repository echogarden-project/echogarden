import { htmlToText } from 'html-to-text'

import { secondsToHMS, secondsToMS } from '../utilities/Utilities.js'
import { isWordOrSymbolWord } from '../nlp/Segmentation.js'
import { charactersToWriteAhead } from '../audio/AudioPlayer.js'
import { Timeline, TimelineEntry } from '../utilities/Timeline.js'
import { readFileAsUtf8 } from '../utilities/FileSystem.js'
import { deepClone } from '../utilities/ObjectUtilities.js'
import { formatHMS, formatMS, startsWithAnyOf } from '../utilities/StringUtilities.js'

export async function subtitlesFileToText(filename: string) {
	return subtitlesToText(await readFileAsUtf8(filename))
}

export function subtitlesToText(subtitles: string) {
	return subtitlesToTimeline(subtitles, true).map(entry => entry.text).join(' ')
}

export function subtitlesToTimeline(subtitles: string, removeMarkup = true) {
	const lines = subtitles.split(/\r?\n/)

	const timeline: Timeline = []

	let isWithinCue = false

	// Parse lines of subtitles text
	for (let line of lines) {
		line = line.trim()

		if (line.length == 0) {
			isWithinCue = false

			continue
		}

		let result = tryParseTimeRangePatternWithHours(line)

		if (!result.succeeded) {
			result = tryParseTimeRangePatternWithoutHours(line)
		}

		if (result.succeeded) {
			timeline.push({
				type: 'segment',
				startTime: result.startTime,
				endTime: result.endTime,
				text: ''
			})

			isWithinCue = true
		} else if (isWithinCue && timeline.length > 0) {
			const lastEntry = timeline[timeline.length - 1]

			if (lastEntry.text == '') {
				lastEntry.text = line
			} else {
				lastEntry.text += ' ' + line
			}
		}
	}

	if (!removeMarkup) {
		return timeline
	}

	// Remove markup in each entry text
	const timelineWithoutMarkup = timeline.map((entry) => {
		let plainText: string = entry.text

		plainText = plainText.replaceAll(/<[^>]*>/g, '')

		plainText = htmlToText(plainText, { wordwrap: false })

		plainText = plainText.replaceAll(/\s+/g, ' ').trim()

		return { ...entry, text: plainText }
	})

	return timelineWithoutMarkup
}

export function timelineToSubtitles(timeline: Timeline, subtitlesConfig?: SubtitlesConfig) {
	// Prepare subtitle configuration
	timeline = deepClone(timeline)

	let config = subtitlesConfig || {}

	if (config.format && config.format == 'webvtt') {
		config = { ...defaultSubtitlesBaseConfig, ...webVttConfigExtension, ...config }
	} else {
		config = { ...defaultSubtitlesBaseConfig, ...srtConfigExtension, ...config }
	}

	// Initialize subtitle file content
	const lineBreakString = config.lineBreakString

	let outText = ''

	if (config.format == 'webvtt') {
		outText += `WEBVTT${lineBreakString}Kind: captions${lineBreakString}`

		if (config.language) {
			outText += `Language: ${config.language}${lineBreakString}`
		}

		outText += lineBreakString
	}

	// Generate the cues from the given timeline
	let cues: Cue[]

	if (config.mode == 'segment' || config.mode == 'sentence') {
		cues = getCuesFromTimeline_IsolateSegmentSentence(timeline, config)
	} else if (config.mode == 'word' || config.mode == 'phone' || config.mode == 'word+phone') {
		cues = getCuesFromTimeline_IsolateWordPhone(timeline, config)
	} else if (config.mode == 'line') {
		cues = getCuesFromTimeline_IsolateLines(timeline, config)
	} else {
		throw new Error('Invalid subtitles mode.')
	}

	// Extend cue end times with maximum added duration, if possible
	if (cues.length > 0 &&
		config.maxAddedDuration! > 0 &&
		(config.mode === 'segment' || config.mode === 'sentence' || config.mode === 'line')) {

		for (let i = 1; i < cues.length; i++) {
			const currentCue = cues[i]
			const previousCue = cues[i - 1]

			previousCue.endTime = Math.min(previousCue.endTime + config.maxAddedDuration!, currentCue.startTime)
		}

		if (config.totalDuration != null) {
			const lastCue = cues[cues.length - 1]

			lastCue.endTime = Math.min(lastCue.endTime + config.maxAddedDuration!, config.totalDuration)
		}
	}

	// Write cues to output text
	for (let cueIndex = 0; cueIndex < cues.length; cueIndex++) {
		outText += cueObjectToText(cues[cueIndex], cueIndex + 1, config)
	}

	return outText
}

// Generates subtitle cues from timeline. Ensures each segment or sentence starts in a new cue.
function getCuesFromTimeline_IsolateSegmentSentence(timeline: Timeline, config: SubtitlesConfig) {
	if (timeline.length == 0) {
		return []
	}

	// If the given timeline is a word timeline, wrap it with a segment and call again
	if (timeline[0].type == 'word') {
		const wordTimeline = timeline.filter(entry => isWordOrSymbolWord(entry.text))

		const text = wordTimeline.map(entry => entry.text).join(' ')

		const segmentEntry: TimelineEntry = {
			type: 'segment',
			text: text,
			startTime: wordTimeline[0].startTime,
			endTime: wordTimeline[wordTimeline.length - 1].endTime,
			timeline: wordTimeline
		}

		return getCuesFromTimeline_IsolateSegmentSentence([segmentEntry], config)
	}

	const cues: Cue[] = []

	// Generate one or more cues from each segment or sentence in the timeline.
	for (let entry of timeline) {
		if (entry.type == 'segment' && entry.timeline?.[0].type == 'sentence') {
			if (config.mode == 'segment') {
				// If the mode is 'segment', flatten all sentences to a single word timeline
				entry.timeline = entry.timeline!.flatMap(t => t.timeline!)
			} else {
				cues.push(...getCuesFromTimeline_IsolateSegmentSentence(entry.timeline!, config))

				continue
			}
		}

		const entryText = entry.text
		const maxLineWidth = config.maxLineWidth!

		if (entryText.length <= maxLineWidth) {
			cues.push({
				lines: [entryText],
				startTime: entry.startTime,
				endTime: entry.endTime
			})

			continue
		}

		if (!entry.timeline || entry.timeline?.[0]?.type != 'word') {
			continue
		}

		const wordTimeline = entry.timeline!.filter(entry => isWordOrSymbolWord(entry.text))

		// First, add word start and end offsets for all word entries
		let lastWordEndOffset = 0
		for (const wordEntry of wordTimeline) {
			const wordStartOffset = entryText.indexOf(wordEntry.text, lastWordEndOffset)

			if (wordStartOffset == -1) {
				throw new Error(`Couldn't find word '${wordEntry.text}' in its parent entry text`)
			}

			let wordEndOffset = wordStartOffset + wordEntry.text.length
			lastWordEndOffset = wordEndOffset

			wordEntry.startOffsetUtf16 = wordStartOffset
			wordEntry.endOffsetUtf16 = wordEndOffset
		}

		// Add cues
		let currentCue: Cue = {
			lines: [],
			startTime: -1,
			endTime: -1
		}

		let lineStartWordOffset = 0
		let lineStartOffset = 0

		for (let wordIndex = 0; wordIndex < wordTimeline.length; wordIndex++) {
			const isLastWord = wordIndex == wordTimeline.length - 1

			const wordEntry = wordTimeline[wordIndex]
			const wordEndOffset = wordEntry.endOffsetUtf16!

			function getExtendedEndOffset(offset: number | undefined) {
				if (offset == undefined) {
					return entryText.length
				}

				while (charactersToWriteAhead.includes(entryText[offset])) {
					offset += 1
				}

				return offset
			}

			const wordExtendedEndOffset = getExtendedEndOffset(wordEndOffset)

			const nextWordEntry = wordTimeline[wordIndex + 1]
			const nextWordExtendedEndOffset = getExtendedEndOffset(nextWordEntry?.endOffsetUtf16)

			// Decide if to add to a new line
			const lineLength = wordExtendedEndOffset - lineStartOffset
			const lineLengthWithNextWord = nextWordExtendedEndOffset - lineStartOffset
			const wordsRemaining = wordTimeline.length - wordIndex - 1

			const phraseSeparators = [',', '，', '、', ';', ':', '),', '",', '”,', '.', '".', '”.', '."', '.”', '。']

			const lineLengthWithNextWordExceedsMaxLineWidth = lineLengthWithNextWord >= maxLineWidth
			const lineLengthExceedsHalfMaxLineWidth = lineLength >= maxLineWidth / 2

			const wordsRemainingAreEqualOrLessToMinimumWordsInLine = wordsRemaining <= config.minWordsInLine!
			const remainingTextExceedsMaxLineWidth = entryText.length - lineStartOffset > maxLineWidth
			const followingSubstringIsPhraseSeparator = startsWithAnyOf(entryText.substring(wordEndOffset), phraseSeparators)

			const shouldAddNewLine =
				isLastWord ||
				lineLengthWithNextWordExceedsMaxLineWidth ||
				(remainingTextExceedsMaxLineWidth &&
					lineLengthExceedsHalfMaxLineWidth &&
					(wordsRemainingAreEqualOrLessToMinimumWordsInLine || (config.separatePhrases && followingSubstringIsPhraseSeparator)))

			// If it was decided to add a new line
			if (shouldAddNewLine) {
				// Extend line end offset to end of sentence entry if last word encountered
				let lineEndOffset: number

				if (isLastWord) {
					lineEndOffset = entryText.length
				} else {
					lineEndOffset = wordExtendedEndOffset
				}

				// Get line text
				const lineText = entryText.substring(lineStartOffset, lineEndOffset)

				// Find start and end times of line
				const nextWordStartTime = isLastWord ? entry.endTime : wordTimeline[wordIndex + 1].startTime

				const lineStartTime = wordTimeline[lineStartWordOffset].startTime
				const lineEndTime = nextWordStartTime

				// Add new line to cue
				currentCue.lines.push(lineText)

				// Update cue start and end times
				if (currentCue.startTime == -1) {
					currentCue.startTime = lineStartTime
				}

				currentCue.endTime = lineEndTime

				// Finalize cue if needed
				if (isLastWord || currentCue.lines.length == config.maxLineCount) {
					cues.push(currentCue)

					currentCue = {
						lines: [],
						startTime: -1,
						endTime: -1
					}
				}

				// Update offsets
				lineStartOffset = lineEndOffset
				lineStartWordOffset = wordIndex + 1
			}
		}
	}

	return cues
}

// Generates cues from timeline. Isolates words or phones in individual cues.
function getCuesFromTimeline_IsolateWordPhone(timeline: Timeline, config: SubtitlesConfig) {
	if (timeline.length == 0) {
		return []
	}

	const mode = config.mode!

	const cues: Cue[] = []

	for (const entry of timeline) {
		const entryIsWord = entry.type == 'word'
		const entryIsPhone = entry.type == 'phone'

		const shouldIncludeEntry =
			(entryIsWord && (mode == 'word' || mode == 'word+phone')) ||
			(entryIsPhone && (mode == 'phone' || mode == 'word+phone'))

		if (shouldIncludeEntry) {
			cues.push({
				lines: [entry.text],
				startTime: entry.startTime,
				endTime: entry.endTime,
			})
		}

		if (entry.timeline) {
			cues.push(...getCuesFromTimeline_IsolateWordPhone(entry.timeline, config))
		}
	}

	return cues
}

// Generates cues from timeline. Isolates lines in individual cues.
function getCuesFromTimeline_IsolateLines(timeline: Timeline, config: SubtitlesConfig) {
	if (timeline.length == 0) {
		return []
	}

	const originalText = config.originalText

	if (originalText == null) {
		throw new Error(`'line' subtitles mode requires passing the original text in the 'originalText' property of the configuration object.`)
	}

	const lines = originalText.split(/(\r?\n)/g)

	const charOffsetToLineNumber: number[] = []

	for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
		const line = lines[lineNumber]

		for (let i = 0; i < line.length; i++) {
			charOffsetToLineNumber.push(lineNumber)
		}
	}

	const cues: Cue[] = []

	let currentCueWords: Timeline = []

	function addCueFromCurrentWords() {
		if (currentCueWords.length == 0) {
			return
		}

		const firstWordEntry = currentCueWords[0]
		const lastWordEntry = currentCueWords[currentCueWords.length - 1]

		const lineNumber = charOffsetToLineNumber[firstWordEntry.startOffsetUtf16!]
		const line = lines[lineNumber].trim()

		cues.push({
			lines: [line],
			startTime: firstWordEntry.startTime,
			endTime: lastWordEntry.endTime
		})

		currentCueWords = []
	}

	function addCuesFrom(timeline: Timeline) {
		for (const entry of timeline) {
			if (entry.type == 'word') {
				const currentWordLineNumber = charOffsetToLineNumber[entry.startOffsetUtf16!]
				const previousWordEntry = currentCueWords[currentCueWords.length - 1]

				if (previousWordEntry) {
					const previousWordLineNumber = charOffsetToLineNumber[previousWordEntry.startOffsetUtf16!]

					if (currentWordLineNumber > previousWordLineNumber) {
						addCueFromCurrentWords()
					}
				}

				currentCueWords.push(entry)
			} else if (entry.timeline) {
				addCuesFrom(entry.timeline)
			}
		}
	}

	addCuesFrom(timeline)
	addCueFromCurrentWords() // Add any remaining words

	return cues
}

export function tryParseTimeRangePatternWithHours(line: string) {
	const timeRangePatternWithHours = /^(\d+)\:(\d+)\:(\d+)[\.,](\d+)[ ]*-->[ ]*(\d+)\:(\d+)\:(\d+)[\.,](\d+)/
	const match = timeRangePatternWithHours.exec(line)

	if (!match) {
		return { startTime: -1, endTime: -1, succeeded: false }
	}

	const startHours = parseInt(match[1])
	const startMinutes = parseInt(match[2])
	const startSeconds = parseInt(match[3])
	const startMilliseconds = parseInt(match[4])

	const endHours = parseInt(match[5])
	const endMinutes = parseInt(match[6])
	const endSeconds = parseInt(match[7])
	const endMilliseconds = parseInt(match[8])

	const startTime = (startMilliseconds / 1000) + (startSeconds) + (startMinutes * 60) + (startHours * 60 * 60)
	const endTime = (endMilliseconds / 1000) + (endSeconds) + (endMinutes * 60) + (endHours * 60 * 60)

	return { startTime, endTime, succeeded: true }
}

export function tryParseTimeRangePatternWithoutHours(line: string) {
	const timeRangePatternWithHours = /^(\d+)\:(\d+)[\.,](\d+)[ ]*-->[ ]*(\d+)\:(\d+)[\.,](\d+)/
	const match = timeRangePatternWithHours.exec(line)

	if (!match) {
		return { startTime: -1, endTime: -1, succeeded: false }
	}

	const startMinutes = parseInt(match[1])
	const startSeconds = parseInt(match[2])
	const startMilliseconds = parseInt(match[3])

	const endMinutes = parseInt(match[4])
	const endSeconds = parseInt(match[5])
	const endMilliseconds = parseInt(match[6])

	const startTime = (startMilliseconds / 1000) + (startSeconds) + (startMinutes * 60)
	const endTime = (endMilliseconds / 1000) + (endSeconds) + (endMinutes * 60)

	return { startTime, endTime, succeeded: true }
}

function cueObjectToText(cue: Cue, cueIndex: number, config: SubtitlesConfig) {
	if (!cue || !cue.lines || cue.lines.length == 0) {
		throw new Error(`Cue is empty`)
	}

	const lineBreakString = config.lineBreakString

	let outText = ''

	if (config.includeCueIndexes) {
		outText += `${cueIndex}${lineBreakString}`
	}

	let formattedStartTime: string
	let formattedEndTime: string

	if (config.includeHours == true) {
		formattedStartTime = formatHMS(secondsToHMS(cue.startTime), config.decimalSeparator)
		formattedEndTime = formatHMS(secondsToHMS(cue.endTime), config.decimalSeparator)
	} else {
		formattedStartTime = formatMS(secondsToMS(cue.startTime), config.decimalSeparator)
		formattedEndTime = formatMS(secondsToMS(cue.endTime), config.decimalSeparator)
	}

	outText += `${formattedStartTime} --> ${formattedEndTime}`
	outText += `${lineBreakString}`

	outText += cue.lines.map(line => line.trim()).join(lineBreakString)

	outText += `${lineBreakString}`
	outText += `${lineBreakString}`

	return outText
}

export type Cue = {
	lines: string[]
	startTime: number
	endTime: number
}

export type SubtitlesMode = 'line' | 'segment' | 'sentence' | 'word' | 'phone' | 'word+phone'

export interface SubtitlesConfig {
	format?: 'srt' | 'webvtt'
	language?: string
	mode?: SubtitlesMode

	maxLineCount?: number
	maxLineWidth?: number
	minWordsInLine?: number
	separatePhrases?: boolean
	maxAddedDuration?: number

	decimalSeparator?: ',' | '.'
	includeCueIndexes?: boolean
	includeHours?: boolean
	lineBreakString?: '\n' | '\r\n'

	originalText?: string
	totalDuration?: number
}

export const defaultSubtitlesBaseConfig: SubtitlesConfig = {
	format: 'srt',
	mode: 'sentence',

	maxLineCount: 2,
	maxLineWidth: 42,
	minWordsInLine: 4,
	separatePhrases: true,
	maxAddedDuration: 3.0,
}

export const srtConfigExtension: SubtitlesConfig = {
	decimalSeparator: ',',
	includeCueIndexes: true,
	includeHours: true,
	lineBreakString: '\n',
}

export const webVttConfigExtension: SubtitlesConfig = {
	decimalSeparator: '.',
	includeCueIndexes: false,
	includeHours: true,
	lineBreakString: '\n',
}
