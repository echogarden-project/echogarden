import chalk from 'chalk'
import { TranslationPair } from '../api/TextTranslation.js'
import { splitToSentences } from '../nlp/Segmentation.js'
import { Logger } from '../utilities/Logger.js'
import { loadPackage } from '../utilities/PackageManager.js'

export async function translateText(sourceText: string, sourceLanguage: string, targetLanguage: string): Promise<TranslationPair[]> {
	const logger = new Logger()

	//const languageNames = Object.keys(languageNameToNLLBCode)

	//logger.log(languageNames)

	logger.start(`Load transformers.js module`)
	const { AutoTokenizer, M2M100ForConditionalGeneration } = await import('@echogarden/transformers-nodejs-lite')

	logger.start(`Load NLLB package`)
	const modelPath = await loadPackage(`xenova-nllb-200-distilled-600M-q8`)

	logger.start(`Load NLLB tokenizer`)
	const tokenizer = await AutoTokenizer.from_pretrained(modelPath)

	logger.start(`Load NLLB model`)
	const model = await M2M100ForConditionalGeneration.from_pretrained(modelPath)

	logger.start(`Split to sentences`)

	const config = {
		src_lang: 'spa_Latn',
		tgt_lang: 'eng_Latn'
	}

	const sentences = splitToSentences(sourceText, sourceLanguage)

	logger.end()

	const translationPairs: TranslationPair[] = []

	for (let i = 0; i < sentences.length; i++) {
		const sentence = sentences[i]

		logger.logTitledMessage(`Translate sentence ${i + 1}/${sentences.length}`, `"${sentence.trim()}"`, chalk.magentaBright)

		logger.start(`Tokenize sentence`)
		const inputs = (tokenizer as any)._build_translation_inputs(sentence, {
			padding: true,
			truncation: true,
		}, config)

		logger.start(`Translate sentence with NLLB model`)
		const translationTokenIds = await model.generate(inputs.input_ids, config)

		logger.start(`Extract tokens`)

		const translationTokens = tokenizer.model.convert_ids_to_tokens(translationTokenIds[0])

		const translatedText = translationTokens
			.slice(2, translationTokens.length - 1)
			.map(token => {
				if (token.startsWith('▁')) {
					return token.replaceAll('▁', ' ')
				}

				return token
			})
			.join('')
			.trim()

		translationPairs.push({
			sourceText: sentence,
			translatedText
		})

		logger.end()
	}

	return translationPairs
}

