import type { InferenceSession } from 'onnxruntime-node'
import { SynthesisVoice } from '../api/API.js'
import { Logger } from "../utilities/Logger.js"
import { RawAudio, getEmptyRawAudio } from "../audio/AudioUtilities.js"
import { Lexicon } from "../nlp/Lexicon.js"
import { Timeline } from "../utilities/Timeline.js"
import { readAndParseJsonFile } from "../utilities/FileSystem.js"

const cachedInstanceLookup = new Map<string, VitsTTS>()

export async function synthesizeSentence(text: string, voiceName: string, modelPath: string, lengthScale: number, speakerId = 0, substitutionLexicons?: Lexicon[]) {
	const cacheLookupKey = modelPath

	let vitsTTS: VitsTTS | undefined = cachedInstanceLookup.get(cacheLookupKey)

	if (!vitsTTS) {
		vitsTTS = new VitsTTS(voiceName, modelPath)
		await vitsTTS.initialize()

		cachedInstanceLookup.set(cacheLookupKey, vitsTTS)
	}

	const result = await vitsTTS.synthesizeSentence(text, lengthScale, speakerId, substitutionLexicons)

	return result
}

export class VitsTTS {
	voiceName: string
	modelPath: string

	modelSession?: InferenceSession
	metadata?: any
	phonemeMap?: Map<string, number[]>

	constructor(voiceName: string, modelPath: string) {
		this.voiceName = voiceName
		this.modelPath = modelPath
	}

	async initialize() {
		const logger = new Logger()
		await logger.startAsync("Initialize VITS ONNX synthesis model")

		const onnxOptions: InferenceSession.SessionOptions = {
			logSeverityLevel: 3
		}

		const { default: Onnx } = await import('onnxruntime-node')

		this.modelSession = await Onnx.InferenceSession.create(`${this.modelPath}/${this.voiceName}.onnx`, onnxOptions)
		this.metadata = await readAndParseJsonFile(`${this.modelPath}/${this.voiceName}.onnx.json`)

		this.phonemeMap = new Map<string, number[]>()

		for (const key in this.metadata.phoneme_id_map) {
			this.phonemeMap.set(key, this.metadata.phoneme_id_map[key])
		}

		logger.end()
	}

