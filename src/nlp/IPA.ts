import { logToStderr } from '../utilities/Utilities.js'

const log = logToStderr

const consonant = {
	plosive: ['p', 'b', 't', 'd', 'ʈ', 'ɖ', 'c', 'ɟ', 'k', 'g', 'q', 'ɢ', 'ʔ', /* extensions */ 'ɡ'],
	nasal: ['m', 'ɱ', 'n', 'ɳ', 'ɲ', 'ŋ', 'ɴ', 'n̩'],
	trill: ['ʙ', 'r', 'ʀ'],
	tapOrFlap: ['ⱱ', 'ɾ', 'ɽ'],
	fricative: ['ɸ', 'β', 'f', 'v', 'θ', 'ð', 's', 'z', 'ʃ', 'ʒ', 'ʂ', 'ʐ', 'ç', 'ʝ', 'x', 'ɣ', 'χ', 'ʁ', 'ħ', 'ʕ', 'h', 'ɦ'],
	lateralFricative: ['ɬ', 'ɮ'],
	affricate: ['tʃ', 'ʈʃ', 'dʒ'], // very incomplete, there are many others
	approximant: ['ʋ', 'ɹ', 'ɻ', 'j', 'ɰ', /* extensions */ 'w'],
	lateralApproximant: ['l', 'ɭ', 'ʎ', 'ʟ']
}

const vowel = {
	close: ['i', 'yɨ', 'ʉɯ', 'u', 'iː'],
	closeOther: ['ɪ', 'ʏ', 'ʊ', 'ɨ', 'ᵻ'],
	closeMid: ['e', 'ø', 'ɘ', 'ɵ', 'ɤ', 'o', 'ə', 'oː'],
	openMid: ['ɛ', 'œ', 'ɜ', 'ɞ', 'ʌ', 'ɔ', 'ɜː', 'uː', 'ɔː', 'ɛː'],
	open: ['æ', 'a', 'ɶ', 'ɐ', 'ɑ', 'ɒ', 'ɑː'],

	rhotic: ['◌˞', 'ɚ', 'ɝ', 'ɹ̩'],

	diphtongs: [
		'eɪ', 'əʊ', 'oʊ', 'aɪ', 'ɔɪ', 'aʊ', 'iə',
		'ɜr', 'ɑr', 'ɔr', 'oʊr', 'oːɹ', 'ir', 'ɪɹ', 'ɔːɹ', 'ɑːɹ', 'ʊɹ', 'ʊr', 'ɛr', 'ɛɹ',
		'əl', 'aɪɚ', 'aɪə'
	],
}

let consonants: string[] = []

for (const p in consonant) {
	consonants = [...consonants, ...(consonant as any)[p]]
}

let vowels: string[] = []

for (const p in vowel) {
	vowels = [...vowels, ...(vowel as any)[p]]
}

const all = [' ', ...consonants, ...vowels]

export function getPhoneSubstitutionCost1(ipa1: string, ipa2: string) {
	if (ipa1 == ipa2) {
		return 0
	} else {
		return 1
	}
}

export function getPhoneSubstitutionCost2(ipa1: string, ipa2: string) {
	if (!isKnownSymbol(ipa1)) {
		throw new Error(`'${ipa1}' is not a known IPA symbol`)
	}

	if (!isKnownSymbol(ipa2)) {
		throw new Error(`'${ipa2}' is not a known IPA symbol`)
	}

	if (ipa1 == ipa2) {
		return 0
	} else if (isVowel(ipa1) && isVowel(ipa2)) {
		return 0.5
	} else if (isConsonant(ipa1) && isConsonant(ipa2)) {
		return 0.5
	} else {
		return 1
	}
}

export function getPhoneSubstitutionCost3(ipa1: string, ipa2: string) {
	if (!isKnownSymbol(ipa1)) {
		throw new Error(`'${ipa1}' is not a known IPA symbol`)
	}

	if (!isKnownSymbol(ipa2)) {
		throw new Error(`'${ipa2}' is not a known IPA symbol`)
	}

	if (ipa1 == ipa2) {
		return 0
	} else if (isVowel(ipa1) && isVowel(ipa2)) {
		return 0.75
	} else if (isConsonant(ipa1) && isConsonant(ipa2)) {
		if ((isPlosiveOrNasal(ipa1) && isPlosiveOrNasal(ipa2)) ||
			(isTrillTapOrFlap(ipa1) && isTrillTapOrFlap(ipa2)) ||
			(isFricativeLike(ipa1) && isFricativeLike(ipa2)) ||
			(isApproximantLike(ipa1) && isApproximantLike(ipa2))) {
			return 0.5
		} else {
			return 0.75
		}
	} else {
		return 1
	}
}

// All symbols:
export function isKnownSymbol(ipa: string) { return all.includes(ipa) }

// All consonants:
export function isConsonant(ipa: string) { return consonants.includes(ipa) }

// All vowels:
export function isVowel(ipa: string) { return vowels.includes(ipa) }

// Higher level grouping:
export function isPlosiveOrNasal(ipa: string) { return isPlosive(ipa) || isNasal(ipa) }

export function isTrillTapOrFlap(ipa: string) { return isTrill(ipa) || isTapOrFlap(ipa) }

export function isFricativeLike(ipa: string) { return isFricative(ipa) || isLateralFricative(ipa) || isAffricate(ipa) }

export function isApproximantLike(ipa: string) { return isApproximant(ipa) || isLateralApproximant(ipa) }

// Grouping:
export function isPlosive(ipa: string) { return consonant.plosive.includes(ipa) }

export function isNasal(ipa: string) { return consonant.nasal.includes(ipa) }

export function isTrill(ipa: string) { return consonant.trill.includes(ipa) }

export function isTapOrFlap(ipa: string) { return consonant.tapOrFlap.includes(ipa) }

export function isFricative(ipa: string) { return consonant.fricative.includes(ipa) }

export function isLateralFricative(ipa: string) { return consonant.lateralFricative.includes(ipa) }

export function isAffricate(ipa: string) { return consonant.affricate.includes(ipa) }

export function isApproximant(ipa: string) { return consonant.approximant.includes(ipa) }

export function isLateralApproximant(ipa: string) { return consonant.lateralApproximant.includes(ipa) }


