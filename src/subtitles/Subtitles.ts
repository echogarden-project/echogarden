import { convert as convertHtmlToText } from 'html-to-text'

import { formatHMS, formatMS, secondsToHMS, secondsToMS, startsWithAnyOf } from "../utilities/Utilities.js"
import { isWord, isWordOrSymbolWord } from '../nlp/Segmentation.js'
import { charactersToWriteAhead } from '../audio/AudioPlayer.js'
import { Timeline, TimelineEntry } from '../utilities/Timeline.js'
import { readFile } from '../utilities/FileSystem.js'
import { deepClone } from '../utilities/ObjectUtilities.js'

export async function subtitlesFileToText(filename: string) {
	return subtitlesToText(await readFile(filename, "utf8"))
}

export function subtitlesToText(subtitles: string) {
	return subtitlesToTimeline(subtitles, true).map(entry => entry.text).join(" ")
}

export function subtitlesToTimeline(subtitles: string, removeMarkup = true) {
	const lines = subtitles.split(/\r?\n/)

	const timeline: Timeline = []

	let isWithinCue = false

	for (let line of lines) {
		line = line.trim()

		if (line.length == 0) {
			isWithinCue = false
			continue
		}

		function tryParseTimeRangePatternWithHours() {
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

		function tryParseTimeRangePatternWithoutHours() {
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

		let result = tryParseTimeRangePatternWithHours()

		if (!result.succeeded) {
			result = tryParseTimeRangePatternWithoutHours()
		}

		if (result.succeeded) {
			timeline.push({
				type: "segment",
				startTime: result.startTime,
				endTime: result.endTime,
				text: ""
			})

			isWithinCue = true
		} else if (isWithinCue && timeline.length > 0) {
			const lastEntry = timeline[timeline.length - 1]

			if (lastEntry.text == "") {
				lastEntry.text = line
			} else {
				lastEntry.text += " " + line
			}
		}
	}

	if (!removeMarkup) {
		return timeline
	}

	const timelineWithPlainText = timeline.map((entry) => {
		let plainText: string = entry.text
		plainText = plainText.replaceAll(/<[^>]*>/g, "")
		plainText = convertHtmlToText(plainText, { wordwrap: false })
		plainText = plainText.replaceAll(/\s+/g, " ").trim()

		return { ...entry, text: plainText }
	})

	return timelineWithPlainText
}

export function timelineToSubtitles(timeline: Timeline, subtitlesConfig?: SubtitlesConfig, recurse = false) {
	timeline = deepClone(timeline)

	let config = subtitlesConfig || {}

	if (config.format && config.format == "webvtt") {
		config = { ...webVttConfig, ...defaultSubtitlesConfig, ...config }
	} else {
		config = { ...srtConfig, ...defaultSubtitlesConfig, ...config }
	}

	const lineBreakString = config.lineBreakString

	let cueIndex = 1
	let result = ""

	if (config.format == "webvtt") {
		result += `WEBVTT${lineBreakString}Kind: captions${lineBreakString}`

		if (config.language) {
			result += `Language: ${config.language}${lineBreakString}`
		}

		result += lineBreakString
	}

	function writeCue(cue: Cue) {
		if (cue.lines.length == 0) {
			return
		}

		if (config.includeCueIndexes) {
			result += `${cueIndex}${lineBreakString}`
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

		result += `${formattedStartTime} --> ${formattedEndTime}`
		result += `${lineBreakString}`

		result += cue.lines.map(line => line.trim()).join(lineBreakString)

		result += `${lineBreakString}`
		result += `${lineBreakString}`

		cueIndex += 1
	}

	const cues: Cue[] = []

	function addCuesFromTimeline(timeline: Timeline, recurse = false) {
		if (timeline.length == 0) {
			return
		}

		if (timeline[0].type == "word") {
			const wordTimeline = timeline.filter(entry => isWordOrSymbolWord(entry.text))

			const text = wordTimeline.map(entry => entry.text).join(" ")

			const segmentEntry: TimelineEntry = {
				type: "segment",
				text: text,
				startTime: wordTimeline[0].startTime,
				endTime: wordTimeline[wordTimeline.length - 1].endTime,
				timeline: wordTimeline
			}

			addCuesFromTimeline([segmentEntry], recurse)

			return
		}

		for (const entry of timeline) {
			if (entry.type == 'segment' && entry.timeline?.[0].type == 'sentence') {
				addCuesFromTimeline(entry.timeline!, recurse)
				continue
			}

			const entryText = entry.text
			const maxLineWidth = config.maxLineWidth!

			if (entryText.length <= maxLineWidth) {
				cues.push({
					lines: [entryText],
					startTime: entry.startTime,
					endTime: entry.endTime
				})
			} else if (entry.timeline && entry.timeline?.[0].type == "word") {
				const wordTimeline = entry.timeline!.filter(entry => isWord(entry.text))

				let lastWordEndOffset = 0
				for (const wordEntry of wordTimeline) {
					const wordStartOffset = entryText.indexOf(wordEntry.text, lastWordEndOffset)

					if (wordStartOffset == -1) {
						throw new Error(`Couldn't find word '${wordEntry.text}' in its parent entry text`)
					}

					let wordEndOffset = wordStartOffset + wordEntry.text.length
					lastWordEndOffset = wordEndOffset

					wordEntry.textStartOffset = wordStartOffset
					wordEntry.textEndOffset = wordEndOffset
				}

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
					const wordEndOffset = wordEntry.textEndOffset!

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
					const nextWordExtendedEndOffset = getExtendedEndOffset(nextWordEntry?.textEndOffset)

					const lineLength = wordExtendedEndOffset - lineStartOffset
					const lineLengthWithNextWord = nextWordExtendedEndOffset - lineStartOffset
					const wordsRemaining = wordTimeline.length - wordIndex - 1

					const phraseSeparators = [',', '，', '、', ';', ':', '),', '",', '”,']

					const lineLengthWithNextWordExceedsMaxLineWidth = lineLengthWithNextWord >= maxLineWidth
					const lineLengthExceedsHalfMaxLineWidth = lineLength >= maxLineWidth / 2

					const wordsRemainingAreEqualOrLessToMinimumWordsInLine = wordsRemaining <= config.minWordsInLine!
					const remainingTextExceedsMaxLineWidth = entryText.length - lineStartOffset > maxLineWidth
					const followingSubstringIsPhraseSeparator = startsWithAnyOf(entryText.substring(wordEndOffset), phraseSeparators)

					if (isLastWord ||
						lineLengthWithNextWordExceedsMaxLineWidth ||
							(remainingTextExceedsMaxLineWidth &&
							lineLengthExceedsHalfMaxLineWidth &&
							(wordsRemainingAreEqualOrLessToMinimumWordsInLine || followingSubstringIsPhraseSeparator))) {

						let lineEndOffset

						if (isLastWord) {
							lineEndOffset = entryText.length
						} else {
							lineEndOffset = wordExtendedEndOffset
						}

						const lineText = entryText.substring(lineStartOffset, lineEndOffset)

						const nextWordStartTime = isLastWord ? entry.endTime : wordTimeline[wordIndex + 1].startTime

						const lineStartTime = wordTimeline[lineStartWordOffset].startTime
						const lineEndTime = nextWordStartTime

						currentCue.lines.push(lineText)
						if (currentCue.startTime == -1) {
							currentCue.startTime = lineStartTime
						}

						currentCue.endTime = lineEndTime

						if (isLastWord || currentCue.lines.length == config.maxLineCount) {
							cues.push(currentCue)

							currentCue = {
								lines: [],
								startTime: -1,
								endTime: -1
							}
						}

						lineStartOffset = lineEndOffset
						lineStartWordOffset = wordIndex + 1
					}
				}
			} else {
				throw new Error("Found an entry without a word timeline descendant")

				//const lines = splitToFragments(entryText, config.maxLineWidth!, config.language!, true, true).map(line => line.text)
				//writeCue(lines, entry.startTime, entry.endTime, config)
			}

			if (recurse && entry.timeline != null) {
				addCuesFromTimeline(entry.timeline, true)
			}
		}
	}

	addCuesFromTimeline(timeline, recurse)

	for (let i = 1; i < cues.length; i++) {
		const currentCue = cues[i]
		const previousCue = cues[i - 1]

		previousCue.endTime = Math.min(previousCue.endTime + config.maxAddedDuration!, currentCue.startTime)
	}

	for (const cue of cues) {
		writeCue(cue)
	}

	return result
}

export type Cue = {
	lines: string[]
	startTime: number
	endTime: number
}

export const defaultSubtitlesConfig: SubtitlesConfig = {
	format: "srt",
	maxLineCount: 2,
	maxLineWidth: 42,
	minWordsInLine: 4,
	maxAddedDuration: 3,
}

export const srtConfig: SubtitlesConfig = {
	decimalSeparator: ",",
	includeCueIndexes: true,
	includeHours: true,
	lineBreakString: "\n",
}

export const webVttConfig: SubtitlesConfig = {
	decimalSeparator: ".",
	includeCueIndexes: false,
	includeHours: true,
	lineBreakString: "\n",
}

export interface SubtitlesConfig {
	format?: "srt" | "webvtt"
	language?: string
	maxLineCount?: number
	maxLineWidth?: number
	minWordsInLine?: number
	maxAddedDuration?: number

	decimalSeparator?: "," | "."
	includeCueIndexes?: boolean
	includeHours?: boolean
	lineBreakString?: "\n" | "\r\n"
}
