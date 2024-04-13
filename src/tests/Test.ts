import { getRepetitionScoreRelativeToFirstSubstring, logToStderr, setupProgramTerminationListeners, writeToStderr } from '../utilities/Utilities.js'
import { makeTarballsForInstalledPackages } from '../utilities/TarballMaker.js'
import { testEspeakSynthesisWithPrePhonemizedInputs, testKirshenbaumPhonemization } from '../synthesis/EspeakTTS.js'
import { isPunctuation } from '../nlp/Segmentation.js'

const log = logToStderr

setupProgramTerminationListeners()
//process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
//process.env.http_proxy = 'http://localhost:8080'

//const testText = `After a while, finding that nothing more happened, she decided on going into the garden at once; but, alas for poor Alice! when she got to the door, she found she had forgotten the little golden key, and when she went back to the table for it, she found she could not possibly reach it: she could see it quite plainly through the glass, and she tried her best to climb up one of the legs of the table, but it was too slippery; and when she had tired herself out with trying, the poor little thing sat down and cried.`

//await testKirshenbaumPhonemization(testText)

//await makeTarballsForInstalledPackages(true)

//getRepetitionScoreRelativeToFirstSubstring(['a', 'b', 'c', 'a', 'b', 'c'])
//getRepetitionScoreRelativeToFirstSubstring(['a', 'b', 'a', 'd', 'a', 'b', 'a', 'd'])
//getRepetitionScoreRelativeToFirstSubstring(['a', 'b', 'a', 'b', 'c', 'a', 'b', 'a', 'b'])
//getRepetitionScoreRelativeToFirstSubstring(['a', 'a', 'a', 'b', 'a', 'a', 'a', 'b'])
//getRepetitionScoreRelativeToFirstSubstring(['a', 'b', 'a', 'c', 'a', 'b', 'a', 'c', 'a'])
//getRepetitionScoreRelativeToFirstSubstring(['a', 'a', 'a', 'b', 'b', 'a', 'a', 'a', 'b'])

/*
const allPunctuationChars: string[] = []

for (let i = 0; i < 65536; i++) {
	const char = String.fromCodePoint(i)

	if (isPunctuation(char)) {
		allPunctuationChars.push(char)

		writeToStderr(`${char} `)
	}
}
*/

process.exit(0)

