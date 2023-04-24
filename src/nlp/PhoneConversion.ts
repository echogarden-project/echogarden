export function ipaPhoneToKirshenbaum(ipaPhone: string) {
	let result = ''

	for (const char of ipaPhone) {
		const convertedChar = ipaToKirshenbaum[char]

		if (convertedChar == undefined) {
			throw new Error(`Could not convert phone character '${char}' to Kirshenbaum encoding`)
		}

		result += convertedChar || '_'
	}

	return result
}

export function ipaWordToTimitTokens(ipaWord: string, subphoneCount = 0) {
	let result: string[] = []

	for (const ipaPhone of ipaWord) {
		const convertedPhoneSequence = ipaPhoneToTimit(ipaPhone, subphoneCount)

		if (convertedPhoneSequence == undefined) {
			throw new Error(`Could not find a TIMIT equivalent for ipa phone '${ipaPhone}'`)
		}

		result = [...result, ...convertedPhoneSequence]
	}

	return result
}

export function ipaPhoneToTimit(ipaPhone: string, subphoneCount = 0) {
	let tokens = ipaToTimit[ipaPhone]

	if (!tokens) {
		return undefined
	}

	if (subphoneCount > 0) {
		tokens = splitTokensToSubphones(tokens, subphoneCount)
	}

	return tokens
}

export function arpabetPhoneToIpa(arpabetPhone: string) {
	return arpabetToIPA[arpabetPhone.toUpperCase()]
}

export function timitPhoneToIpa(arpabetPhone: string) {
	return timitToIPA[arpabetPhone.toUpperCase()]
}

export function splitTokensToSubphones(tokens: string[], subphoneCount = 3) {
	const result: string[] = []

	for (const token of tokens) {
		if (token == 'pause') {
			result.push(token)

			continue
		}

		for (let i = 1; i <= subphoneCount; i++) {
			result.push(`${token}/${i}`)
		}
	}

	return result
}

// ARPABET was invented for English.
// The standard dictionary written in ARPABET is the CMU dictionary.
// TIMIT is written in a variant of ARPABET that includes a couple
// of non-standard allophones, and most significantly, includes
// separate symbols for the closure and release portions of each stop.
const arpabetToIPA: { [p: string]: string | undefined } = {
	'AA': 'ɑ',
	'AE': 'æ',
	'AH': 'ʌ',
	'AH0': 'ə',
	'AO': 'ɔ',
	'AW': 'aʊ',
	'AY': 'aɪ',
	'EH': 'ɛ',
	'ER': 'ɝ',
	'ER0': 'ɚ',
	'EY': 'eɪ',
	'IH': 'ɪ',
	'IH0': 'ɨ',
	'IY': 'i',
	'OW': 'oʊ',
	'OY': 'ɔɪ',
	'UH': 'ʊ',
	'UW': 'u',
	'B': 'b',
	'CH': 'tʃ',
	'D': 'd',
	'DH': 'ð',
	'EL': 'l̩ ',
	'EM': 'm̩',
	'EN': 'n̩',
	'F': 'f',
	'G': 'ɡ',
	'HH': 'h',
	'JH': 'dʒ',
	'K': 'k',
	'L': 'l',
	'M': 'm',
	'N': 'n',
	'NG': 'ŋ',
	'P': 'p',
	'Q': 'ʔ',
	'R': 'ɹ',
	'S': 's',
	'SH': 'ʃ',
	'T': 't',
	'TH': 'θ',
	'V': 'v',
	'W': 'w',
	'WH': 'ʍ',
	'Y': 'j',
	'Z': 'z',
	'ZH': 'ʒ'
}

const timitToIPA: { [p: string]: string | undefined } = {
	...arpabetToIPA,

	'AX': 'ə',
	'AX-H': 'ə̥',
	'AXR': 'ɚ',
	'B': '',
	'BCL': 'b',
	'D': '',
	'DCL': 'd',
	'DX': 'ɾ',
	'ENG': 'ŋ̍',
	'EPI': '',
	'G': '',
	'GCL': 'g',
	'HV': 'ɦ',
	'H//': '',
	'IX': 'ɨ',
	'KCL': 'k',
	'K': '',
	'NX': 'ɾ̃',
	'P': '',
	'PAU': '',
	'PCL': 'p',
	'T': '',
	'TCL': 't',
	'UX': 'ʉ',
}