const languageNameToNLLBCode: Record<string, string> = {
	'Acehnese (Arabic script)': 'ace_Arab',
	'Acehnese (Latin script)': 'ace_Latn',
	'Afrikaans': 'afr_Latn',
	'Akan': 'aka_Latn',
	'Amharic': 'amh_Ethi',
	'Armenian': 'hye_Armn',
	'Assamese': 'asm_Beng',
	'Asturian': 'ast_Latn',
	'Awadhi': 'awa_Deva',
	'Ayacucho Quechua': 'quy_Latn',
	'Balinese': 'ban_Latn',
	'Bambara': 'bam_Latn',
	'Banjar (Arabic script)': 'bjn_Arab',
	'Banjar (Latin script)': 'bjn_Latn',
	'Bashkir': 'bak_Cyrl',
	'Basque': 'eus_Latn',
	'Belarusian': 'bel_Cyrl',
	'Bemba': 'bem_Latn',
	'Bengali': 'ben_Beng',
	'Bhojpuri': 'bho_Deva',
	'Bosnian': 'bos_Latn',
	'Buginese': 'bug_Latn',
	'Bulgarian': 'bul_Cyrl',
	'Burmese': 'mya_Mymr',
	'Catalan': 'cat_Latn',
	'Cebuano': 'ceb_Latn',
	'Central Atlas Tamazight': 'tzm_Tfng',
	'Central Aymara': 'ayr_Latn',
	'Central Kanuri (Arabic script)': 'knc_Arab',
	'Central Kanuri (Latin script)': 'knc_Latn',
	'Central Kurdish': 'ckb_Arab',
	'Chhattisgarhi': 'hne_Deva',
	'Chinese (Simplified)': 'zho_Hans',
	'Chinese (Traditional)': 'zho_Hant',
	'Chokwe': 'cjk_Latn',
	'Crimean Tatar': 'crh_Latn',
	'Croatian': 'hrv_Latn',
	'Czech': 'ces_Latn',
	'Danish': 'dan_Latn',
	'Dari': 'prs_Arab',
	'Dutch': 'nld_Latn',
	'Dyula': 'dyu_Latn',
	'Dzongkha': 'dzo_Tibt',
	'Eastern Panjabi': 'pan_Guru',
	'Eastern Yiddish': 'ydd_Hebr',
	'Egyptian Arabic': 'arz_Arab',
	'English': 'eng_Latn',
	'Esperanto': 'epo_Latn',
	'Estonian': 'est_Latn',
	'Ewe': 'ewe_Latn',
	'Faroese': 'fao_Latn',
	'Fijian': 'fij_Latn',
	'Finnish': 'fin_Latn',
	'Fon': 'fon_Latn',
	'French': 'fra_Latn',
	'Friulian': 'fur_Latn',
	'Galician': 'glg_Latn',
	'Ganda': 'lug_Latn',
	'Georgian': 'kat_Geor',
	'German': 'deu_Latn',
	'Greek': 'ell_Grek',
	'Guarani': 'grn_Latn',
	'Gujarati': 'guj_Gujr',
	'Haitian Creole': 'hat_Latn',
	'Halh Mongolian': 'khk_Cyrl',
	'Hausa': 'hau_Latn',
	'Hebrew': 'heb_Hebr',
	'Hindi': 'hin_Deva',
	'Hungarian': 'hun_Latn',
	'Icelandic': 'isl_Latn',
	'Igbo': 'ibo_Latn',
	'Ilocano': 'ilo_Latn',
	'Indonesian': 'ind_Latn',
	'Irish': 'gle_Latn',
	'Italian': 'ita_Latn',
	'Japanese': 'jpn_Jpan',
	'Javanese': 'jav_Latn',
	'Jingpho': 'kac_Latn',
	'Kabiyè': 'kbp_Latn',
	'Kabuverdianu': 'kea_Latn',
	'Kabyle': 'kab_Latn',
	'Kamba': 'kam_Latn',
	'Kannada': 'kan_Knda',
	'Kashmiri (Arabic script)': 'kas_Arab',
	'Kashmiri (Devanagari script)': 'kas_Deva',
	'Kazakh': 'kaz_Cyrl',
	'Khmer': 'khm_Khmr',
	'Kikongo': 'kon_Latn',
	'Kikuyu': 'kik_Latn',
	'Kimbundu': 'kmb_Latn',
	'Kinyarwanda': 'kin_Latn',
	'Korean': 'kor_Hang',
	'Kyrgyz': 'kir_Cyrl',
	'Lao': 'lao_Laoo',
	'Latgalian': 'ltg_Latn',
	'Ligurian': 'lij_Latn',
	'Limburgish': 'lim_Latn',
	'Lingala': 'lin_Latn',
	'Lithuanian': 'lit_Latn',
	'Lombard': 'lmo_Latn',
	'Luba-Kasai': 'lua_Latn',
	'Luo': 'luo_Latn',
	'Luxembourgish': 'ltz_Latn',
	'Macedonian': 'mkd_Cyrl',
	'Magahi': 'mag_Deva',
	'Maithili': 'mai_Deva',
	'Malayalam': 'mal_Mlym',
	'Maltese': 'mlt_Latn',
	'Maori': 'mri_Latn',
	'Marathi': 'mar_Deva',
	'Meitei (Bengali script)': 'mni_Beng',
	'Mesopotamian Arabic': 'acm_Arab',
	'Minangkabau (Arabic script)': 'min_Arab',
	'Minangkabau (Latin script)': 'min_Latn',
	'Mizo': 'lus_Latn',
	'Modern Standard Arabic (Romanized)': 'arb_Latn',
	'Modern Standard Arabic': 'arb_Arab',
	'Moroccan Arabic': 'ary_Arab',
	'Mossi': 'mos_Latn',
	'Najdi Arabic': 'ars_Arab',
	'Nepali': 'npi_Deva',
	'Nigerian Fulfulde': 'fuv_Latn',
	'North Azerbaijani': 'azj_Latn',
	'North Levantine Arabic': 'apc_Arab',
	'Northern Kurdish': 'kmr_Latn',
	'Northern Sotho': 'nso_Latn',
	'Northern Uzbek': 'uzn_Latn',
	'Norwegian Bokmål': 'nob_Latn',
	'Norwegian Nynorsk': 'nno_Latn',
	'Nuer': 'nus_Latn',
	'Nyanja': 'nya_Latn',
	'Occitan': 'oci_Latn',
	'Odia': 'ory_Orya',
	'Pangasinan': 'pag_Latn',
	'Papiamento': 'pap_Latn',
	'Plateau Malagasy': 'plt_Latn',
	'Polish': 'pol_Latn',
	'Portuguese': 'por_Latn',
	'Romanian': 'ron_Latn',
	'Rundi': 'run_Latn',
	'Russian': 'rus_Cyrl',
	'Samoan': 'smo_Latn',
	'Sango': 'sag_Latn',
	'Sanskrit': 'san_Deva',
	'Santali': 'sat_Olck',
	'Sardinian': 'srd_Latn',
	'Scottish Gaelic': 'gla_Latn',
	'Serbian': 'srp_Cyrl',
	'Shan': 'shn_Mymr',
	'Shona': 'sna_Latn',
	'Sicilian': 'scn_Latn',
	'Silesian': 'szl_Latn',
	'Sindhi': 'snd_Arab',
	'Sinhala': 'sin_Sinh',
	'Slovak': 'slk_Latn',
	'Slovenian': 'slv_Latn',
	'Somali': 'som_Latn',
	'South Azerbaijani': 'azb_Arab',
	'South Levantine Arabic': 'ajp_Arab',
	'Southern Pashto': 'pbt_Arab',
	'Southern Sotho': 'sot_Latn',
	'Southwestern Dinka': 'dik_Latn',
	'Spanish': 'spa_Latn',
	'Standard Latvian': 'lvs_Latn',
	'Standard Malay': 'zsm_Latn',
	'Standard Tibetan': 'bod_Tibt',
	'Sundanese': 'sun_Latn',
	'Swahili': 'swh_Latn',
	'Swati': 'ssw_Latn',
	'Swedish': 'swe_Latn',
	'Tagalog': 'tgl_Latn',
	'Tajik': 'tgk_Cyrl',
	'Tamasheq (Latin script)': 'taq_Latn',
	'Tamasheq (Tifinagh script)': 'taq_Tfng',
	'Tamil': 'tam_Taml',
	'Tatar': 'tat_Cyrl',
	'Ta’izzi-Adeni Arabic': 'acq_Arab',
	'Telugu': 'tel_Telu',
	'Thai': 'tha_Thai',
	'Tigrinya': 'tir_Ethi',
	'Tok Pisin': 'tpi_Latn',
	'Tosk Albanian': 'als_Latn',
	'Tsonga': 'tso_Latn',
	'Tswana': 'tsn_Latn',
	'Tumbuka': 'tum_Latn',
	'Tunisian Arabic': 'aeb_Arab',
	'Turkish': 'tur_Latn',
	'Turkmen': 'tuk_Latn',
	'Twi': 'twi_Latn',
	'Ukrainian': 'ukr_Cyrl',
	'Umbundu': 'umb_Latn',
	'Urdu': 'urd_Arab',
	'Uyghur': 'uig_Arab',
	'Venetian': 'vec_Latn',
	'Vietnamese': 'vie_Latn',
	'Waray': 'war_Latn',
	'Welsh': 'cym_Latn',
	'West Central Oromo': 'gaz_Latn',
	'Western Persian': 'pes_Arab',
	'Wolof': 'wol_Latn',
	'Xhosa': 'xho_Latn',
	'Yoruba': 'yor_Latn',
	'Yue Chinese': 'yue_Hant',
	'Zulu': 'zul_Latn',
}

