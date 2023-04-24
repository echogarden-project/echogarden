import path from "path"
import { OpenPromise } from "../utilities/OpenPromise.js"
import { getModuleRootDir } from "../utilities/FileSystem.js"

export async function splitJapaneseTextToWords_Kuromoji(text: string) {
	const tokenizer = await getKuromojiTokenizer()

	const results: any[] = tokenizer.tokenize(text)
	const words = results.map(entry => entry.surface_form)

	return words
}

let kuromojiTokenizer: any

async function getKuromojiTokenizer() {
	if (kuromojiTokenizer) {
		return kuromojiTokenizer
	}

	const { default: kuromoji } = await import("kuromoji")

	const resultOpenPromise = new OpenPromise<any>()

	const dictionaryPath = path.join(getModuleRootDir(), "node_modules", "kuromoji", "dict")

	kuromoji.builder({ dicPath: dictionaryPath }).build(function (error: any, tokenizer: any) {
		if (error) {
			resultOpenPromise.reject(error)
			return
		}

		kuromojiTokenizer = tokenizer

		resultOpenPromise.resolve(kuromojiTokenizer)
	})

	return resultOpenPromise.promise
}

/*
export async function splitJapaneseTextToWords_Sudachi(text: string, mode: 0 | 1 | 2) {
	const { TokenizeMode, tokenize } = await import("sudachi")

	const resultString = tokenize(text, mode)

	const parsedResult: any[] = JSON.parse(resultString)
	const result = parsedResult.map(entry => entry.surface)

	return result
}
*/