const ipaToTimit: { [p: string]: string[] | undefined } = {
	// Vowels
	'ɑ': ['aa'],
	'ɑː': ['aa'],
	'ɑːɹ': ['aa', 'r'], // ?
	'a': ['aa'], // ? UK English

	'aʊ': ['aw'],
	'aɪ': ['ay'],
	'aɪɚ': ['ay', 'r'], // ?
	'aɪə': ['ay', 'ax'], // ?

	'æ': ['ae'],
	'æʊ': ['ae', 'uh'], // ?

	'ʌ': ['ah'],
	'ɐ': ['ah'], // ?

	'ə': ['ax'],
	'ə̥': ['ax-h'],
	'əʊ': ['ax', 'uh'], // ? UK English
	'ɚ': ['axr'],
	'ᵻ': ['ax'], // ?

	'ɔ': ['ao'],
	'ɔː': ['ao'],
	'ɔːɹ': ['ao', 'r'], // ?
	'ɔɪ': ['oy'],
	'ɒ': ['ao'], // ? UK English

	'ɛ': ['eh'],
	'ɜː': ['eh'], // ?
	'ɝ': ['er'],
	'ɛɹ': ['er'], // ?

	'eɪ': ['ey'],
	'eə': ['ey', 'ax'], // ? UK English
	'eː': ['ey'], // ? UK English

	'ɪ': ['ih'],
	'ɪɹ': ['ih', 'r'], // ?

	'ɨ': ['ix'],

	'i': ['iy'],
	'iː': ['iy'], // ?
	'iə': ['iy', 'ax'], // ?

	'oʊ': ['ow'],
	'oː': ['ow'], // ?
	'oːɹ': ['ow', 'r'], // ?

	'ʊ': ['uh'],
	'ʊɹ': ['uh', 'r'], // ?
	'ʊə': ['uh', 'ax'], // ? UK English

	'u': ['uw'],
	'uː': ['uw'], // ?

	// Consonants
	'b': ['bcl', 'b'],
	'tʃ': ['tcl', 'ch'],
	'd': ['dcl', 'd'],
	'ð': ['dh'],
	'l̩': ['el'],
	'əl': ['el'], // ?
	'm̩': ['em'],
	'n̩': ['en'],
	'f': ['f'],
	'ɡ': ['gcl', 'g'],
	'h': ['hh'],
	'dʒ': ['dcl', 'jh'],
	'k': ['kcl', 'k'],
	'l': ['l'],
	'm': ['m'],
	'n': ['n'],
	'ŋ': ['ng'],
	'p': ['pcl', 'p'],
	'ʔ': ['q'],
	'ɹ': ['r'],
	's': ['s'],
	'ʃ': ['sh'],
	't': ['tcl', 't'],
	'θ': ['th'],
	'v': ['v'],
	'w': ['w'],
	'ʍ': ['wh'],
	'j': ['y'],
	'z': ['z'],
	'ʒ': ['zh'],

	'ɾ̃': ['nx'],
	'ʉ': ['ux'],
	'ɦ': ['hv'],
	'ŋ̍': ['eng'],
	'ɾ': ['dx'],
}

// This is adapted from a lookup table on the eSpeak-ng source code
const ipaToKirshenbaum: { [p: string]: string | undefined } = {
    '1': '1',
    '2': '2',
    '4': '4',
    '5': '5',
    '6': '6',
    '7': '7',
    '9': '9',
    ' ': ' ',
    '!': '!',
    '\'': '\'',
    'ʰ': '#',
    '$': '$',
    '%': '%',
    //'æ': '&',
	'æ': 'a',
    'ˈ': '\'',
    '(': '(',
    ')': ')',
    'ɾ': '*',
    '+': '+',
    'ˌ': ',',
    '-': '-',
    '.': '.',
    '/': '/',
    'ɒ': '0',
    'ɜ': '3',
    'ɵ': '8',
    'ː': ':',
    'ʲ': ';',
    '<': '<',
    '=': '=',
    '>': '>',
    'ʔ': '?',
    'ə': '@',
    'ɑ': 'A',
    'β': 'B',
    'ç': 'C',
    'ð': 'D',
    'ɛ': 'E',
    'F': 'F',
    'ɢ': 'G',
    'ħ': 'H',
    'ɪ': 'I',
    'ɟ': 'J',
    'K': 'K',
    'ɫ': 'L',
    'ɱ': 'M',
    'ŋ': 'N',
    'ɔ': 'O',
    'Φ': 'P',
    'ɣ': 'Q',
    'ʀ': 'R',
    'ʃ': 'S',
    'θ': 'T',
    'ʊ': 'U',
    'ʌ': 'V',
    'œ': 'W',
    'χ': 'X',
    'ø': 'Y',
    'ʒ': 'Z',
    '̪': '[',
    '\\': '\\',
    ']': ']',
    '^': '^',
    '_': '_',
    '`': '`',
    'a': 'a',
    'b': 'b',
    'c': 'c',
    'd': 'd',
    'e': 'e',
    'f': 'f',
    'ɡ': 'g',
    'h': 'h',
    'i': 'i',
    'j': 'j',
    'k': 'k',
    'l': 'l',
    'm': 'm',
    'n': 'n',
    'o': 'o',
    'p': 'p',
    'q': 'q',
    'r': 'r',
    's': 's',
    't': 't',
    'u': 'u',
    'v': 'v',
	'w': 'w',
    'x': 'x',
    'y': 'y',
    'z': 'z',
    '{': '{',
    '|': '|',
    '}': '}',
    '̃': '~',
    '': '',

	// Extensions
	'ɚ': '3',
	'ɹ': 'r',
	'ɐ': 'a#',
	'ᵻ': 'i',
	'̩': ','
}

