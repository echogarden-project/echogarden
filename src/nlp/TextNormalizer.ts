import { getShortLanguageCode } from "../utilities/Locale.js"
import { CompromiseParsedSentence } from "./CompromiseNLP.js"

export function getNormalizationMapForSpeech(terms: CompromiseParsedSentence, language: string) {
	language = getShortLanguageCode(language)

	const normalizationMap = new Map<number, string>()

	if (language != "en") {
		return normalizationMap
	}

	const numberPattern = /^[0-9][0-9\,\.]*$/

	const fourDigitYearPattern = /^[0-9][0-9][0-9][0-9]$/
	const fourDigitDecadePattern = /^[0-9][0-9][0-9]0s$/

	const fourDigitYearRangePattern = /^[0-9][0-9][0-9][0-9][\-\–][0-9][0-9][0-9][0-9]$/

	for (let termIndex = 0; termIndex < terms.length; termIndex++) {
		const term = terms[termIndex]
		const termText = term.text
		const lowerCaseTermText = termText.toLocaleLowerCase()

		const nextTerms = terms.slice(termIndex + 1)
		const nextTerm = nextTerms[0]
		const nextTermText = nextTerm?.text

		if (
			lowerCaseTermText == "in" &&
			term.postText.length > 0 && term.postText.trim() == "" &&
			fourDigitYearPattern.test(nextTermText)) {

			const normalizedString = normalizeFourDigitYearString(nextTermText)

			normalizationMap.set(termIndex + 1, normalizedString)

			termIndex += 1
		} else if (
			lowerCaseTermText == "the" &&
			term.postText.length > 0 && term.postText.trim() == "" &&
			fourDigitDecadePattern.test(nextTermText)) {

			const normalizedString = normalizeFourDigitDecadeString(nextTermText)

			normalizationMap.set(termIndex + 1, normalizedString)

			termIndex += 1
		} else if (fourDigitYearRangePattern.test(termText)) {
			const startYearString = normalizeFourDigitYearString(termText.substring(0, 4))
			const endYearString = normalizeFourDigitYearString(termText.substring(5, 9))

			const normalizedString = `${startYearString} to ${endYearString}`

			normalizationMap.set(termIndex, normalizedString)
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
