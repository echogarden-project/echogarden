import { splitToParagraphs, wordCharacterPattern } from '../nlp/Segmentation.js'
import { Logger } from './Logger.js'

export async function parseWikipediaArticle(articleName: string, language: string) {
	const logger = new Logger()

	await logger.startAsync('Fetching Wikipedia article')

	const { default: wtf } = await import('wtf_wikipedia')

	const document = await wtf.fetch(articleName, language)

	if (!document) {
		throw new Error('Error fetching Wikipedia article')
	}

	const sections = document.sections()
	const sectionsText: string[] = []

	for (const section of sections) {
		const sectionTitle = section.title()

		if (wordCharacterPattern.test(sectionTitle)) {
			sectionsText.push(sectionTitle)
		}

		const sectionParagraphs = splitToParagraphs(section.text(), 'single', 'preserve')

		for (const paragraph of sectionParagraphs) {
			const paragraphText = paragraph

			if (wordCharacterPattern.test(paragraphText)) {
				sectionsText.push(paragraphText)
			}
		}
	}

	logger.end()

	return sectionsText
}
