export async function splitChineseTextToWords_Jieba(text: string, fineGrained = false, useHMM = true) {
	const jieba = await getJiebaWasmInstance()

	if (!fineGrained) {
		return jieba.cut(text, useHMM)
	} else {
		const results = jieba.tokenize(text, 'search', useHMM)

		const startOffsetsSet = new Set<number>()
		const endOffsetsSet = new Set<number>()

		for (const result of results) {
			startOffsetsSet.add(result.start)
			endOffsetsSet.add(result.end)
		}

		const startOffsets = Array.from(startOffsetsSet)
		startOffsets.sort((a, b) => a - b)

		const endOffsets = Array.from(endOffsetsSet)
		endOffsets.sort((a, b) => a - b)

		const words: string[] = []

		for (let i = 0; i < startOffsets.length; i++) {
			const wordStartOffset = startOffsets[i]

			function getWordEndOffset() {
				if (i < startOffsets.length - 1) {
					const nextWordStartOffset = startOffsets[i + 1]

					for (let j = 0; j < endOffsets.length - 1; j++) {
						const currentEndOffset = endOffsets[j]
						const nextEndOffset = endOffsets[j + 1]

						if (currentEndOffset >= nextWordStartOffset) {
							return nextWordStartOffset
						} else if (
							currentEndOffset > wordStartOffset &&
							currentEndOffset < nextWordStartOffset &&
							nextEndOffset > nextWordStartOffset) {

							return currentEndOffset
						}
					}
				}

				return endOffsets[endOffsets.length - 1]
			}

			const wordEndOffset = getWordEndOffset()

			words.push(text.substring(wordStartOffset, wordEndOffset))
		}

		return words
	}
}

let JiebaWasmInstance: typeof import('jieba-wasm')

async function getJiebaWasmInstance() {
	if (!JiebaWasmInstance) {
		const { default: JiebaWasm } = await import('jieba-wasm')

		JiebaWasmInstance = JiebaWasm
	}

	return JiebaWasmInstance
}
