import { request } from "gaxios"
import { Logger } from "../utilities/Logger.js"
import { Fragment, splitToFragments, splitToLines } from "../nlp/Segmentation.js"
import { TranslationPair } from "../api/TextTranslation.js"
import { getChromeOnWindowsHeaders, getChromeOnAndroidHeaders } from "../utilities/BrowserRequestHeaders.js"
import { logToStderr } from "../utilities/Utilities.js"
import { getShortLanguageCode } from "../utilities/Locale.js"
import { PlainTextOptions } from "../api/Common.js"
import { extendDeep } from "../utilities/ObjectUtilities.js"
import { splitAndPreserveSeparators } from "../utilities/StringUtilities.js"

const log = logToStderr

export async function translateText(
	text: string,
	sourceLanguage: string,
	targetLanguage: string,
	plainTextOptions: PlainTextOptions,
	options: GoogleTranslateTextTranslationOptions) {

	const logger = new Logger()

	if (!supportsLanguage(sourceLanguage)) {
		throw new Error(`Language code ${sourceLanguage} is not supported by the Google Translate engine. Supported language codes are ${supportedLanguageCodes.join(', ')}`)
	}

	if (!supportsLanguage(targetLanguage)) {
		throw new Error(`Language code ${sourceLanguage} is not supported by the Google Translate engine. Supported language codes are ${supportedLanguageCodes.join(', ')}`)
	}

	options = extendDeep(defaultGoogleTranslateTextTranslationOptions, options)

	const maxCharactersPerPart = options.maxCharactersPerPart!

	const paragraphSeperatorPattern = plainTextOptions.paragraphBreaks === 'double' ? /(\r?\n)(\r?\n)+/g : /(\r?\n)+/g

	const paragraphs = splitAndPreserveSeparators(text, paragraphSeperatorPattern)

	const fragmentsForParagraph: Fragment[][] = []

	for (const paragraph of paragraphs) {
		const fragments = await splitToFragments(paragraph, maxCharactersPerPart, getShortLanguageCode(sourceLanguage))

		fragmentsForParagraph.push(fragments)
	}

	const parts: Fragment[][] = [[]]

	function totalLengthOfLastPart() {
		let total = 0

		for (const fragment of parts[parts.length - 1]) {
			total += fragment.length
		}

		return total
	}

	const fragmentToParagraphIndex = new Map<Fragment, number>()

	for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex++) {
		const fragments = fragmentsForParagraph[paragraphIndex]

		for (const fragment of fragments) {
			let lastPart = parts[parts.length - 1]

			if (totalLengthOfLastPart() + fragment.length > maxCharactersPerPart) {
				lastPart = []
				parts.push(lastPart)
			}

			lastPart.push(fragment)

			fragmentToParagraphIndex.set(fragment, paragraphIndex)
		}
	}

	const translatedFragmentsForParagraphs = paragraphs.map(_ => [] as string[])

	for (let partIndex = 0; partIndex < parts.length; partIndex++) {
		const part = parts[partIndex]

		const joinedFragmentsInPart = part.map(x => x.text.replaceAll('|', ' ')).join(`\n|\n`)

		logger.logTitledMessage(`\nTranslate part ${partIndex + 1} of ${parts.length}`, joinedFragmentsInPart.replaceAll('\n|\n', ''))

		logger.start(`Request translation from Google Translate`)
		const fragmentTranslationPair = await translateText_MobileWeb(joinedFragmentsInPart, sourceLanguage, targetLanguage, options)
		logger.end()

		const translatedTextForPart = fragmentTranslationPair[0].translatedText

		logger.logTitledMessage(`Translated part`, `"${translatedTextForPart.replaceAll(' | ', '\n') }"`)

		const splitTranslation = translatedTextForPart.split(`|`)

		for (let fragmentIndex = 0; fragmentIndex < part.length; fragmentIndex++) {
			const fragment = part[fragmentIndex]
			const translatedFragment = splitTranslation[fragmentIndex].trim()

			const paragraphIndex = fragmentToParagraphIndex.get(fragment)!

			translatedFragmentsForParagraphs[paragraphIndex].push(translatedFragment)
		}
	}

	const translationPairs: TranslationPair[] = []

	for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex++) {
		const sourceParagraph = paragraphs[paragraphIndex]
		const translatedParagraph = translatedFragmentsForParagraphs[paragraphIndex].join(' ')

		let translatedParagraphWithWhitespace = ''

		const sourceParagraphLeadingWhitespaceMatches = sourceParagraph.match(/^\s+/)

		if (sourceParagraphLeadingWhitespaceMatches) {
			translatedParagraphWithWhitespace += sourceParagraphLeadingWhitespaceMatches[0]
		}

		translatedParagraphWithWhitespace += translatedParagraph

		const sourceParagraphTrailingWhitespaceMatches = sourceParagraph.match(/\s+$/)

		if (sourceParagraphTrailingWhitespaceMatches) {
			translatedParagraphWithWhitespace += sourceParagraphTrailingWhitespaceMatches[0]
		}

		translationPairs.push({
			sourceText: paragraphs[paragraphIndex],
			translatedText: translatedParagraphWithWhitespace,
		})
	}

	const translatedParagraphs = translationPairs.map(pair => pair.translatedText)

	const translatedText = translatedParagraphs.join('')

	return { translationPairs, translatedText }
}

