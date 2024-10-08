import { getShortLanguageCode } from '../utilities/Locale.js'
import { substituteCharactersUsingLookup } from '../utilities/StringUtilities.js'

export function getNormalizedFragmentsForSpeech(words: string[], language: string) {
	language = getShortLanguageCode(language)

	if (language != 'en') {
		return { normalizedFragments: [...words], referenceFragments: [...words] }
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

	for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
		const word = words[wordIndex]
		const lowerCaseWord = word.toLowerCase()

		const nextWords = words.slice(wordIndex + 1)
		const nextWord = nextWords[0]

		if ( // Normalize a four digit year pattern, e.g. 'in 1995'.
			wordsPrecedingAYear.includes(lowerCaseWord) &&
			fourDigitYearPattern.test(nextWord)) {

			const normalizedString = normalizeFourDigitYearString(nextWord)

			normalizedFragments.push(word)
			referenceFragments.push(word)

			normalizedFragments.push(normalizedString)
			referenceFragments.push(nextWord)

			wordIndex += 1
		} else if ( // Normalize a four digit decade pattern, e.g. 'the 1980s'.
			wordsPrecedingADecade.includes(lowerCaseWord) &&
			fourDigitDecadePattern.test(nextWord)) {

			const normalizedString = normalizeFourDigitDecadeString(nextWord)

			normalizedFragments.push(word)
			referenceFragments.push(word)

			normalizedFragments.push(normalizedString)
			referenceFragments.push(nextWord)

			wordIndex += 1
		} else if ( // Normalize a year range pattern, e.g. '1835-1896'
			fourDigitYearRangePattern.test(words.slice(wordIndex, wordIndex + 3).join(''))) {

			normalizedFragments.push(normalizeFourDigitYearString(words[wordIndex]))
			referenceFragments.push(words[wordIndex])

			normalizedFragments.push('to')
			referenceFragments.push(words[wordIndex + 1])

			normalizedFragments.push(normalizeFourDigitYearString(words[wordIndex + 2]))
			referenceFragments.push(words[wordIndex + 2])

			wordIndex += 2
		} else if ( // Normalize a currency pattern, e.g. '$53.1 million', '€3.53'
			symbolsPrecedingACurrency.includes(lowerCaseWord) &&
			numberPattern.test(nextWord)) {

			let currencyWord = symbolsPrecedingACurrencyAsWords[symbolsPrecedingACurrency.indexOf(lowerCaseWord)]

			if (wordsSucceedingACurrency.includes(nextWords[1].toLowerCase())) {
				const normalizedString = `${nextWord} ${nextWords[1]} ${currencyWord}`

				normalizedFragments.push(normalizedString)

				const referenceString = `${word}${nextWord} ${nextWords[1]}`
				referenceFragments.push(referenceString)

				wordIndex += 2
			} else {
				const normalizedString = `${nextWord} ${currencyWord}`

				normalizedFragments.push(normalizedString)

				const referenceString = `${word}${nextWord}`
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
