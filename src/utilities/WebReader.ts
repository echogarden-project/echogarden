import { Readability } from '@mozilla/readability'
import { JSDOM, VirtualConsole } from 'jsdom'
import { request } from 'gaxios'
import { Logger } from './Logger.js'
import { convertHtmlToText } from './Utilities.js'

export async function fetchDocumentText(url: string) {
	const progressLogger = new Logger()
	progressLogger.start(`Fetching ${url}`)

	const response = await request<string>({
		url,
		responseType: 'text',
		headers: {
			'sec-ch-ua': `".Not/A)Brand";v="99", "Google Chrome";v="103", "Chromium";v="103"`,
			'x-same-domain': '1',
			'dnt': '1',
			'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
			'sec-ch-ua-mobile': '?0',
			'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36',
			'sec-ch-ua-arch': 'x86',
			'sec-ch-ua-full-version': '103.0.5060.114',
			'sec-ch-ua-platform-version': '10.0.0',
			'sec-ch-ua-full-version-list': `".Not/A)Brand";v="99.0.0.0", "Google Chrome";v="103.0.5060.114", "Chromium";v="103.0.5060.114"`,
			'sec-ch-ua-bitness': '64',
			'sec-ch-ua-model': '',
			'sec-ch-ua-platform': 'Windows',
			'accept': '*/*',
			//'origin': 'https://www.google.com/',
			'sec-fetch-site': 'same-origin',
			'sec-fetch-mode': 'cors',
			'sec-fetch-dest': 'empty',
			'referer': 'https://www.google.com/',
			'accept-encoding': 'gzip, deflate, br',
			'accept-language': 'en-US,en;q=0.9',
		},
	})

	progressLogger.start(`Parsing document body`)

	const doc = new JSDOM(response.data, {
		url,
		virtualConsole: new VirtualConsole()
	})

	const reader = new Readability(doc.window.document)

	const article = reader.parse()

	const text: string = await convertHtmlToText(article?.content || '')

	progressLogger.end()

	return text
}