export async function translateText_MobileWeb(
	text: string,
	sourceLanguage: string,
	targetLanguage: string,
	options: GoogleTranslateTextTranslationOptions) {

	const tld = options.tld

	const logger = new Logger()

	logger.start(`Request translation from Google Translate`)

	const response = await request<string>({
		method: 'GET',

		url: `https://translate.google.${tld}/m`,

		//proxy: 'http://localhost:8080',

		params: {
			'sl': sourceLanguage,
			'tl': targetLanguage,
			'q': text,
		},

		headers: {
			...getChromeOnAndroidHeaders({
				origin: `https://translate.google.${tld}`,
				referrer: `https://translate.google.${tld}/m`
			}),
		},

		responseType: 'text',
	})

	logger.start('Parse response')

	const html = response.data

	let translatedText: string

	const useJsdom = false

	if (useJsdom) {
		const { JSDOM } = await import('jsdom')

		const doc = new JSDOM(html, {})

		const resultElement = doc.window.document.querySelector('.result-container')

		translatedText = resultElement?.textContent || ''
	} else {
		const regex = /<div\s+class="result-container".*?<\/div>/is
		const match = html.match(regex)

		if (match) {
			const { htmlToText } = await import('html-to-text')

			translatedText = htmlToText(match[0], { wordwrap: false }).trim()
		} else {
			translatedText = ''
		}
	}

	logger.end()

	return [{
		sourceText: text,
		translatedText: translatedText
	}]
}

export async function translateText_WebAPI(text: string, sourceLanguage: string, targetLanguage: string, tld = 'com') {
	const logger = new Logger()

	logger.start(`Prepare request`)

	const bodyFormParameters = [[text, sourceLanguage, targetLanguage, 1], []]

	const requestForm = [[['MkEWBc', JSON.stringify(bodyFormParameters), null, 'generic']]]
	const stringifiedForm = JSON.stringify(requestForm)
	const requestBody =
		`f.req=${encodeURIComponent(stringifiedForm)}&`// +

	// Example:
	//
	// f.req: [[["MkEWBc","[[\"Hey there!\\n\\nHow are you doing today?\",\"en\",\"es\",1],[]]",null,"generic"]]]
	// at: AFS6Qyg7vBwAdNvYB3ncQi_YvmYH:1717146157247

	logger.start(`Request translation from Google Translate`)

	const response = await request<string>({
		method: 'POST',

		url: `https://translate.google.${tld}/_/TranslateWebserverUi/data/batchexecute`,

		params: {
			'rpcids': 'MkEWBc',
			/*'source-path': '/',
			'f.sid': '4165351081036910547',
			'bl': 'boq_translate-webserver_20240528.08_p1',
			'hl': 'en-US',
			'soc-app': '1',
			'soc-platform': '1',
			'soc-device': '1',
			'_reqid': '435214',
			*/
			'rt': 'c',
		},

		headers: {
			...getChromeOnWindowsHeaders({
				origin: `https://translate.google.${tld}`,
				referrer: `https://translate.google.${tld}/`
			}),

			'Content-Type': 'application/x-www-form-urlencoded',
		},

		body: requestBody,

		//proxy: 'http://localhost:8080',

		responseType: 'text'
	})

	logger.start('Parse response')

	const responseLines = splitToLines(response.data).filter(line => line.trim().length > 0)

	const dataLine = responseLines[2]

	const outerArray = JSON.parse(dataLine)
	const innerArray = JSON.parse(outerArray[0][2])
	const sentenceEntries: any[] = innerArray[1][0][0][5]

	const translationsPairs = sentenceEntries.map<TranslationPair>((element: any) => {
		const translationPair: TranslationPair = {
			sourceText: element[6],
			translatedText: element[0],
		}

		return translationPair
	})

	logger.end()

	return translationsPairs
}

