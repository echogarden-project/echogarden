import { getShortLanguageCode } from '../utilities/Locale.js'
import { substituteCharactersUsingLookup } from '../utilities/StringUtilities.js'
import { anyOf, buildRegExp, charRange, inputEnd, inputStart, oneOrMore, repeated, unicodeProperty, zeroOrMore } from 'regexp-composer'

export function getNormalizedFragmentsForSpeech(
	words: string[],
	nonWhitespaceWords: string[],
	nonWhitespaceWordOriginalIndex: number[],
	language: string) {

	language = getShortLanguageCode(language)

	if (language != 'en') {
		return { normalizedFragments: [...nonWhitespaceWords], referenceFragments: [...nonWhitespaceWords] }
	}

	const normalizedFragments: string[] = []
	const referenceFragments: string[] = []

	for (let wordIndex = 0; wordIndex < nonWhitespaceWords.length; wordIndex++) {
		const word = nonWhitespaceWords[wordIndex]
		const lowerCaseWord = word.toLowerCase()

		const nextNonWhitespaceWords = nonWhitespaceWords.slice(wordIndex + 1)
		const nextNonWhitespaceWord = nextNonWhitespaceWords[0]

		const originalWordIndex = nonWhitespaceWordOriginalIndex[wordIndex]

		const isFollowedByWhitespace = words[originalWordIndex + 1]?.trim().length === 0
		const isSpecialCharacterBeforeYear = ['(', ',', '©'].includes(words[originalWordIndex])

		//const isWordPrecedingAYear = wordsPrecedingAYear.includes(lowerCaseWord)
		const isWordPrecedingAYear =
			isAllLettersRegExp.test(lowerCaseWord) || isSpecialCharacterBeforeYear

		const followedByFourDigitYearPattern = fourDigitYearRegExp.test(nextNonWhitespaceWord)

		const isWordPrecedingADecade = wordsPrecedingADecade.includes(lowerCaseWord)
		const followedByFourDigitDecadePattern = fourDigitDecadeRegExp.test(nextNonWhitespaceWord)

		if (isWordPrecedingAYear &&
			(isFollowedByWhitespace || isSpecialCharacterBeforeYear) &&
			followedByFourDigitYearPattern) {

			// Normalize a four digit year pattern, e.g. 'in 1995'.
			const normalizedString = normalizeFourDigitYearString(nextNonWhitespaceWord)

			normalizedFragments.push(word)
			referenceFragments.push(word)

			normalizedFragments.push(normalizedString)
			referenceFragments.push(nextNonWhitespaceWord)

			wordIndex += 1
		} else if (
			isWordPrecedingADecade &&
			isFollowedByWhitespace &&
			followedByFourDigitDecadePattern) {

			// Normalize a four digit decade pattern, e.g. 'the 1980s'.

			const normalizedString = normalizeFourDigitDecadeString(nextNonWhitespaceWord)

			normalizedFragments.push(word)
			referenceFragments.push(word)

			normalizedFragments.push(normalizedString)
			referenceFragments.push(nextNonWhitespaceWord)

			wordIndex += 1
		} else if (fourDigitYearRangeRegExp.test(words.slice(originalWordIndex, originalWordIndex + 3).join(''))) {
			// Normalize a year range pattern, e.g. '1835-1896', ensure there are no spaces between words
			normalizedFragments.push(normalizeFourDigitYearString(nonWhitespaceWords[wordIndex]))
			referenceFragments.push(nonWhitespaceWords[wordIndex])

			normalizedFragments.push('to')
			referenceFragments.push(nonWhitespaceWords[wordIndex + 1])

			normalizedFragments.push(normalizeFourDigitYearString(nonWhitespaceWords[wordIndex + 2]))
			referenceFragments.push(nonWhitespaceWords[wordIndex + 2])

			wordIndex += 2
		} else if (precedingCurrencyPatternRegExp.test(lowerCaseWord)) {
			// Normalize a currency pattern with preceding currency symbol, e.g. '€3.53', '$53.1 million',

			const currencyWord = currencySymbolsAsWords[currencySymbols.indexOf(lowerCaseWord[0])]

			if (wordsFollowingACurrency.includes(nextNonWhitespaceWord?.toLowerCase())) {
				const normalizedString = `${word.substring(1)} ${nextNonWhitespaceWord} ${currencyWord}`

				normalizedFragments.push(normalizedString)

				const referenceString = `${word} ${nextNonWhitespaceWord}`
				referenceFragments.push(referenceString)

				wordIndex += 1
			} else {
				const normalizedString = `${word.substring(1)} ${currencyWord}`

				normalizedFragments.push(normalizedString)

				const referenceString = word
				referenceFragments.push(referenceString)
			}
		} else if (followingCurrencyRegExp.test(lowerCaseWord)) {
			const currencyWord = currencySymbolsAsWords[currencySymbols.indexOf(lowerCaseWord[lowerCaseWord.length - 1])]

			const normalizedString = `${word.substring(0, word.length - 1)} ${currencyWord}`

			normalizedFragments.push(normalizedString)

			const referenceString = word
			referenceFragments.push(referenceString)
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
	const isMilleniumDecade = firstTwoDigitsValue % 10 == 0 && secondTwoDigitsValue == 0

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

const wordsPrecedingAYear = [
	'in', 'the', 'a', 'to', 'of', 'since', 'from', 'between', 'by', 'until', 'around', 'before', 'after',
	'his', 'her', 'year', 'years', 'during', 'copyright', '©', 'early', 'mid', 'late',
	'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
	'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
	'winter', 'spring', 'summer', 'fall', 'autumn'
]

const wordsPrecedingADecade = [
	'the', 'in', 'early', 'mid', 'late', 'a'
]

const currencySymbols = [
	'$', '¥', '€', '£', '₩', '₭', '₽', '₫', '฿', '¢', '₮', '؋', '₦', '₱', '₴', '₪'
]

const currencySymbolsAsWords = [
	'dollars', 'yen', 'euros', 'pounds', 'won', 'kip', 'rubles', 'dong', 'baht', 'cents', 'tögrög', 'afghanis', 'naira', 'pesos', 'hryvnia', 'shekels'
]

const wordsFollowingACurrency = [
	'million', 'billion', 'trillion'
]

const arabicNumeralPattern = charRange('0', '9')

const isNumberPattern = [
	inputStart,
	arabicNumeralPattern,
	zeroOrMore(anyOf(arabicNumeralPattern, ',', '.')),
	inputEnd
]

const isNumberRegExp = buildRegExp(isNumberPattern)

const precedingCurrencyPattern = [
	inputStart,
	anyOf(...currencySymbols),
	arabicNumeralPattern,
	zeroOrMore(anyOf(arabicNumeralPattern, ',', '.')),
	inputEnd
]

const precedingCurrencyPatternRegExp = buildRegExp(precedingCurrencyPattern)

const followingCurrencyPattern = [
	inputStart,
	arabicNumeralPattern,
	zeroOrMore(anyOf(arabicNumeralPattern, ',', '.')),
	anyOf(...currencySymbols),
	inputEnd
]

const followingCurrencyRegExp = buildRegExp(followingCurrencyPattern)

const fourDigitYearPattern = [inputStart, repeated(4, arabicNumeralPattern), inputEnd]
const fourDigitYearRegExp = buildRegExp(fourDigitYearPattern)

const fourDigitDecadePattern = [inputStart, repeated(3, arabicNumeralPattern), '0s', inputEnd]
const fourDigitDecadeRegExp = buildRegExp(fourDigitDecadePattern)

const fourDigitYearRangePattern = [inputStart, repeated(4, arabicNumeralPattern), anyOf('-', '–'), repeated(4, arabicNumeralPattern), inputEnd]
const fourDigitYearRangeRegExp = buildRegExp(fourDigitYearRangePattern)

const isAllLettersPattern = [inputStart, oneOrMore(unicodeProperty('Letter')), inputEnd]
const isAllLettersRegExp = buildRegExp(isAllLettersPattern)
