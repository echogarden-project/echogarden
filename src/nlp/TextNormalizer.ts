import { getShortLanguageCode } from '../utilities/Locale.js'
import { substituteCharactersUsingLookup } from '../utilities/StringUtilities.js'

export function getNormalizedFragmentsForSpeech(
	words: string[],
	nonWhitespaceWords: string[],
	nonWhitespaceWordOriginalIndex: number[],
	language: string) {

	language = getShortLanguageCode(language)

	if (language != 'en') {
		return { normalizedFragments: [...nonWhitespaceWords], referenceFragments: [...nonWhitespaceWords] }
	}

	const numberPattern = /^[0-9][0-9\,\.]*$/

	const fourDigitYearPattern = /^[0-9][0-9][0-9][0-9]$/
	const fourDigitDecadePattern = /^[0-9][0-9][0-9]0s$/

	const fourDigitYearRangePattern = /^[0-9][0-9][0-9][0-9][\-\–][0-9][0-9][0-9][0-9]$/

	const wordsPrecedingAYear = [
		'in', 'the', 'a', 'to', 'of', 'since', 'from', 'between', 'by', 'until', 'around', 'before', 'after',
		'his', 'her', 'year', 'years', 'during', 'copyright', '©', 'early', 'mid', 'late',
		'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
		'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
	]

	const wordsPrecedingADecade = [
		'the', 'in', 'early', 'mid', 'late', 'a'
	]

	const symbolsPrecedingACurrency = [
		'$', '€', '£', '¥'
	]

	const symbolsPrecedingACurrencyAsWords = [
		'dollars', 'euros', 'pounds', 'yen'
	]

	const wordsSucceedingACurrency = [
		'million', 'billion', 'trillion'
	]

	const normalizedFragments: string[] = []
	const referenceFragments: string[] = []

	for (let wordIndex = 0; wordIndex < nonWhitespaceWords.length; wordIndex++) {
		const word = nonWhitespaceWords[wordIndex]
		const lowerCaseWord = word.toLowerCase()

		const nextNonWhitespaceWords = nonWhitespaceWords.slice(wordIndex + 1)
		const nextNonWhitespaceWord = nextNonWhitespaceWords[0]

		const originalWordIndex = nonWhitespaceWordOriginalIndex[wordIndex]
		const isFollowedByWhitespace = words[originalWordIndex + 1]?.trim().length === 0

		if ( // Normalize a four digit year pattern, e.g. 'in 1995'.
			wordsPrecedingAYear.includes(lowerCaseWord) &&
			isFollowedByWhitespace &&
			fourDigitYearPattern.test(nextNonWhitespaceWord)) {

			const normalizedString = normalizeFourDigitYearString(nextNonWhitespaceWord)

			normalizedFragments.push(word)
			referenceFragments.push(word)

			normalizedFragments.push(normalizedString)
			referenceFragments.push(nextNonWhitespaceWord)

			wordIndex += 1
		} else if ( // Normalize a four digit decade pattern, e.g. 'the 1980s'.
			wordsPrecedingADecade.includes(lowerCaseWord) &&
			isFollowedByWhitespace &&
			fourDigitDecadePattern.test(nextNonWhitespaceWord)) {

			const normalizedString = normalizeFourDigitDecadeString(nextNonWhitespaceWord)

			normalizedFragments.push(word)
			referenceFragments.push(word)

			normalizedFragments.push(normalizedString)
			referenceFragments.push(nextNonWhitespaceWord)

			wordIndex += 1
		} else if ( // Normalize a year range pattern, e.g. '1835-1896', ensure there are no spaces between words
			fourDigitYearRangePattern.test(words.slice(originalWordIndex, originalWordIndex + 3).join(''))) {

			normalizedFragments.push(normalizeFourDigitYearString(nonWhitespaceWords[wordIndex]))
			referenceFragments.push(nonWhitespaceWords[wordIndex])

			normalizedFragments.push('to')
			referenceFragments.push(nonWhitespaceWords[wordIndex + 1])

			normalizedFragments.push(normalizeFourDigitYearString(nonWhitespaceWords[wordIndex + 2]))
			referenceFragments.push(nonWhitespaceWords[wordIndex + 2])

			wordIndex += 2
		} else if ( // Normalize a currency pattern, e.g. '$53.1 million', '€3.53'
			symbolsPrecedingACurrency.includes(lowerCaseWord) &&
			!isFollowedByWhitespace &&
			numberPattern.test(nextNonWhitespaceWord)) {

			let currencyWord = symbolsPrecedingACurrencyAsWords[symbolsPrecedingACurrency.indexOf(lowerCaseWord)]

			if (wordsSucceedingACurrency.includes(nextNonWhitespaceWords[1]?.toLowerCase())) {
				const normalizedString = `${nextNonWhitespaceWord} ${nextNonWhitespaceWords[1]} ${currencyWord}`

				normalizedFragments.push(normalizedString)

				const referenceString = `${word}${nextNonWhitespaceWord} ${nextNonWhitespaceWords[1]}`
				referenceFragments.push(referenceString)

				wordIndex += 2
			} else {
				const normalizedString = `${nextNonWhitespaceWord} ${currencyWord}`

				normalizedFragments.push(normalizedString)

				const referenceString = `${word}${nextNonWhitespaceWord}`
				referenceFragments.push(referenceString)

				wordIndex += 1
			}
		} else {
			normalizedFragments.push(word)
			referenceFragments.push(word)
		}
	}

	return { normalizedFragments, referenceFragments }
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
	const firstTwoDigitsValue = parseInt(decadeString.substring(0, 2))
	const secondTwoDigitsValue = parseInt(decadeString.substring(2, 4))

	let normalizedString: string

	const isBeforeSecondMillenium = firstTwoDigitsValue < 10
	const isMilleniumDecade =  firstTwoDigitsValue % 10 == 0 && secondTwoDigitsValue == 0

	if (!isBeforeSecondMillenium && !isMilleniumDecade) {
		if (secondTwoDigitsValue != 0) {
			normalizedString = `${firstTwoDigitsValue} ${secondTwoDigitsValue}s`
		} else {
			normalizedString = `${firstTwoDigitsValue} hundreds`
		}
	} else {
		normalizedString = decadeString
	}

	return normalizedString
}

export function simplifyPunctuationCharacters(text: string) {
	return substituteCharactersUsingLookup(text, punctuationSubstitutionLookup)
}

export const punctuationSubstitutionLookup: Record<string, string> = {
	'“': `"`,
	'”': `"`,
	'‟': `"`,
	'ˮ': `"`,
	'„': `"`,
	'‹': `"`,
	'›': `"`,
	'❮': `"`,
	'❯': '"',
	'«': `"`,
	'»': `"`,
	'״': `"`,
	'❝': `"`,
	'❞': `"`,
	'🙶': `"`,
	'🙷': `"`,
	'⹂': `"`,
	'〝': `"`,
	'〞': `"`,
	'〟': `"`,
	'＂': `"`,
	'❠': `"`,
	'🙸': `"`,

	'ߵ': `'`,
	'ߴ': `'`,
	'’': `'`,
	'‘': `'`,
	'ʹ': `'`,
	'ʼ': `'`,
	'＇': `'`,
	'ʻ': `'`,
	'՚': `'`,
	'՛': `'`,
	'❛': `'`,
	'❜': `'`,
	'❟': `'`,

	'，': `,`,
	'、': `,`,

	'：': `:`,

	'；': `;`,

	'。': `.`,

	'？': `?`,
	'؟': `?`,

	'！': `!`,
	'¡': `!`,
}