export async function translateText_OldWebAPI(text: string, sourceLanguage: string, targetLanguage: string, tld = 'com') {
	const logger = new Logger()

	logger.start(`Prepare request`)

	const token = getToken(text)

	logger.start(`Request translation from Google Translate`)

	const response = await request<string>({
		method: 'GET',

		url: `https://translate.google.${tld}/translate_a/single`,

		params: {
			client: 't',
			sl: normalizeLanguageCodeForGoogleTranslate(sourceLanguage),
			tl: normalizeLanguageCodeForGoogleTranslate(targetLanguage),
			hl: normalizeLanguageCodeForGoogleTranslate(targetLanguage),
			dt: ['at', 'bd', 'ex', 'ld', 'md', 'qca', 'rw', 'rm', 'ss', 't'],
			ie: 'UTF-8',
			oe: 'UTF-8',
			otf: 1,
			ssel: 0,
			tsel: 0,
			kc: 7,
			q: text,
			tk: token,
		},

		headers: getChromeOnWindowsHeaders({
			origin: `https://translate.google.${tld}`,
			referrer: `https://translate.google.${tld}/`
		}),

		responseType: 'json'
	})

	const translationsPairs: TranslationPair[] = []

	for (const element of response.data[0] as any as any[]) {
		if (element == null || element[0] == null || element[1] == null) {
			continue
		}

		translationsPairs.push({
			sourceText: element[1],
			translatedText: element[0],
		})
	}

	logger.end()

	return translationsPairs
}

function getToken(query: any) {
	function shiftLeftOrRightThenSumOrXor(num: number, optString: any) {
		for (let i = 0; i < optString.length - 2; i += 3) {
			let acc = optString.charAt(i + 2)

			if ('a' <= acc) {
				acc = acc.charCodeAt(0) - 87
			} else {
				acc = Number(acc)
			}

			if (optString.charAt(i + 1) == '+') {
				acc = num >>> acc
			} else {
				acc = num << acc
			}

			if (optString.charAt(i) == '+') {
				num += acc & 4294967295
			} else {
				num ^= acc
			}
		}

		return num
	}

	function transformQuery(query: any) {
		const bytesArray: number[] = []

		let idx: number = 0

		for (let i = 0; i < query.length; i++) {
			let charCode = query.charCodeAt(i)

			if (128 > charCode) {
				bytesArray[idx++] = charCode
			} else {
				if (2048 > charCode) {
					bytesArray[idx++] = (charCode >> 6) | 192
				} else {
					if (
						55296 == (charCode & 64512) &&
						i + 1 < query.length &&
						56320 == (query.charCodeAt(i + 1) & 64512)
					) {
						charCode =
							65536 +
							((charCode & 1023) << 10) +
							(query.charCodeAt(++i) & 1023)

						bytesArray[idx++] = (charCode >> 18) | 240
						bytesArray[idx++] = ((charCode >> 12) & 63) | 128
					} else {
						bytesArray[idx++] = (charCode >> 12) | 224
					}

					bytesArray[idx++] = ((charCode >> 6) & 63) | 128
				}

				bytesArray[idx++] = (charCode & 63) | 128
			}
		}

		return bytesArray
	}

	function calcHash(query: any, windowTkk: any) {
		const tkkSplited = windowTkk.split('.')
		const tkkIndex = Number(tkkSplited[0]) || 0
		const tkkKey = Number(tkkSplited[1]) || 0

		const bytesArray = transformQuery(query)

		let encondingRound = tkkIndex

		for (let i = 0; i < bytesArray.length; i++) {
			encondingRound += bytesArray[i]

			encondingRound = shiftLeftOrRightThenSumOrXor(encondingRound, '+-a^+6')
		}

		encondingRound = shiftLeftOrRightThenSumOrXor(encondingRound, '+-3^+b+-f')

		encondingRound ^= tkkKey

		if (encondingRound <= 0) {
			encondingRound = (encondingRound & 2147483647) + 2147483648
		}

		const normalizedResult = encondingRound % 1000000

		return normalizedResult.toString() + '.' + (normalizedResult ^ tkkIndex)
	}

	// TKK value from https://github.com/FilipePS/Traduzir-paginas-web/blob/f3a4956a1aa96b7a9124864158a5200827694521/background/translationService.js
	const googleTranslateTKK = '448487.932609646'

	return calcHash(query, googleTranslateTKK)
}

