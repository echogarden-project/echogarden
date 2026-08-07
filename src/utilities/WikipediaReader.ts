import { OperationCallbacks } from '../api/Common.js'
import { isWordOrEmojiOrSymbolWord, splitToParagraphs } from '../nlp/Segmentation.js'

export async function fetchAndParseWikipediaArticle(articleName: string, language: string, callbacks: OperationCallbacks) {
	const { default: wtfWikipedia } = await import('wtf_wikipedia')

	const document = await wtfWikipedia.fetch(articleName, language)

	if (!document) {
		throw new Error('Error fetching Wikipedia article')
	}

	const sections = document.sections()
	const sectionsText: string[] = []

	for (const section of sections) {
		const sectionTitle = section.title()

		if (isWordOrEmojiOrSymbolWord(sectionTitle)) {
			sectionsText.push(sectionTitle)
		}

		const sectionParagraphs = splitToParagraphs(section.text(), 'single', 'preserve')

		for (const paragraph of sectionParagraphs) {
			const paragraphText = paragraph

			if (isWordOrEmojiOrSymbolWord(paragraphText)) {
				sectionsText.push(paragraphText)
			}
		}
	}

	return sectionsText
}