/*
// Source: https://github.com/coruus/ascii-ipa/blob/master/kirshenbaum.py
// Conversion regex: \('.*?': '.*?'\)
// Replace: $2: $1
const ipaToKirshenbaum2: { [p: string]: string | undefined } = {
	'm': 'm',
	'p': 'p',
	'b': 'b',
	'Φ': 'P',
	'β': 'B',
	'ʙ': 'b<trl>',
	'pʼ': 'p`',
	'ɓ': 'b`',
	'ʘ': 'p!',
	'ɱ': 'M',
	'f': 'f',
	'v': 'v',
	'ʋ': 'r<lbd>',
	'n\u032a': 'n[',
	't\u032a': 't[',
	'θ': 'T',
	'ð': 'D',
	'r\u032a': 'r[',
	'l\u032a': 'l[',
	't\u032a\u02bc': 't[`',
	'ɗ': 'd`',
	'ʇ': 't!',
	'n': 'n',
	't': 't',
	'd': 'd',
	's': 's',
	'z': 'z',
	'ɬ': 's<lat>',
	'ɮ': 'z<lat>',
	'ɹ': 'r',
	'l': 'l',
	'ʀ': 'r<trl>',
	'ɾ': '*',
	'ɺ': '*<lat>',
	't\u02bc': 't`',
	'ʗ': 'c!',
	'ʖ': 'l!',
	'ɳ': 'n.',
	'ʈ': 't.',
	'ɖ': 'd.',
	'ʂ': 's.',
	'ʐ': 'z.',
	//'ɖ': 'r.',
	'ɭ': 'l.',
	'ɽ': '*.',
	'ʃ': 'S',
	'ʒ': 'Z',
	'n^': 'n^',
	'c': 'c',
	'ɟ': 'J',
	'ç': 'C',
	'ʝ': 'C<vcd>',
	'j': 'j',
	'ɥ': 'j<rnd>',
	'ʎ': 'l^',
	'ʄ': 'J`',
	'ŋ': 'N',
	'k': 'k',
	'g': 'g',
	'x': 'x',
	'ɣ': 'Q',
	'ɰ': 'j<vel>',
	'ɫ': 'L',
	//'ɬ': '{vls,alv,lat,frc}',
	'k\u02bc': 'k`',
	'g\u02bc': 'g`',
	'ʞ': 'k!',
	'n\u2030g': 'n<lbv>',
	'k\u2030p': 't<lbv>',
	'g\u2030b': 'n<lbv>',
	'ʍ': 'w<vls>',
	'w': 'w',
	'ɴ': 'n'',
	'q': 'q',
	'ɢ': 'G',
	'χ': 'X',
	'ʁ': 'g'',
	//'ʀ': 'r'',
	'ʠ': 'q`',
	'ʛ': 'G`',
	'ħ': 'H',
	'ʕ': 'H<vcd>',
	'ʔ': '?',
	'h': 'h',
	'ɦ': 'h<?>',
	'i': 'i',
	'y': 'y',
	'ɪ': 'I',
	'ʏ': 'I.',
	'e': 'e',
	'ø': 'Y',
	'ɛ': 'E',
	'œ': 'W',
	'æ': '&',
	'ɶ': '&.',
	'ɨ': 'i'',
	'ʉ': 'u'',
	'ɘ': '@<umd>',
	'ɝ': 'R<umd>',
	'ə': '@',
	'ɚ': 'R',
	'ɵ': '@.',
	//'ɜ': 'V'',
	'ɜ': '3',
	'ɞ': 'O'',
	'a': 'a',
	'ɯ': 'u-',
	'u': 'u',
	'ʊ': 'U',
	'ɤ': 'o-',
	'o': 'o',
	'ʌ': 'V',
	'ɔ': 'O',
	'ɑ': 'A',
	'ɒ': 'A.',

	'ː': ':',
	'\u0322': '.',
	'\u02bc': '`',
	'\u032a': '[',
	'\u02b2': ';',
	''': ''',
	'^': '^',
	'\u0334': '<H>',
	'\u02b0': '<h>',
	'\u02da': '<unx>',
	'\u0325': '<vls>',
	//'\u02da': '<o>',
	'\u02b3': '<r>',
	'\u02b7': '<w>',
	'\u02b1': '<?>',

	'\u0303': '~',
	//'\u0334': '~'

	'ˈ': ''',
	'ˌ': ',',
	' ': ' ',
	'\n': '\n'
}
*/