function normalizeLanguageCodeForGoogleTranslate(languageCode: string) {
	switch (languageCode) {
		case 'zh': {
			return 'zh-CN'
		}

		case 'he': {
			return 'iw'
		}

		case 'jv': {
			return 'jw'
		}

		default: {
			return languageCode
		}
	}
}

export function supportsLanguage(langCode: string) {
	return supportedLanguageCodes.includes(normalizeLanguageCodeForGoogleTranslate(langCode))
}

// 243 Languages supported
export const supportedLanguageCodes = [
	'ab', // Abkhaz
	'ace', // Acehnese
	'ach', // Acholi
	'aa', // Afar
	'af', // Afrikaans
	'sq', // Albanian
	'alz', // Alur
	'am', // Amharic
	'ar', // Arabic
	'hy', // Armenian
	'as', // Assamese
	'av', // Avar
	'awa', // Awadhi
	'ay', // Aymara
	'az', // Azerbaijani
	'ban', // Balinese
	'bal', // Baluchi
	'bm', // Bambara
	'bci', // Baoulé
	'ba', // Bashkir
	'eu', // Basque
	'btx', // Batak Karo
	'bts', // Batak Simalungun
	'bbc', // Batak Toba
	'be', // Belarusian
	'bem', // Bemba
	'bn', // Bengali
	'bew', // Betawi
	'bho', // Bhojpuri
	'bik', // Bikol
	'bs', // Bosnian
	'br', // Breton
	'bg', // Bulgarian
	'bua', // Buryat
	'yue', // Cantonese
	'ca', // Catalan
	'ceb', // Cebuano
	'ch', // Chamorro
	'ce', // Chechen
	'ny', // Chichewa
	'zh', // Chinese (same as zh-CN)
	'zh-CN', // Chinese (Simplified)
	'zh-TW', // Chinese (Traditional)
	'chk', // Chuukese
	'cv', // Chuvash
	'co', // Corsican
	'crh', // Crimean Tatar
	'hr', // Croatian
	'cs', // Czech
	'da', // Danish
	'fa-AF', // Dari
	'dv', // Dhivehi
	'din', // Dinka
	'doi', // Dogri
	'dov', // Dombe
	'nl', // Dutch
	'dyu', // Dyula
	'dz', // Dzongkha
	'en', // English
	'eo', // Esperanto
	'et', // Estonian
	'ee', // Ewe
	'fo', // Faroese
	'fj', // Fijian
	'tl', // Filipino
	'fi', // Finnish
	'fon', // Fon
	'fr', // French
	'fy', // Frisian
	'fur', // Friulian
	'ff', // Fulani
	'gaa', // Ga
	'gl', // Galician
	'ka', // Georgian
	'de', // German
	'el', // Greek
	'gn', // Guarani
	'gu', // Gujarati
	'ht', // Haitian Creole
	'cnh', // Hakha Chin
	'ha', // Hausa
	'haw', // Hawaiian
	'he', // Hebrew
	'iw', // Hebrew
	'hil', // Hiligaynon
	'hi', // Hindi
	'hmn', // Hmong
	'hu', // Hungarian
	'hrx', // Hunsrik
	'iba', // Iban
	'is', // Icelandic
	'ig', // Igbo
	'ilo', // Ilocano
	'id', // Indonesian
	'ga', // Irish
	'it', // Italian
	'jam', // Jamaican Patois
	'ja', // Japanese
	'jv', // Javanese
	'jw', // Javanese
	'kac', // Jingpo
	'kl', // Kalaallisut
	'kn', // Kannada
	'kr', // Kanuri
	'pam', // Kapampangan
	'kk', // Kazakh
	'kha', // Khasi
	'km', // Khmer
	'cgg', // Kiga
	'kg', // Kikongo
	'rw', // Kinyarwanda
	'ktu', // Kituba
	'trp', // Kokborok
	'kv', // Komi
	'gom', // Konkani
	'ko', // Korean
	'kri', // Krio
	'ku', // Kurdish (Kurmanji)
	'ckb', // Kurdish (Sorani)
	'ky', // Kyrgyz
	'lo', // Lao
	'ltg', // Latgalian
	'la', // Latin
	'lv', // Latvian
	'lij', // Ligurian
	'li', // Limburgish
	'ln', // Lingala
	'lt', // Lithuanian
	'lmo', // Lombard
	'lg', // Luganda
	'luo', // Luo
	'lb', // Luxembourgish
	'mk', // Macedonian
	'mad', // Madurese
	'mai', // Maithili
	'mak', // Makassar
	'mg', // Malagasy
	'ms', // Malay
	'ms-Arab', // Malay (Jawi)
	'ml', // Malayalam
	'mt', // Maltese
	'mam', // Mam
	'gv', // Manx
	'mi', // Maori
	'mr', // Marathi
	'mh', // Marshallese
	'mwr', // Marwadi
	'mfe', // Mauritian Creole
	'chm', // Meadow Mari
	'mni-Mtei', // Meiteilon (Manipuri)
	'min', // Minang
	'lus', // Mizo
	'mn', // Mongolian
	'my', // Myanmar (Burmese)
	'nhe', // Nahuatl (Eastern Huasteca)
	'ndc-ZW', // Ndau
	'nr', // Ndebele (South)
	'new', // Nepalbhasa (Newari)
	'ne', // Nepali
	'bm-Nkoo', // NKo
	'no', // Norwegian
	'nus', // Nuer
	'oc', // Occitan
	'or', // Odia (Oriya)
	'om', // Oromo
	'os', // Ossetian
	'pag', // Pangasinan
	'pap', // Papiamento
	'ps', // Pashto
	'fa', // Persian
	'pl', // Polish
	'pt', // Portuguese (Brazil)
	'pt-PT', // Portuguese (Portugal)
	'pa', // Punjabi (Gurmukhi)
	'pa-Arab', // Punjabi (Shahmukhi)
	'qu', // Quechua
	'kek', // Qʼeqchiʼ
	'rom', // Romani
	'ro', // Romanian
	'rn', // Rundi
	'ru', // Russian
	'se', // Sami (North)
	'sm', // Samoan
	'sg', // Sango
	'sa', // Sanskrit
	'sat-Latn', // Santali
	'gd', // Scots Gaelic
	'nso', // Sepedi
	'sr', // Serbian
	'st', // Sesotho
	'crs', // Seychellois Creole
	'shn', // Shan
	'sn', // Shona
	'scn', // Sicilian
	'szl', // Silesian
	'sd', // Sindhi
	'si', // Sinhala
	'sk', // Slovak
	'sl', // Slovenian
	'so', // Somali
	'es', // Spanish
	'su', // Sundanese
	'sus', // Susu
	'sw', // Swahili
	'ss', // Swati
	'sv', // Swedish
	'ty', // Tahitian
	'tg', // Tajik
	'ber-Latn', // Tamazight
	'ber', // Tamazight (Tifinagh)
	'ta', // Tamil
	'tt', // Tatar
	'te', // Telugu
	'tet', // Tetum
	'th', // Thai
	'bo', // Tibetan
	'ti', // Tigrinya
	'tiv', // Tiv
	'tpi', // Tok Pisin
	'to', // Tongan
	'ts', // Tsonga
	'tn', // Tswana
	'tcy', // Tulu
	'tum', // Tumbuka
	'tr', // Turkish
	'tk', // Turkmen
	'tyv', // Tuvan
	'ak', // Twi
	'udm', // Udmurt
	'uk', // Ukrainian
	'ur', // Urdu
	'ug', // Uyghur
	'uz', // Uzbek
	've', // Venda
	'vec', // Venetian
	'vi', // Vietnamese
	'war', // Waray
	'cy', // Welsh
	'wo', // Wolof
	'xh', // Xhosa
	'sah', // Yakut
	'yi', // Yiddish
	'yo', // Yoruba
	'yua', // Yucatec Maya
	'zap', // Zapotec
	'zu', // Zulu
]

export interface GoogleTranslateTextTranslationOptions {
	tld?: string
	maxCharactersPerPart?: number
}

export const defaultGoogleTranslateTextTranslationOptions: GoogleTranslateTextTranslationOptions = {
	tld: 'com',
	maxCharactersPerPart: 2000,
}
