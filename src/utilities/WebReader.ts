import { Readability } from '@mozilla/readability'
import { JSDOM, VirtualConsole } from 'jsdom'
import { Logger } from './Logger.js'
import { getChromeOnWindowsHeaders } from './BrowserRequestHeaders.js'
import { convertHtmlToText } from './StringUtilities.js'
import { requestHttp } from 'easier-http-request'
import { OperationCallbacks } from '../api/Common.js'

export async function fetchDocumentText(url: string, callbacks: OperationCallbacks) {
	const progressLogger = new Logger(callbacks.logLevel)

	progressLogger.start(`Fetch ${url}`)

	const parsedUrl = new URL(url)
	const origin = parsedUrl.origin

	const response = await requestHttp({
		url,

		headers: getChromeOnWindowsHeaders({
			origin: origin,
			referrer: `${origin}/`
		}),

		abortSignal: callbacks?.abortSignal
	})

	const responseBodyText = await response.text()

	progressLogger.start(`Parse document body`)

	const doc = new JSDOM(responseBodyText, {
		url,
		virtualConsole: new VirtualConsole()
	})

	const reader = new Readability(doc.window.document)

	const article = reader.parse()

	const text: string = await convertHtmlToText(article?.content || '')

	progressLogger.end()

	return text
}
