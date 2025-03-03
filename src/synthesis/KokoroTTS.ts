import type * as Onnx from 'onnxruntime-node'
import { Logger } from '../utilities/Logger.js'
import { readdir, readFileAsBinary } from '../utilities/FileSystem.js'
import { joinPath } from '../utilities/PathUtilities.js'
import { getOnnxSessionOptions, OnnxExecutionProvider } from '../utilities/OnnxUtilities.js'
import { SynthesisVoice } from '../api/Synthesis.js'
import { concatAudioSegments, getRawAudioDuration, RawAudio } from '../audio/AudioUtilities.js'
import { defaultEspeakOptions, EspeakOptions } from '../synthesis/EspeakTTS.js'
import { Lexicon } from '../nlp/Lexicon.js'
import { indexOfLastMatchingNumberInRange } from '../utilities/Utilities.js'
import { simplifyPunctuationCharacters } from '../nlp/TextNormalizer.js'
import { getShortLanguageCode } from '../utilities/Locale.js'
import { substituteStringUsingLookup } from '../utilities/StringUtilities.js'

const cachedInstanceLookup = new Map<string, KokoroTTS>()

export async function synthesizeSentence(
	text: string,
	voice: SynthesisVoice,
	speed: number,
	lexicons: Lexicon[],
	modelPath: string,
	voicesPath: string,
	executionProviders: OnnxExecutionProvider[]
) {
	const cacheLookupKey = `${modelPath} ${voicesPath}`

	let kokoroTTS: KokoroTTS | undefined = cachedInstanceLookup.get(cacheLookupKey)

	if (!kokoroTTS) {
		kokoroTTS = new KokoroTTS(modelPath, voicesPath, executionProviders)

		cachedInstanceLookup.clear()
		cachedInstanceLookup.set(cacheLookupKey, kokoroTTS)
	}

	const result = await kokoroTTS.synthesizeSentence(text, voice, speed, lexicons)

	return result
}

export class KokoroTTS {
	session?: Onnx.InferenceSession

	constructor(
		public readonly modelPath: string,
		public readonly voicesPath: string,
		public readonly executionProviders: OnnxExecutionProvider[]
	) {
	}