	async synthesizeSentence(sentence: string, lengthScale: number, speakerId = 0, substitutionLexicons?: Lexicon[]) {
		const logger = new Logger()

		if (!this.modelSession) {
			throw new Error("Model has not been initialized")
		}

		await logger.startAsync("Prepare for synthesis")

		const metadata = this.metadata
		const phonemeMap = this.phonemeMap!
		const espeakVoice = metadata.espeak.voice
		const outputSampleRate = metadata.audio.sample_rate

		sentence = //simplifyPunctuationCharacters(sentence.trim())
			sentence
				.replaceAll("(", ", ")
				.replaceAll(")", ", ")
				.replaceAll("—", ", ")

		const Espeak = await import("../synthesis/EspeakTTS.js")

		logger.end()

		const { referenceSynthesizedAudio, referenceTimeline, fragments, phonemizedFragmentsSubstitutions, phonemizedSentence } = await Espeak.preprocessAndSynthesizeSentence(sentence, espeakVoice, substitutionLexicons, true)

		if (phonemizedSentence.length == 0) {
			logger.end()

			return {
				rawAudio: getEmptyRawAudio(1, outputSampleRate),
				timeline: [],
				referenceSynthesizedAudio: getEmptyRawAudio(1, outputSampleRate),
				referenceTimeline: [] as Timeline
			}
		}

		await logger.startAsync("Encode phonemes to identifiers")

		const clauseEndBreaker = ","
		let sentenceEndBreaker = "."

		if (sentence.endsWith("?") || sentence.endsWith("?\"")) {
			sentenceEndBreaker = "?"
		} else if (sentence.endsWith("!") || sentence.endsWith("!\"")) {
			sentenceEndBreaker = "!"
		}

		const phonemeCharacterSeparatorId = phonemeMap.get("_")!
		const wordSeparatorId = phonemeMap.get(" ")!
		const startId = phonemeMap.get("^")!
		const endId = phonemeMap.get("$")!

		const clauseEndBreakerId = phonemeMap.get(clauseEndBreaker)!
		const sentenceEndBreakerId = phonemeMap.get(sentenceEndBreaker)!

		const ids: number[] = [...startId, ...phonemeCharacterSeparatorId]

		for (let clauseIndex = 0; clauseIndex < phonemizedSentence.length; clauseIndex++) {
			const clause = phonemizedSentence[clauseIndex]

			for (const word of clause) {
				for (const phoneme of word) {
					for (const phonemeCharacter of phoneme) {
						const id = phonemeMap.get(phonemeCharacter)

						if (id == null) {
							//logger.log(`No id found for subphoneme "${char}"`)
							continue
						}

						ids.push(...id, ...phonemeCharacterSeparatorId)
					}
				}

				if (clauseIndex < phonemizedSentence.length - 1) {
					ids.push(...wordSeparatorId, ...phonemeCharacterSeparatorId)
				}
			}

			if (clauseIndex < phonemizedSentence.length - 1) {
				ids.push(...clauseEndBreakerId, ...phonemeCharacterSeparatorId)
			}
		}

		ids.push(...sentenceEndBreakerId, ...phonemeCharacterSeparatorId, ...endId)

		//logger.log(ids)

		const bigIntIds = new BigInt64Array(ids.map(id => BigInt(id)))
		const idLengths = new BigInt64Array([BigInt(bigIntIds.length)])

		await logger.startAsync("Generate audio using synthesis model")
		
		const { default: Onnx } = await import('onnxruntime-node')

		const inputTensor = new Onnx.Tensor('int64', bigIntIds, [1, bigIntIds.length])
		const inputLengthsTensor = new Onnx.Tensor('int64', idLengths, [1])
		const scalesTensor = new Onnx.Tensor('float32', [metadata.inference.noise_scale, lengthScale, metadata.inference.noise_w], [3])
		const speakerIdTensor = new Onnx.Tensor('int64', new BigInt64Array([BigInt(speakerId)]), [1])

		const modelInputs = { input: inputTensor, input_lengths: inputLengthsTensor, scales: scalesTensor, sid: speakerIdTensor }

		const modelResults = await this.modelSession.run(modelInputs)
		const modelOutput = modelResults["output"]

		const synthesizedAudio = modelOutput['data'] as Float32Array

		const rawAudio: RawAudio = { audioChannels: [synthesizedAudio], sampleRate: outputSampleRate }

		await logger.startAsync("Align with reference synthesized audio")

		const { alignUsingDtw } = await import("../alignment/SpeechAlignment.js")

		const referenceWordTimeline = referenceTimeline.flatMap(clause => clause.timeline!)

		for (const wordEntry of referenceWordTimeline) {
			wordEntry.timeline = wordEntry.timeline!.flatMap(tokenEntry => tokenEntry.timeline!)
		}

		const mappedTimeline = await alignUsingDtw(rawAudio, referenceSynthesizedAudio, referenceWordTimeline)

		logger.end()

		return { rawAudio, timeline: mappedTimeline, referenceSynthesizedAudio, referenceTimeline }
	}
}

