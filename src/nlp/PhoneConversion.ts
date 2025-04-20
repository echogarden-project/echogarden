export function ipaPhoneToKirshenbaum(ipaPhone: string) {
	let result = ''

	for (const char of ipaPhone) {
		const convertedChar = ipaToKirshenbaum[char]

		if (convertedChar == undefined) {
			throw new Error(`Couldn't convert IPA character '${char}' (part of phone '${ipaPhone}') to the Kirshenbaum notation`)
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

export const ipaToKirshenbaum: Record<string, string> = {
	//// Vowels

	// Close
	'i': 'i',
	'y': 'y',
	'ɨ': 'i"',
	'ʉ': 'u"',
	'ɯ': 'u-',
	'u': 'u',

	// Near-close
	'ɪ': 'I',
	'ɩ': 'I',
	//'ᵻ': 'I',
	'ᵻ': 'I#', // eSpeak
	'ʏ': 'I.',
	'ʊ': 'U',
	'ɷ': 'U',

	// Close-mid
	'e': 'e',
	'ø': 'Y',
	//'ɘ': '@<umd>', // Reference
	'ɘ': '@', // Simplified
	'ɵ': '@.',
	//'ɵ': '8', // eSpeak
	'ɤ': 'o-',
	'o': 'o',

	// Mid:
	'ə': '@',

	// Open-mid:
	'ɛ': 'E',
	'œ': 'W',
	'ɜ': '3', // eSpeak
	'ɜː': '3:',
	//'ɜ': 'V"',
	'ɞ': 'O"',
	'ʌ': 'V',
	'ɔ': 'O',

	// Near-open
	//'æ': '&', // Reference. note: passing '&' to eSpeak in SSML (XML) mode will cause an error due to escaping conflict
	'æ': 'a', // eSpeak
	'ɐ': 'a#',

	// Open
	'a': 'a',
	//'ɶ': '&.', // Reference. note: passing '&' to eSpeak in SSML (XML) mode will cause an error due to escaping conflict
	'ɶ': 'W#', // eSpeak
	'ä': 'a"',
	'ɒ̈': 'A".',
	'ɑ': 'A',
	'ɑː': '0', // eSpeak
	//'ɒ': 'A.', // Reference
	'ɒ': '0', // eSpeak

	// Rhotic
	//'ɚ': 'R',
	'ɚ': '3', // eSpeak
	//'ɝ': 'R<umd>', // Reference
	'ɝ': 'R', // Simplified

	// More vowels
	'ᵊ': '',

	//// Consonants

	// Nasals
	'm': 'm',
	'ɱ': 'M',
	'n̪': 'n[',
	'n': 'n',
	'ɳ': 'n.',
	'ṇ': 'n.',
	'ɲ': 'n^',
	'ŋ': 'N',
	'ɴ': 'n"',
	//'n͡g': 'n<lbv>',

	// Stops
	'p': 'p',
	'b': 'b',
	't̪': 't[',
	'd̪': 'd[',
	't': 't',
	'd': 'd',
	'ʈ': 't.',
	'ṭ': 't.',
	'ɖ': 'd.',
	'ḍ': 'd.',
	'c': 'c',
	'ɟ': 'J',
	'k': 'k',
	'ɡ': 'g',
	'q': 'q',
	'ɢ': 'G',
	//'k͡p': 't<lbv>',
	//'ɡ͡b': 'd<lbv>',
	'ʔ': '?',

	// Fricatives
	'φ': 'P',
	'Φ': 'P',
	'β': 'B',
	'f': 'f',
	'v': 'v',
	'θ': 'T',
	'ð': 'D',
	's': 's',
	'z': 'z',
	'ʂ': 's.',
	'ṣ': 's.',
	'ʐ': 'z.',
	'ẓ': 'z.',
	'ʃ': 'S',
	'ʒ': 'Z',
	'ç': 'C',
	'ʝ': 'C<vcd>',
	'x': 'x',
	'ɣ': 'Q',
	'χ': 'X',
	'ʁ': 'g"', // Reference
	//'ʁ': 'r', // eSpeak
	'ʍ': 'w<vls>',
	'w': 'w',
	'ħ': 'H',
	'ʕ': 'H<vcd>',
	'h': 'h',
	'ɦ': 'h<?>',

	// Approximants
	'ʋ': 'r<lbd>',
	'ɹ̪': 'r[',
	'ɹ': 'r',
	'ɻ': 'r.',
	'ɻ̣': 'r.',
	'j': 'j',
	'ɥ': 'j<rnd>',
	'ɰ': 'j<vel>',

	// Laterals
	'l̪': 'l[',
	'l': 'l',
	'ɭ': 'l.',
	'ḷ': 'l.',
	'ʎ': 'l^',
	'ʟ': 'L',

	// Trills
	'ʙ': 'b<trl>',
	//'r': 'r<trl>', // Reference alv trl
	'r': 'R', // eSpeak
	'ʀ': 'r"', // Reference uvl trl

	// Flaps
	//'ɾ': '*',
	'ɾ': 't#', // eSpeak
	'ɽ': '*.',
	'ṛ': '*.',

	// Ejectives
	'pʼ': 'p`',
	'tʼ': 't`',
	'cʼ': 'c`',
	'kʼ': 'k`',
	'qʼ': 'q`',
	'ʠ': 'q`',

	// Implosives
	'ɓ': 'b`',
	'ɗ': 'd`',
	'ʄ': 'J`',
	'ɠ': 'g`',
	'ʛ': 'G`',

	// Clicks
	'ʘ': 'p!',
	'ǀ': 't!',
	'ʇ': 't!',
	'ǃ': 'c!',
	'ǂ': 'c!',
	'ʗ': 'c!',
	'ʞ': 'k!',
	'ǁ': 'l!',
	'ʖ': 'l!',

	// Lateral fricative
	'ɬ': 'L',
	'ɮ': 'z<lat>',
	'ɫ': 'L',

	// Lateral flap
	'ɺ': '*<lat>',

	// Other consonants
	'ʰ': '#',
	'ʲ': ';',
	'̪': '[',
	'̃': '~',

	// Stress marks and other misc characters
	'ˈ': '\'',
	'ˌ': ',',
	'ː': ':',
	'-': '-',
}