	async synthesizeSentence(sentenceText: string, voice: SynthesisVoice, speed: number, lexicons: Lexicon[]) {
		await this.initializeSessionIfNeeded()

		const logger = new Logger()

		const Onnx = await import('onnxruntime-node')

		const voiceEntry = voiceList.find(entry => entry.name === voice.name && entry.languages[0] === voice.languages[0])

		if (!voiceEntry) {
			throw new Error(`Kokoro voice '${voice.name}' was not found.`)
		}

		const voicePrimaryLanguage = voice.languages[0]
		const voicePrimaryLanguageShort = getShortLanguageCode(voicePrimaryLanguage)

		sentenceText = //simplifyPunctuationCharacters(sentence.trim())
			sentenceText
				.replaceAll('(', ', ')
				.replaceAll(')', ', ')
				.replaceAll('—', ', ')

		const simplifiedSentenceText = simplifyPunctuationCharacters(sentenceText.trim())

		const voiceLanguage = voiceEntry.languages[0]
		const voiceGender = voiceEntry.gender
		const voiceId = voiceEntry.name.toLocaleLowerCase()

		let filenamePrefix = filenameLanguagePrefixLookup[voiceLanguage]

		if (filenamePrefix === undefined) {
			throw new Error(`Unsupported voice language '${voiceLanguage}'`)
		}

		if (voiceGender === 'male') {
			filenamePrefix += 'm'
		} else if (voiceGender === 'female') {
			filenamePrefix += 'f'
		} else {
			throw new Error(`Unsupported voice gender '${voiceGender}'`)
		}

		const voicePath = joinPath(this.voicesPath, `${filenamePrefix}_${voiceId}.bin`)

		const voiceFile = new Float32Array((await readFileAsBinary(voicePath)).buffer)

		const Espeak = await import('../synthesis/EspeakTTS.js')

		const espeakOptions: EspeakOptions = {
			...defaultEspeakOptions,
			voice: languageToEspeakVoice[voiceLanguage],
			useKlatt: false
		}

		//await logger.startAsync('Phonemize text')

		const {
			referenceSynthesizedAudio,
			referenceTimeline,
			fragments,
			phonemizedFragmentsSubstitutions,
			phonemizedSentence
		} = await Espeak.preprocessAndSynthesize(sentenceText, voiceLanguage, espeakOptions, lexicons)

		logger.end()

		const phraseBreakTokenId = charToTokenIDLookup[',']
		const wordBreakTokenId = charToTokenIDLookup[' ']

		let sentenceEndChar: string

		if (simplifiedSentenceText.endsWith('?') || simplifiedSentenceText.endsWith(`?"`) || simplifiedSentenceText.endsWith(`?)`)) {
			sentenceEndChar = '?'
		} else if (simplifiedSentenceText.endsWith('!') || simplifiedSentenceText.endsWith(`!"`) || simplifiedSentenceText.endsWith(`!)`)) {
			sentenceEndChar = '!'
		} else {
			sentenceEndChar = '.'
		}

		const sentenceEndTokenId = charToTokenIDLookup[sentenceEndChar]

		const allTokenIds: number[] = []

		for (let phraseIndex = 0; phraseIndex < phonemizedSentence.length; phraseIndex++) {
			const phrase = phonemizedSentence[phraseIndex]

			for (let wordIndex = 0; wordIndex < phrase.length; wordIndex++) {
				const word = phrase[wordIndex]

				for (const phoneme of word) {
					let processedPhoneme = phoneme

					if (voicePrimaryLanguageShort === 'en') {
						// Extract stress mark if needed
						let stressMark: string | undefined

						if (phoneme[0] === 'ˈ' || phoneme[0] === 'ˌ') {
							stressMark = phoneme[0]

							processedPhoneme = phoneme.substring(1)
						}

						// Apply English dialect specific substitutions
						if (voicePrimaryLanguage === 'en-GB') {
							processedPhoneme = substituteStringUsingLookup(
								processedPhoneme,
								britishEnglishESpeakToMisakiSubstitutions
							)
						} else {
							processedPhoneme = substituteStringUsingLookup(
								processedPhoneme,
								americanEnglishESpeakToMisakiSubstitutions
							)

							processedPhoneme = processedPhoneme.replaceAll('ː', '')
						}

						// Apply English specific substitutions
						processedPhoneme = substituteStringUsingLookup(
							processedPhoneme,
							englishESpeakToMisakiSubstitutions
						)

						// Bring back stress mark if needed
						if (stressMark !== undefined) {
							processedPhoneme = stressMark + processedPhoneme
						}

						// Workaround a word having only 'I' not being pronounced at some cases
						if (processedPhoneme === 'I' && word.length === 1) {
							processedPhoneme = 'aɪ'
							//processedPhoneme = 'I'
						}
					}

					// Perform tokenization
					for (const phonemeCharacter of processedPhoneme) {
						const id = charToTokenIDLookup[phonemeCharacter]

						if (id !== undefined) {
							allTokenIds.push(id)
						}
					}
				}

				if (wordIndex < phrase.length - 1) {
					allTokenIds.push(wordBreakTokenId)
				} else {
					if (phraseIndex < phonemizedSentence.length - 1) {
						allTokenIds.push(phraseBreakTokenId)
						allTokenIds.push(wordBreakTokenId)
					}
				}
			}
		}

		allTokenIds.push(sentenceEndTokenId)

		const maxPartLength = 510

		const parts: number[][] = []

		{
			let startIndex = 0
			let endIndex = 0

			while (endIndex < allTokenIds.length) {
				endIndex = startIndex + maxPartLength

				if (endIndex >= allTokenIds.length) {
					endIndex = allTokenIds.length
				} else {
					const indexOfLastPhraseBreak = indexOfLastMatchingNumberInRange(allTokenIds, phraseBreakTokenId, startIndex, endIndex)

					if (indexOfLastPhraseBreak !== -1) {
						endIndex = indexOfLastPhraseBreak + 1
					} else {
						const indexOfLastWordBreak = indexOfLastMatchingNumberInRange(allTokenIds, wordBreakTokenId, startIndex, endIndex)

						if (indexOfLastWordBreak !== -1) {
							endIndex = indexOfLastWordBreak + 1
						}
					}
				}

				const partTokenIds = allTokenIds.slice(startIndex, endIndex)

				if (partTokenIds[partTokenIds.length - 1] === phraseBreakTokenId) {
					partTokenIds.pop()
				}


				if (partTokenIds.find(
					tokenId => ![wordBreakTokenId, phraseBreakTokenId, sentenceEndTokenId].includes(tokenId))) {

					parts.push([0, ...partTokenIds, 0])
				}

				startIndex = endIndex
			}
		}

		const styleLength = 256
		const sampleRate = 24000

		const audioParts: Float32Array[][] = []

		for (let partIndex = 0; partIndex < parts.length; partIndex++) {
			if (parts.length === 1) {
				await logger.startAsync(`Synthesize sentence with ONNX model`)
			} else {
				await logger.startAsync(`Synthesize sentence fragment ${partIndex + 1}/${parts.length} with ONNX model`)
			}

			const part = parts[partIndex]

			const styleDataStartOffset = part.length * styleLength

			const styleData = voiceFile.slice(styleDataStartOffset, styleDataStartOffset + styleLength)

			const modelInputs = {
				input_ids: new Onnx.Tensor('int64', BigInt64Array.from(part.map(x => BigInt(x))), [1, part.length]),
				style: new Onnx.Tensor('float32', styleData, [1, styleLength]),
				speed: new Onnx.Tensor('float32', [speed], [1]),
			}

			const result = await this.session!.run(modelInputs)

			const outSamples = result.waveform.data as Float32Array

			audioParts.push([outSamples])
		}

		logger.end()

		const concatenatedAudioParts = audioParts.length > 0 ? concatAudioSegments(audioParts) : [new Float32Array(0)]

		const synthesizedAudio: RawAudio = { audioChannels: concatenatedAudioParts, sampleRate }

		await logger.startAsync('Align with reference synthesized audio')

		const { alignUsingDtw } = await import('../alignment/SpeechAlignment.js')

		const referenceWordTimeline = referenceTimeline.flatMap(phrase => phrase.timeline!)

		const dtwWindowDuration = Math.max(5, Math.ceil(0.2 * getRawAudioDuration(synthesizedAudio)))
		const mappedTimeline = await alignUsingDtw(synthesizedAudio, referenceSynthesizedAudio, referenceWordTimeline, ['high'], [dtwWindowDuration])

		logger.end()

		return { rawAudio: synthesizedAudio, timeline: mappedTimeline }
	}