export const voiceList: SynthesisVoice[] = [
	{
		name: "ca-upc_ona-x-low",
		languages: ["ca-ES", "ca"],
		gender: "female",
	},
	{
		name: "ca-upc_pau-x-low",
		languages: ["ca-ES", "ca"],
		gender: "male",
	},

	{
		name: "da-nst_talesyntese-medium",
		languages: ["da-DK", "da"],
		gender: "male",
	},

	{
		name: "de-thorsten-low",
		languages: ["de-DE", "de"],
		gender: "male",
	},
	{
		name: "de-eva_k-x-low",
		languages: ["de-DE", "de"],
		gender: "female",
	},
	{
		name: "de-ramona-low",
		languages: ["de-DE", "de"],
		gender: "female",
	},
	{
		name: "de-pavoque-low",
		languages: ["de-DE", "de"],
		gender: "male",
	},
	{
		name: "de-kerstin-low",
		languages: ["de-DE", "de"],
		gender: "female",
	},
	{
		name: "de-karlsson-low",
		languages: ["de-DE", "de"],
		gender: "male",
	},

	{
		name: "el-gr-rapunzelina-low",
		languages: ["el-GR", "el"],
		gender: "female",
	},


	{
		name: "en-gb-danny-low",
		languages: ["en-GB", "en"],
		gender: "male",
	},
	{
		name: "en-gb-alan-low",
		languages: ["en-GB", "en"],
		gender: "male",
	},
	{
		name: "en-gb-southern_english_female-low",
		languages: ["en-GB", "en"],
		gender: "female",
	},

	{
		name: "en-us-amy-low",
		languages: ["en-US", "en"],
		gender: "female",
	},
	{
		name: "en-us-kathleen-low",
		languages: ["en-US", "en"],
		gender: "female",
	},
	{
		name: "en-us-lessac-low",
		languages: ["en-US", "en"],
		gender: "female",
	},
	{
		name: "en-us-lessac-medium",
		languages: ["en-US", "en"],
		gender: "female",
	},
	{
		name: "en-us-libritts-high",
		languages: ["en-US", "en"],
		gender: "unknown",
		speakerCount: 904,
	},
	{
		name: "en-us-ryan-low",
		languages: ["en-US", "en"],
		gender: "male",
	},
	{
		name: "en-us-ryan-medium",
		languages: ["en-US", "en"],
		gender: "male",
	},
	{
		name: "en-us-ryan-high",
		languages: ["en-US", "en"],
		gender: "male",
	},

	{
		name: "es-carlfm-x-low",
		languages: ["es-ES", "es"],
		gender: "male",
	},
	{
		name: "es-mls_9972-low",
		languages: ["es-ES", "es"],
		gender: "male",
	},
	{
		name: "es-mls_10246-low",
		languages: ["es-ES", "es"],
		gender: "male",
	},

	{
		name: "fi-harri-low",
		languages: ["fi-FI", "fi"],
		gender: "female",
	},

	{
		name: "fr-siwis-low",
		languages: ["fr-FR", "fr"],
		gender: "female",
	},
	{
		name: "fr-siwis-medium",
		languages: ["fr-FR", "fr"],
		gender: "female",
	},
	{
		name: "fr-mls_1840-low",
		languages: ["fr-FR", "fr"],
		gender: "male",
	},

	{
		name: "it-riccardo_fasol-x-low",
		languages: ["it-IT", "it"],
		gender: "male",
	},

	{
		name: "kk-iseke-x-low",
		languages: ["kk-KZ", "kk"],
		gender: "unknown",
		speakerCount: 6,
	},
	{
		name: "kk-raya-x-low",
		languages: ["kk-KZ", "kk"],
		gender: "male",
	},
	{
		name: "kk-issai-high",
		languages: ["kk-KZ", "kk"],
		gender: "male",
	},

	{
		name: "ne-google-medium",
		languages: ["ne-NP", "ne"],
		gender: "female",
		speakerCount: 18,
	},
	{
		name: "ne-google-x-low",
		languages: ["ne-NP", "ne"],
		gender: "female",
		speakerCount: 18,
	},

	{
		name: "nl-nathalie-x-low",
		languages: ["nl-NL", "nl"],
		gender: "female",
	},
	{
		name: "nl-rdh-medium",
		languages: ["nl-NL", "nl"],
		gender: "male",
	},
	{
		name: "nl-rdh-x-low",
		languages: ["nl-NL", "nl"],
		gender: "male",
	},
	{
		name: "nl-mls_5809-low",
		languages: ["nl-NL", "nl"],
		gender: "female",
	},
	{
		name: "nl-mls_7432-low",
		languages: ["nl-NL", "nl"],
		gender: "female",
	},

	{
		name: "no-talesyntese-medium",
		languages: ["no-NO", "no"],
		gender: "male",
	},

	{
		name: "pl-mls_6892-low",
		languages: ["pl-PL", "pl"],
		gender: "male",
	},

	{
		name: "pt-br-edresson-low",
		languages: ["pt-BR", "pt"],
		gender: "male",
	},

	{
		name: "uk-lada-x-low",
		languages: ["uk-UA", "uk"],
		gender: "female",
	},

	{
		name: "vi-vivos-x-low",
		languages: ["vi-VN", "vi"],
		gender: "unknown",
		speakerCount: 65,
	},
	{
		name: "vi-25hours-single-low",
		languages: ["vi-VN", "vi"],
		gender: "female",
	},

	{
		name: "zh-cn-huayan-x-low",
		languages: ["zh-CN", "zh"],
		gender: "female",
	},
]
