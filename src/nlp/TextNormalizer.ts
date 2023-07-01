import { getShortLanguageCode } from "../utilities/Locale.js"

export function getNormalizationMapForSpeech(words: string[], language: string) {
	language = getShortLanguageCode(language)

	const normalizationMap = new Map<number, string>()

	if (language != "en") {
		return normalizationMap
	}

	const numberPattern = /^[0-9][0-9\,\.]*$/

	const fourDigitYearPattern = /^[0-9][0-9][0-9][0-9]$/
	const fourDigitDecadePattern = /^[0-9][0-9][0-9]0s$/

	const fourDigitYearRangePattern = /^[0-9][0-9][0-9][0-9][\-\–][0-9][0-9][0-9][0-9]$/

	const yearPrecedingWords = [
		"in", "since", "©",
		"january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
		"jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"
	]

	for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
		const word = words[wordIndex]
		const lowerCaseTermText = word.toLocaleLowerCase()

		const nextWords = words.slice(wordIndex + 1)
		const nextWord = nextWords[0]

		if (
			yearPrecedingWords.includes(lowerCaseTermText) &&
			fourDigitYearPattern.test(nextWord)) {
			const normalizedString = normalizeFourDigitYearString(nextWord)

			normalizationMap.set(wordIndex + 1, normalizedString)

			wordIndex += 1
		} else if (
			lowerCaseTermText == "the" &&
			fourDigitDecadePattern.test(nextWord)) {

			const normalizedString = normalizeFourDigitDecadeString(nextWord)

			normalizationMap.set(wordIndex + 1, normalizedString)

			wordIndex += 1
		} else if (fourDigitYearRangePattern.test(word)) {
			const startYearString = normalizeFourDigitYearString(word.substring(0, 4))
			const endYearString = normalizeFourDigitYearString(word.substring(5, 9))

			const normalizedString = `${startYearString} to ${endYearString}`

			normalizationMap.set(wordIndex, normalizedString)
		}
	}

	return normalizationMap
}

export function normalizeFourDigitYearString(yearString: string) {
	const firstTwoDigitsValue = parseFloat(yearString.substring(0, 2))
	const secondTwoDigitsValue = parseFloat(yearString.substring(2, 4))

	let normalizedString: string

	if (firstTwoDigitsValue >= 10 && secondTwoDigitsValue >= 10) {
		normalizedString = `${firstTwoDigitsValue} ${secondTwoDigitsValue}`
	} else if (firstTwoDigitsValue >= 10 && firstTwoDigitsValue % 10 != 0 && secondTwoDigitsValue < 10) {
		normalizedString = `${firstTwoDigitsValue} oh ${secondTwoDigitsValue}`
	} else {
		normalizedString = yearString
	}

	return normalizedString
}

export function normalizeFourDigitDecadeString(decadeString: string) {
	const firstTwoDigitsValue = parseFloat(decadeString.substring(0, 2))
	const secondTwoDigitsValue = parseFloat(decadeString.substring(2, 4))

	let normalizedString: string

	if (firstTwoDigitsValue >= 10 && firstTwoDigitsValue % 10 != 0) {
		normalizedString = `${firstTwoDigitsValue} ${secondTwoDigitsValue}s`
	} else {
		normalizedString = decadeString
	}

	return normalizedString
}