	async initializeSessionIfNeeded() {
		if (this.session) {
			return
		}

		const logger = new Logger()
		await logger.startAsync('Initialize Kokoro ONNX synthesis model')

		const filesInModelPath = await readdir(this.modelPath)
		const onnxModelFilename = filesInModelPath.find(filename => filename.endsWith('.onnx'))

		if (!onnxModelFilename) {
			throw new Error(`Couldn't file any ONNX model file in ${this.modelPath}`)
		}

		const onnxModelFilepath = joinPath(this.modelPath, onnxModelFilename)
		const onnxSessionOptions = getOnnxSessionOptions({ executionProviders: this.executionProviders })

		const Onnx = await import('onnxruntime-node')

		this.session = await Onnx.InferenceSession.create(onnxModelFilepath, onnxSessionOptions)

		logger.end()
	}
}

const charToTokenIDLookup: Record<string, number> = {
	';': 1,
	':': 2,
	',': 3,
	'.': 4,
	'!': 5,
	'?': 6,
	'—': 9,
	'…': 10,
	'\'': 11,
	'(': 12,
	')': 13,
	'“': 14,
	'”': 15,
	' ': 16,
	'\u0303': 17,
	'ʣ': 18,
	'ʥ': 19,
	'ʦ': 20,
	'ʨ': 21,
	'ᵝ': 22,
	'\uAB67': 23,
	'A': 24,
	'I': 25,
	'O': 31,
	'Q': 33,
	'S': 35,
	'T': 36,
	'W': 39,
	'Y': 41,
	'ᵊ': 42,
	'a': 43,
	'b': 44,
	'c': 45,
	'd': 46,
	'e': 47,
	'f': 48,
	'h': 50,
	'i': 51,
	'j': 52,
	'k': 53,
	'l': 54,
	'm': 55,
	'n': 56,
	'o': 57,
	'p': 58,
	'q': 59,
	'r': 60,
	's': 61,
	't': 62,
	'u': 63,
	'v': 64,
	'w': 65,
	'x': 66,
	'y': 67,
	'z': 68,
	'ɑ': 69,
	'ɐ': 70,
	'ɒ': 71,
	'æ': 72,
	'β': 75,
	'ɔ': 76,
	'ɕ': 77,
	'ç': 78,
	'ɖ': 80,
	'ð': 81,
	'ʤ': 82,
	'ə': 83,
	'ɚ': 85,
	'ɛ': 86,
	'ɜ': 87,
	'ɟ': 90,
	'ɡ': 92,
	'ɥ': 99,
	'ɨ': 101,
	'ɪ': 102,
	'ʝ': 103,
	'ɯ': 110,
	'ɰ': 111,
	'ŋ': 112,
	'ɳ': 113,
	'ɲ': 114,
	'ɴ': 115,
	'ø': 116,
	'ɸ': 118,
	'θ': 119,
	'œ': 120,
	'ɹ': 123,
	'ɾ': 125,
	'ɻ': 126,
	'ʁ': 128,
	'ɽ': 129,
	'ʂ': 130,
	'ʃ': 131,
	'ʈ': 132,
	'ʧ': 133,
	'ʊ': 135,
	'ʋ': 136,
	'ʌ': 138,
	'ɣ': 139,
	'ɤ': 140,
	'χ': 142,
	'ʎ': 143,
	'ʒ': 147,
	'ʔ': 148,
	'ˈ': 156,
	'ˌ': 157,
	'ː': 158,
	'ʰ': 162,
	'ʲ': 164,
	'↓': 169,
	'→': 171,
	'↗': 172,
	'↘': 173,
	'ᵻ': 177
}

