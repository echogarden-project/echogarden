import { Readability } from '@mozilla/readability'
import { JSDOM, VirtualConsole } from 'jsdom'
import { request } from 'gaxios'
import { Logger } from './Logger.js'
import { getChromeOnWindowsHeaders } from './BrowserRequestHeaders.js'
import { convertHtmlToText } from './StringUtilities.js'

export async function fetchDocumentText(url: string) {
	const progressLogger = new Logger()
	progressLogger.start(`Fetch ${url}`)

	const parsedUrl = new URL(url)
	const origin = parsedUrl.origin

	const response = await request<string>({
		url,
		responseType: 'text',

		headers: getChromeOnWindowsHeaders({
			origin: origin,
			referrer: `${origin}/`
		}),
	})

	progressLogger.start(`Parse document body`)

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