const languageNameToISO931: { [langName: string]: string } = {
	'Acehnese (Arabic script)': 'unknown', // No ISO 639-1 code for Acehnese
	'Acehnese (Latin script)': 'unknown', // No ISO 639-1 code for Acehnese
	'Afrikaans': 'af',
	'Akan': 'ak',
	'Amharic': 'am',
	'Armenian': 'hy',
	'Assamese': 'as',
	'Asturian': 'ast', // Approximate: ISO 639-3 code
	'Awadhi': 'awa', // Approximate: ISO 639-3 code
	'Ayacucho Quechua': 'qu', // Approximate: Quechua has many variants
	'Balinese': 'ban', // Approximate: ISO 639-3 code
	'Bambara': 'bm',
	'Banjar (Arabic script)': 'unknown', // No ISO 639-1 code for Banjar
	'Banjar (Latin script)': 'unknown', // No ISO 639-1 code for Banjar
	'Bashkir': 'ba',
	'Basque': 'eu',
	'Belarusian': 'be',
	'Bemba': 'bem', // Approximate: ISO 639-3 code
	'Bengali': 'bn',
	'Bhojpuri': 'bho',
	'Bosnian': 'bs',
	'Buginese': 'bug',
	'Bulgarian': 'bg',
	'Burmese': 'my',
	'Catalan': 'ca',
	'Cebuano': 'ceb', // Approximate: ISO 639-2 code
	'Central Atlas Tamazight': 'tzm',
	'Central Aymara': 'ay', // Approximate: Aymara has variants
	'Central Kanuri (Arabic script)': 'kr', // Approximate: Kanuri uses multiple scripts
	'Central Kanuri (Latin script)': 'kr', // Approximate: Kanuri uses multiple scripts
	'Central Kurdish': 'ckb', // Approximate: Kurdish has several variants
	'Chhattisgarhi': 'hne', // Approximate: ISO 639-3 code
	'Chinese (Simplified)': 'zh', // Approximate: zh covers both Simplified and Traditional
	'Chinese (Traditional)': 'zh', // Approximate: zh covers both Simplified and Traditional
	'Chokwe': 'cjk', // Approximate: ISO 639-3 code
	'Crimean Tatar': 'crh', // Approximate: ISO 639-3 code
	'Croatian': 'hr',
	'Czech': 'cs',
	'Danish': 'da',
	'Dari': 'prs', // Approximate: Dari is considered a dialect of Persian
	'Dutch': 'nl',
	'Dyula': 'dyu',
	'Dzongkha': 'dz',
	'Eastern Panjabi': 'pa', // Approximate: Panjabi has multiple writing systems
	'Eastern Yiddish': 'yid', // Approximate: Yiddish has multiple variants
	'Egyptian Arabic': 'arz',
	'English': 'en',
	'Esperanto': 'eo',
	'Estonian': 'et',
	'Ewe': 'ee',
	'Faroese': 'fo',
	'Fijian': 'fj',
	'Finnish': 'fi',
	'Fon': 'fon',
	'French': 'fr',
	'Friulian': 'fur', // Approximate: ISO 639-3 code
	'Galician': 'gl',
	'Ganda': 'lg',
	'Georgian': 'ka',
	'German': 'de',
	'Greek': 'el',
	'Guarani': 'gn',
	'Gujarati': 'gu',
	'Haitian Creole': 'ht',
	'Halh Mongolian': 'mn', // Approximate: Mongolian encompasses several dialects
	'Hausa': 'ha',
	'Hebrew': 'he',
	'Hindi': 'hi',
	'Hungarian': 'hu',
	'Icelandic': 'is',
	'Igbo': 'ig',
	'Ilocano': 'ilo',
	'Indonesian': 'id',
	'Irish': 'ga',
	'Italian': 'it',
	'Japanese': 'ja',
	'Javanese': 'jv',
	'Jingpho': 'kac', // Approximate: ISO 639-3 code
	'Kabiyè': 'kbp', // Approximate: ISO 639-3 code
	'Kabuverdianu': 'kea', // Approximate: ISO 639-3 code
	'Kabyle': 'kab',
	'Kamba': 'kam', // Approximate: ISO 639-3 code
	'Kannada': 'kn',
	'Kashmiri (Arabic script)': 'ks', // Approximate: Kashmiri uses multiple scripts
	'Kashmiri (Devanagari script)': 'ks', // Approximate: Kashmiri uses multiple scripts
	'Kazakh': 'kk',
	'Khmer': 'km',
	'Kikongo': 'kg',
	'Kikuyu': 'ki',
	'Kimbundu': 'kmb',
	'Kinyarwanda': 'rw',
	'Korean': 'ko',
	'Kyrgyz': 'ky',
	'Lao': 'lo',
	'Latgalian': 'ltg', // Approximate: ISO 639-3 code
	'Ligurian': 'lij', // Approximate: ISO 639-3 code
	'Limburgish': 'li', // Approximate: ISO 639-1 code for Limburgish-Ripuarian
	'Lingala': 'ln',
	'Lithuanian': 'lt',
	'Lombard': 'lmo', // Approximate: ISO 639-3 code
	'Luba-Kasai': 'lua',
	'Luo': 'luo',
	'Luxembourgish': 'lb',
	'Macedonian': 'mk',
	'Magahi': 'mag', // Approximate: ISO 639-3 code
	'Maithili': 'mai', // Approximate: ISO 639-3 code
	'Malayalam': 'ml',
	'Maltese': 'mt',
	'Maori': 'mi',
	'Marathi': 'mr',
	'Meitei (Bengali script)': 'mni', // Approximate: Meitei uses multiple scripts
	'Mesopotamian Arabic': 'acm', // Approximate: ISO 639-3 code
	'Minangkabau (Arabic script)': 'min', // Approximate: Minangkabau uses multiple scripts
	'Minangkabau (Latin script)': 'min', // Approximate: Minangkabau uses multiple scripts
	'Mizo': 'lus',
	'Modern Standard Arabic (Romanized)': 'ar', // Approximate: Modern Standard Arabic is a standardized form
	'Modern Standard Arabic': 'ar', // Approximate: Modern Standard Arabic is a standardized form
	'Moroccan Arabic': 'ary',
	'Mossi': 'mos',
	'Najdi Arabic': 'ars', // Approximate: ISO 639-3 code for Najdi Arabic
	'Nepali': 'ne',
	'Nigerian Fulfulde': 'fuv',
	'North Azerbaijani': 'az', // Approximate: Azerbaijani is a pluricentric language
	'North Levantine Arabic': 'apc', // Approximate: ISO 639-3 code for North Levantine Arabic
	'Northern Kurdish': 'kmr', // Approximate: Kurdish has several variants
	'Northern Sotho': 'nso',
	'Northern Uzbek': 'uz', // Approximate: Uzbek is a pluricentric language
	'Norwegian Bokmål': 'nb',
	'Norwegian Nynorsk': 'nn',
	'Nuer': 'nus', // Approximate: ISO 639-3 code
	'Nyanja': 'ny',
	'Occitan': 'oc',
	'Odia': 'or',
	'Pangasinan': 'pag',
	'Papiamento': 'pap',
	'Plateau Malagasy': 'plt', // Approximate: ISO 639-3 code for Plateau Malagasy
	'Polish': 'pl',
	'Portuguese': 'pt',
	'Romanian': 'ro',
	'Rundi': 'rn',
	'Russian': 'ru',
	'Samoan': 'sm',
	'Sango': 'sg',
	'Sanskrit': 'sa',
	'Santali': 'sat',
	'Sardinian': 'sc', // Approximate: Sardinian has several variants
	'Scottish Gaelic': 'gd',
	'Serbian': 'sr',
	'Shan': 'shn', // Approximate: ISO 639-3 code
	'Shona': 'sn',
	'Sicilian': 'scn', // Approximate: ISO 639-3 code
	'Silesian': 'szl', // Approximate: ISO 639-3 code
	'Sindhi': 'sd',
	'Sinhala': 'si',
	'Slovak': 'sk',
	'Slovenian': 'sl',
	'Somali': 'so',
	'South Azerbaijani': 'az', // Approximate: Azerbaijani is a pluricentric language
	'South Levantine Arabic': 'ajp', // Approximate: ISO 639-3 code for South Levantine Arabic
	'Southern Pashto': 'pst', // Approximate: Pashto has several variants
	'Southern Sotho': 'st',
	'Southwestern Dinka': 'dik', // Approximate: ISO 639-3 code for Southwestern Dinka
	'Spanish': 'es',
	'Standard Latvian': 'lv', // Approximate: Standard Latvian is the official form of Latvian
	'Standard Malay': 'ms', // Approximate: Standard Malay is the basis for both Malaysian and Indonesian
	'Standard Tibetan': 'bo', // Approximate: Tibetan has several variants
	'Sundanese': 'su',
	'Swahili': 'sw',
	'Swati': 'ss',
	'Swedish': 'sv',
	'Tagalog': 'tl',
	'Tajik': 'tg',
	'Tamasheq (Latin script)': 'tmh', // Approximate: Tamasheq uses multiple scripts
	'Tamasheq (Tifinagh script)': 'tmh', // Approximate: Tamasheq uses multiple scripts
	'Tamil': 'ta',
	'Tatar': 'tt',
	'Ta’izzi-Adeni Arabic': 'acq', // Approximate: ISO 639-3 code for Ta'izzi-Adeni Arabic
	'Telugu': 'te',
	'Thai': 'th',
	'Tigrinya': 'ti',
	'Tok Pisin': 'tpi',
	'Tosk Albanian': 'sq', // Approximate: Albanian encompasses both Tosk and Gheg dialects
	'Tsonga': 'ts',
	'Tswana': 'tn',
	'Tumbuka': 'tum',
	'Tunisian Arabic': 'aeb', // Approximate: ISO 639-3 code for Tunisian Arabic
	'Turkish': 'tr',
	'Turkmen': 'tk',
	'Twi': 'tw',
	'Ukrainian': 'uk',
	'Umbundu': 'umb',
	'Urdu': 'ur',
	'Uyghur': 'ug',
	'Venetian': 'vec', // Approximate: ISO 639-3 code
	'Vietnamese': 'vi',
	'Waray': 'war',
	'Welsh': 'cy',
	'West Central Oromo': 'om', // Approximate: Oromo has several variants
	'Western Persian': 'fa', // Approximate: Western Persian is the most common variety of Persian
	'Wolof': 'wo',
	'Xhosa': 'xh',
	'Yoruba': 'yo',
	'Yue Chinese': 'yue', // Approximate: ISO 639-3 code
	'Zulu': 'zu'
};