const englishESpeakToMisakiSubstitutions = {
	'aɪ': 'I',
	'aɪɚ': 'Iəɹ',
	'aʊ': 'W',
	'dʒ': 'ʤ',
	'e': 'A',
	'eɪ': 'A',
	'r': 'ɹ',
	'tʃ': 'ʧ',
	'x': 'k',
	'ç': 'k',
	'ɐ': 'ə',
	'ɔɪ': 'Y',
	'əl': 'ᵊl',
	'ɚ': 'əɹ',
	'ɬ': 'l',
	'ʔ': 't',
	'ʔn': 'tᵊn',
	'ʔˌn\u0329': 'tᵊn',
	'ʲ': '',
	'ʲO': 'jO',
	'ʲQ': 'jQ',

	// Make these substitutions regardless of dialect:
	'əʊ': 'Q',
	'oʊ': 'O',
}

const britishEnglishESpeakToMisakiSubstitutions = {
	'eə': 'ɛː',
	'iə': 'ɪə',
	//'əʊ': 'Q',
}

const americanEnglishESpeakToMisakiSubstitutions = {
	//'oʊ': 'O',
	'ɜːɹ': 'ɜɹ',
	'ɜː': 'ɜɹ',
	'ɪə': 'iə',
}

const filenameLanguagePrefixLookup: Record<string, string> = {
	'en-US': 'a',
	'en-GB': 'b',
	'es-ES': 'e',
	'fr-FR': 'f',
	'hi-IN': 'h',
	'it-IT': 'i',
	'ja-JP': 'j',
	'pt-BR': 'p',
	'zh-CN': 'z',
}

const languageToEspeakVoice: Record<string, string> = {
	'en-US': 'en-us',
	'en-GB': 'en-gb-x-rp',
	'es-ES': 'es-419',
	'fr-FR': 'fr',
	'hi-IN': 'hi',
	'it-IT': 'it',
	'ja-JP': 'ja',
	'pt-BR': 'pt-br',
	'zh-CN': 'cmn',
}

