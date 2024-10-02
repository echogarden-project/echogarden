import { request } from "gaxios"
import { Logger } from "../utilities/Logger.js"
import { splitToSentences } from "../nlp/Segmentation.js"
import { TranslationPair } from "../api/TextTranslation.js"
import { getChromeOnWindowsHeaders } from "../utilities/BrowserRequestHeaders.js"

export async function translateText(text: string, sourceLanguage: string, targetLanguage: string): Promise<TranslationPair[]> {
	const logger = new Logger()

	logger.start(`Prepare request`)

	const textSentences = splitToSentences(text, sourceLanguage)

	const requestBodyObject = {
		jsonrpc: '2.0',
		method: 'LMT_handle_jobs',
		params: {
			jobs: [
				{
					kind: 'default',
					sentences: [
						{
							text: textSentences[0],
							id: 1,
							prefix: '',
						}
					],
					raw_en_context_before: [],
					raw_en_context_after: [],
					preferred_num_beams: 4,
					quality: 'fast',
				}
			],

			lang: {
				target_lang: targetLanguage.toUpperCase(),

				preference: {
					weight: {},
					default: 'default',
				},

				source_lang_computed: sourceLanguage.toUpperCase(),
			},

			priority: -1,

			commonJobParams: {
				mode: 'translate',
				browserType: 1,
				textType: 'plaintext',
			},

			timestamp: Date.now(),
		},

		id: 756456347,
	}

	const response = await request<any>({
		method: 'POST',

		url: `https://www2.deepl.com/jsonrpc`,

		params: {
			'method': 'LMT_handle_jobs',
		},

		headers: {
			...getChromeOnWindowsHeaders({
				origin: 'https://www.deepl.com',
				referrer: `https://www.deepl.com/`
			}),

			'Content-Type': 'application/json',
		},

		body: JSON.stringify(requestBodyObject),

		responseType: 'json'
	})

	logger.start('Parse response')

	logger.end()

	return []
}