export const voiceList: SynthesisVoice[] = [
	// US English voices
	{
		name: 'Heart',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'Bella',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'Nicole',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'Aoede',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'Kore',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'Sarah',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'Nova',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'Sky',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'Alloy',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'Jessica',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'River',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'Michael',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'Fenrir',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'Puck',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'Echo',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'Eric',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'Liam',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'Onyx',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'Santa',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'Adam',
		languages: ['en-US', 'en'],
		gender: 'male',
	},

	// UK English voices
	{
		name: 'Emma',
		languages: ['en-GB', 'en'],
		gender: 'female',
	},
	{
		name: 'Isabella',
		languages: ['en-GB', 'en'],
		gender: 'female',
	},
	{
		name: 'Alice',
		languages: ['en-GB', 'en'],
		gender: 'female',
	},
	{
		name: 'Lily',
		languages: ['en-GB', 'en'],
		gender: 'female',
	},
	{
		name: 'George',
		languages: ['en-GB', 'en'],
		gender: 'male',
	},
	{
		name: 'Fable',
		languages: ['en-GB', 'en'],
		gender: 'male',
	},
	{
		name: 'Lewis',
		languages: ['en-GB', 'en'],
		gender: 'male',
	},
	{
		name: 'Daniel',
		languages: ['en-GB', 'en'],
		gender: 'male',
	},

	// Spanish (Spain) voices
	{
		name: 'Dora',
		languages: ['es-ES', 'es'],
		gender: 'female',
	},
	{
		name: 'Alex',
		languages: ['es-ES', 'es'],
		gender: 'male',
	},
	{
		name: 'Santa',
		languages: ['es-ES', 'es'],
		gender: 'male',
	},

	// French (France) voices
	{
		name: 'Siwis',
		languages: ['fr-FR', 'fr'],
		gender: 'female',
	},

	// Hindi (India) voices
	{
		name: 'Alpha',
		languages: ['hi-IN', 'hi'],
		gender: 'female',
	},
	{
		name: 'Beta',
		languages: ['hi-IN', 'hi'],
		gender: 'female',
	},
	{
		name: 'Omega',
		languages: ['hi-IN', 'hi'],
		gender: 'male',
	},
	{
		name: 'Psi',
		languages: ['hi-IN', 'hi'],
		gender: 'male',
	},

	// Italian (Italy) voices
	{
		name: 'Sara',
		languages: ['it-IT', 'it'],
		gender: 'female',
	},
	{
		name: 'Nicola',
		languages: ['it-IT', 'it'],
		gender: 'male',
	},

	// Portuguese (Brazil) voices
	{
		name: 'Dora',
		languages: ['pt-BR', 'pt'],
		gender: 'female',
	},
	{
		name: 'Alex',
		languages: ['pt-BR', 'pt'],
		gender: 'male',
	},
	{
		name: 'Santa',
		languages: ['pt-BR', 'pt'],
		gender: 'male',
	},

	// Chinese (China) voices
	{
		name: 'Xiaobei',
		languages: ['zh-CN', 'zh'],
		gender: 'female',
	},
	{
		name: 'Xiaoni',
		languages: ['zh-CN', 'zh'],
		gender: 'female',
	},
	{
		name: 'Xiaoxiao',
		languages: ['zh-CN', 'zh'],
		gender: 'female',
	},
	{
		name: 'Xiaoyi',
		languages: ['zh-CN', 'zh'],
		gender: 'female',
	},
	{
		name: 'Yunjian',
		languages: ['zh-CN', 'zh'],
		gender: 'male',
	},
	{
		name: 'Yunxi',
		languages: ['zh-CN', 'zh'],
		gender: 'male',
	},
	{
		name: 'Yunxia',
		languages: ['zh-CN', 'zh'],
		gender: 'male',
	},
	{
		name: 'Yunyang',
		languages: ['zh-CN', 'zh'],
		gender: 'male',
	},
]
