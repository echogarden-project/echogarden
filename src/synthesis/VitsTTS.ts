import type * as Onnx from 'onnxruntime-node'
import { SynthesisVoice } from '../api/API.js'
import { Logger } from '../utilities/Logger.js'
import { RawAudio, getEmptyRawAudio, getRawAudioDuration } from '../audio/AudioUtilities.js'
import { Lexicon } from '../nlp/Lexicon.js'
import { Timeline } from '../utilities/Timeline.js'
import { readAndParseJsonFile, readdir } from '../utilities/FileSystem.js'
import { EspeakOptions, defaultEspeakOptions } from '../synthesis/EspeakTTS.js'
import { OnnxExecutionProvider, getOnnxSessionOptions } from '../utilities/OnnxUtilities.js'
import { joinPath } from '../utilities/PathUtilities.js'

const cachedInstanceLookup = new Map<string, VitsTTS>()

export async function synthesizeSentence(
	text: string,
	voiceName: string,
	modelPath: string,
	lengthScale: number,
	speakerId: number,
	lexicons: Lexicon[],
	executionProviders: OnnxExecutionProvider[]) {

	const cacheLookupKey = modelPath

	let vitsTTS: VitsTTS | undefined = cachedInstanceLookup.get(cacheLookupKey)

	if (!vitsTTS) {
		vitsTTS = new VitsTTS(voiceName, modelPath, executionProviders)

		cachedInstanceLookup.clear()
		cachedInstanceLookup.set(cacheLookupKey, vitsTTS)
	}

	const result = await vitsTTS.synthesizeSentence(text, lengthScale, speakerId, lexicons)

	return result
}

export class VitsTTS {
	session?: Onnx.InferenceSession
	metadata?: any
	phonemeMap?: Map<string, number[]>

	constructor(
		public readonly voiceName: string,
		public readonly modelPath: string,
		public readonly executionProviders: OnnxExecutionProvider[]) {
	}

	async synthesizeSentence(sentence: string, lengthScale: number, speakerId = 0, lexicons?: Lexicon[]) {
		const logger = new Logger()

		await this.initializeIfNeeded()

		await logger.startAsync('Prepare for VITS synthesis')

		const metadata = this.metadata
		const phonemeMap = this.phonemeMap!
		const espeakVoice = metadata.espeak.voice as string
		const languageCode = espeakVoice
		const outputSampleRate = metadata.audio.sample_rate
		const baseLengthScale = metadata.inference.length_scale || 1.0

		lengthScale *= baseLengthScale

		sentence = //simplifyPunctuationCharacters(sentence.trim())
			sentence
				.replaceAll('(', ', ')
				.replaceAll(')', ', ')
				.replaceAll('—', ', ')

		const Espeak = await import('../synthesis/EspeakTTS.js')

		logger.end()

		const espeakOptions: EspeakOptions = {
			...defaultEspeakOptions,
			voice: espeakVoice,
			useKlatt: false
		}

		const { referenceSynthesizedAudio, referenceTimeline, fragments, phonemizedFragmentsSubstitutions, phonemizedSentence } = await Espeak.preprocessAndSynthesize(sentence, languageCode, espeakOptions, lexicons)

		if (phonemizedSentence.length == 0) {
			logger.end()

			return {
				rawAudio: getEmptyRawAudio(1, outputSampleRate),
				timeline: [],
				referenceSynthesizedAudio: getEmptyRawAudio(1, outputSampleRate),
				referenceTimeline: [] as Timeline
			}
		}

		await logger.startAsync('Encode phonemes to identifiers')

		const clauseEndBreaker = ','
		let sentenceEndBreaker = '.'

		if (sentence.endsWith('?') || sentence.endsWith(`?"`)) {
			sentenceEndBreaker = '?'
		} else if (sentence.endsWith('!') || sentence.endsWith(`!"`)) {
			sentenceEndBreaker = '!'
		}

		const phonemeCharacterSeparatorId = phonemeMap.get('_')!
		const wordSeparatorId = phonemeMap.get(' ')!
		const startId = phonemeMap.get('^')!
		const endId = phonemeMap.get('$')!

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
							//logger.log(`No id found for subphoneme '${char}'`)
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

		await logger.startAsync('Generate audio using synthesis model')

		const { default: Onnx } = await import('onnxruntime-node')

		const inputTensor = new Onnx.Tensor('int64', bigIntIds, [1, bigIntIds.length])
		const inputLengthsTensor = new Onnx.Tensor('int64', idLengths, [1])
		const scalesTensor = new Onnx.Tensor('float32', [metadata.inference.noise_scale, lengthScale, metadata.inference.noise_w], [3])
		const speakerIdTensor = new Onnx.Tensor('int64', new BigInt64Array([BigInt(speakerId)]), [1])

		const modelInputs = { input: inputTensor, input_lengths: inputLengthsTensor, scales: scalesTensor, sid: speakerIdTensor }

		const modelResults = await this.session!.run(modelInputs)
		const modelOutput = modelResults['output']

		const modelOutputAudioSamples = modelOutput['data'] as Float32Array

		const synthesizedAudio: RawAudio = { audioChannels: [modelOutputAudioSamples], sampleRate: outputSampleRate }

		await logger.startAsync('Align with reference synthesized audio')

		const { alignUsingDtw } = await import('../alignment/SpeechAlignment.js')

		const referenceWordTimeline = referenceTimeline.flatMap(clause => clause.timeline!)

		const dtwWindowDuration = Math.max(5, Math.ceil(0.2 * getRawAudioDuration(synthesizedAudio)))
		const mappedTimeline = await alignUsingDtw(synthesizedAudio, referenceSynthesizedAudio, referenceWordTimeline, ['high'], [dtwWindowDuration])

		logger.end()

		return { rawAudio: synthesizedAudio, timeline: mappedTimeline, referenceSynthesizedAudio, referenceTimeline }
	}

	async initializeIfNeeded() {
		if (this.session) {
			return
		}

		const logger = new Logger()
		await logger.startAsync('Initialize VITS ONNX synthesis model')

		const { default: Onnx } = await import('onnxruntime-node')

		const filesInModelPath = await readdir(this.modelPath)
		const onnxModelFilename = filesInModelPath.find(filename => filename.endsWith('.onnx'))

		if (!onnxModelFilename) {
			throw new Error(`Couldn't file any ONNX model file in ${this.modelPath}`)
		}

		const onnxModelFilepath = joinPath(this.modelPath, onnxModelFilename)

		const onnxSessionOptions = getOnnxSessionOptions({ executionProviders: this.executionProviders })

		this.session = await Onnx.InferenceSession.create(onnxModelFilepath, onnxSessionOptions)
		this.metadata = await readAndParseJsonFile(`${onnxModelFilepath}.json`)

		this.phonemeMap = new Map<string, number[]>()

		for (const key in this.metadata.phoneme_id_map) {
			this.phonemeMap.set(key, this.metadata.phoneme_id_map[key])
		}

		logger.end()
	}
}

export const voiceList: SynthesisVoice[] = [
	{
		name: 'ar_JO-kareem-low',
		languages: ['ar-JO', 'ar'],
		gender: 'male',
	},
	{
		name: 'ar_JO-kareem-medium',
		languages: ['ar-JO', 'ar'],
		gender: 'male',
	},

	{
		name: 'ca_ES-upc_ona-x_low',
		languages: ['ca-ES', 'ca'],
		gender: 'female',
	},
	{
		name: 'ca_ES-upc_ona-medium',
		languages: ['ca-ES', 'ca'],
		gender: 'female',
	},
	{
		name: 'ca_ES-upc_pau-x_low',
		languages: ['ca-ES', 'ca'],
		gender: 'male',
	},

	{
		name: 'cs_CZ-jirka-low',
		languages: ['cs-CZ', 'cs'],
		gender: 'male',
	},
	{
		name: 'cs_CZ-jirka-medium',
		languages: ['cs-CZ', 'cs'],
		gender: 'male',
	},

	{
		name: 'cy_GB-gwryw_gogleddol-medium',
		languages: ['cy-GB', 'cy'],
		gender: 'male',
	},

	{
		name: 'da_DK-nst_talesyntese-medium',
		languages: ['da-DK', 'da'],
		gender: 'male',
	},

	{
		name: 'de_DE-thorsten-low',
		languages: ['de-DE', 'de'],
		gender: 'male',
	},
	{
		name: 'de_DE-thorsten-medium',
		languages: ['de-DE', 'de'],
		gender: 'male',
	},
	{
		name: 'de_DE-thorsten_emotional-medium',
		languages: ['de-DE', 'de'],
		gender: 'male',
		speakerCount: 8
	},
	{
		name: 'de_DE-thorsten-high',
		languages: ['de-DE', 'de'],
		gender: 'male',
	},
	{
		name: 'de_DE-eva_k-x_low',
		languages: ['de-DE', 'de'],
		gender: 'female',
	},
	{
		name: 'de_DE-ramona-low',
		languages: ['de-DE', 'de'],
		gender: 'female',
	},
	{
		name: 'de_DE-pavoque-low',
		languages: ['de-DE', 'de'],
		gender: 'male',
	},
	{
		name: 'de_DE-kerstin-low',
		languages: ['de-DE', 'de'],
		gender: 'female',
	},
	{
		name: 'de_DE-karlsson-low',
		languages: ['de-DE', 'de'],
		gender: 'male',
	},
	{
		name: 'de_DE-mls-medium',
		languages: ['de-DE', 'de'],
		gender: 'unknown',
		speakerCount: 236
	},

	{
		name: 'el_GR-rapunzelina-low',
		languages: ['el-GR', 'el'],
		gender: 'female',
	},

	{
		name: 'en_GB-alan-low',
		languages: ['en-GB', 'en'],
		gender: 'male',
	},
	{
		name: 'en_GB-alan-medium',
		languages: ['en-GB', 'en'],
		gender: 'male',
	},
	{
		name: 'en_GB-semaine-medium',
		languages: ['en-GB', 'en'],
		gender: 'unknown',
		speakerCount: 4
	},
	{
		name: 'en_GB-danny-low',
		languages: ['en-GB', 'en'],
		gender: 'male',
	},
	{
		name: 'en_GB-alba-medium',
		languages: ['en-GB', 'en'],
		gender: 'female',
	},
	{
		name: 'en_GB-aru-medium',
		languages: ['en-GB', 'en'],
		gender: 'unknown',
		speakerCount: 12,
	},
	{
		name: 'en_GB-southern_english_female-low',
		languages: ['en-GB', 'en'],
		gender: 'female',
	},
	{
		name: 'en_GB-northern_english_male-medium',
		languages: ['en-GB', 'en'],
		gender: 'male',
	},
	{
		name: 'en_GB-vctk-medium',
		languages: ['en-GB', 'en'],
		gender: 'unknown',
		speakerCount: 109,
	},
	{
		name: 'en_GB-jenny_dioco-medium',
		languages: ['en-GB', 'en'],
		gender: 'female',
	},
	{
		name: 'en_GB-cori-high',
		languages: ['en-GB', 'en'],
		gender: 'female',
	},
	{
		name: 'en_GB-cori-medium',
		languages: ['en-GB', 'en'],
		gender: 'female',
	},

	{
		name: 'en_US-amy-low',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'en_US-amy-medium',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'en_US-kathleen-low',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'en_US-lessac-low',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'en_US-lessac-medium',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'en_US-lessac-high',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'en_US-libritts-high',
		languages: ['en-US', 'en'],
		gender: 'unknown',
		speakerCount: 904,
	},
	{
		name: 'en_US-libritts_r-medium',
		languages: ['en-US', 'en'],
		gender: 'unknown',
		speakerCount: 904,
	},
	{
		name: 'en_US-ryan-low',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'en_US-ryan-medium',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'en_US-ryan-high',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'en_US-joe-medium',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'en_US-kusal-medium',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'en_US-arctic-medium',
		languages: ['en-US', 'en'],
		gender: 'unknown',
		speakerCount: 18
	},
	{
		name: 'en_US-l2arctic-medium',
		languages: ['en-US', 'en'],
		gender: 'unknown',
		speakerCount: 24
	},
	{
		name: 'en_US-hfc_male-medium',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'en_US-hfc_female-medium',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'en_US-kristin-medium',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'en_US-ljspeech-high',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'en_US-ljspeech-medium',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'en_US-norman-medium',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'en_US-john-medium',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'en_US-bryce-medium',
		languages: ['en-US', 'en'],
		gender: 'male',
	},

	{
		name: 'es_ES-carlfm-x_low',
		languages: ['es-ES', 'es'],
		gender: 'male',
	},
	{
		name: 'es_ES-sharvard-medium',
		languages: ['es-ES', 'es'],
		gender: 'unknown',
		speakerCount: 2
	},
	{
		name: 'es_ES-davefx-medium',
		languages: ['es-ES', 'es'],
		gender: 'male',
	},
	{
		name: 'es_ES-mls_9972-low',
		languages: ['es-ES', 'es'],
		gender: 'male',
	},
	{
		name: 'es_ES-mls_10246-low',
		languages: ['es-ES', 'es'],
		gender: 'male',
	},

	{
		name: 'es_MX-ald-medium',
		languages: ['es-MX', 'es'],
		gender: 'male',
	},
	{
		name: 'es_MX-claude-high',
		languages: ['es-MX', 'es'],
		gender: 'female',
	},

	{
		name: 'fa_IR-amir-medium',
		languages: ['fa_IR', 'fa'],
		gender: 'male',
	},
	{
		name: 'fa_IR-gyro-medium',
		languages: ['fa_IR', 'fa'],
		gender: 'male',
	},

	{
		name: 'fi_FI-harri-low',
		languages: ['fi-FI', 'fi'],
		gender: 'female',
	},
	{
		name: 'fi_FI-harri-medium',
		languages: ['fi-FI', 'fi'],
		gender: 'female',
	},

	{
		name: 'fr_FR-siwis-low',
		languages: ['fr-FR', 'fr'],
		gender: 'female',
	},
	{
		name: 'fr_FR-siwis-medium',
		languages: ['fr-FR', 'fr'],
		gender: 'female',
	},
	{
		name: 'fr_FR-mls_1840-low',
		languages: ['fr-FR', 'fr'],
		gender: 'male',
	},
	{
		name: 'fr_FR-gilles-low',
		languages: ['fr-FR', 'fr'],
		gender: 'male',
	},
	{
		name: 'fr_FR-upmc-medium',
		languages: ['fr-FR', 'fr'],
		gender: 'unknown',
		speakerCount: 2
	},
	{
		name: 'fr_FR-mls-medium',
		languages: ['fr-FR', 'fr'],
		gender: 'unknown',
		speakerCount: 125
	},
	{
		name: 'fr_FR-tom-medium',
		languages: ['fr-FR', 'fr'],
		gender: 'male',
	},

	{
		name: 'hu_HU-anna-medium',
		languages: ['hu-HU', 'hu'],
		gender: 'female',
	},
	{
		name: 'hu_HU-imre-medium',
		languages: ['hu-HU', 'hu'],
		gender: 'male',
	},

	{
		name: 'is_IS-ugla-medium',
		languages: ['is-IS', 'is'],
		gender: 'female',
	},
	{
		name: 'is_IS-steinn-medium',
		languages: ['is-IS', 'is'],
		gender: 'male',
	},
	{
		name: 'is_IS-salka-medium',
		languages: ['is-IS', 'is'],
		gender: 'female',
	},
	{
		name: 'is_IS-bui-medium',
		languages: ['is-IS', 'is'],
		gender: 'male',
	},

	{
		name: 'it_IT-riccardo-x_low',
		languages: ['it-IT', 'it'],
		gender: 'male',
	},
	{
		name: 'it_IT-paola-medium',
		languages: ['it-IT', 'it'],
		gender: 'female',
	},

	{
		name: 'ka_GE-natia-medium',
		languages: ['ka-GE', 'ka'],
		gender: 'female',
	},

	{
		name: 'kk_KZ-iseke-x_low',
		languages: ['kk-KZ', 'kk'],
		gender: 'male',
	},
	{
		name: 'kk_KZ-raya-x_low',
		languages: ['kk-KZ', 'kk'],
		gender: 'male',
	},
	{
		name: 'kk_KZ-issai-high',
		languages: ['kk-KZ', 'kk'],
		gender: 'unknown',
		speakerCount: 6,
	},

	{
		name: 'lb_LU-marylux-medium',
		languages: ['lb-LU', 'lb'],
		gender: 'female',
	},

	{
		name: 'ne_NP-google-medium',
		languages: ['ne-NP', 'ne'],
		gender: 'female',
		speakerCount: 18,
	},
	{
		name: 'ne_NP-google-x_low',
		languages: ['ne-NP', 'ne'],
		gender: 'female',
		speakerCount: 18,
	},

	{
		name: 'nl_NL-mls_5809-low',
		languages: ['nl-NL', 'nl'],
		gender: 'female',
	},
	{
		name: 'nl_NL-mls_7432-low',
		languages: ['nl-NL', 'nl'],
		gender: 'female',
	},
	{
		name: 'nl_NL-mls-medium',
		languages: ['nl-NL', 'nl'],
		gender: 'unknown',
		speakerCount: 52,
	},

	{
		name: 'nl_BE-nathalie-x_low',
		languages: ['nl-BE', 'nl'],
		gender: 'female',
	},
	{
		name: 'nl_BE-nathalie-medium',
		languages: ['nl-BE', 'nl'],
		gender: 'female',
	},
	{
		name: 'nl_BE-rdh-medium',
		languages: ['nl-BE', 'nl'],
		gender: 'male',
	},
	{
		name: 'nl_BE-rdh-x_low',
		languages: ['nl-BE', 'nl'],
		gender: 'male',
	},

	{
		name: 'no_NO-talesyntese-medium',
		languages: ['no-NO', 'no'],
		gender: 'male',
	},

	{
		name: 'pl_PL-mls_6892-low',
		languages: ['pl-PL', 'pl'],
		gender: 'male',
	},
	{
		name: 'pl_PL-darkman-medium',
		languages: ['pl-PL', 'pl'],
		gender: 'male',
	},
	{
		name: 'pl_PL-gosia-medium',
		languages: ['pl-PL', 'pl'],
		gender: 'female',
	},
	{
		name: 'pl_PL-mc_speech-medium',
		languages: ['pl-PL', 'pl'],
		gender: 'male',
	},

	{
		name: 'pt_BR-edresson-low',
		languages: ['pt-BR', 'pt'],
		gender: 'male',
	},
	{
		name: 'pt_BR-faber-medium',
		languages: ['pt-BR', 'pt'],
		gender: 'male',
	},

	{
		name: 'pt_PT-tugao-medium',
		languages: ['pt-PT', 'pt'],
		gender: 'male',
	},

	{
		name: 'ro_RO-mihai-medium',
		languages: ['ro-RO', 'ro'],
		gender: 'male',
	},

	{
		name: 'ru_RU-ruslan-medium',
		languages: ['ru-RU', 'ru'],
		gender: 'male',
	},
	{
		name: 'ru_RU-irinia-medium',
		languages: ['ru-RU', 'ru'],
		gender: 'female',
	},
	{
		name: 'ru_RU-denis-medium',
		languages: ['ru-RU', 'ru'],
		gender: 'male',
	},
	{
		name: 'ru_RU-dmitri-medium',
		languages: ['ru-RU', 'ru'],
		gender: 'male',
	},

	{
		name: 'sk_SK-lili-medium',
		languages: ['sk-SK', 'sk'],
		gender: 'female',
	},

	{
		name: 'sl_SI-artur-medium',
		languages: ['sl_SI', 'sl'],
		gender: 'male',
	},

	{
		name: 'sr_RS-serbski_institut-medium',
		languages: ['sr-RS', 'sr'],
		gender: 'male',
		speakerCount: 2
	},

	{
		name: 'sv_SE-nst-medium',
		languages: ['sv-SE', 'sv'],
		gender: 'male',
	},

	{
		name: 'sw_CD-lanfrica-medium',
		languages: ['sw-CD', 'sw'],
		gender: 'male',
	},

	{
		name: 'tr_TR-dfki-medium',
		languages: ['tr-TR', 'tr'],
		gender: 'male',
	},
	{
		name: 'tr_TR-fahrettin-medium',
		languages: ['tr-TR', 'tr'],
		gender: 'male',
	},
	{
		name: 'tr_TR-fettah-medium',
		languages: ['tr-TR', 'tr'],
		gender: 'male',
	},

	{
		name: 'uk_UA-lada-x_low',
		languages: ['uk-UA', 'uk'],
		gender: 'female',
	},
	{
		name: 'uk_UA-ukrainian_tts-medium',
		languages: ['uk-UA', 'uk'],
		gender: 'unknown',
		speakerCount: 3,
	},
	{
		name: 'vi_VN-vivos-x_low',
		languages: ['vi-VN', 'vi'],
		gender: 'unknown',
		speakerCount: 65,
	},
	{
		name: 'vi_VN-25hours-single-low',
		languages: ['vi-VN', 'vi'],
		gender: 'female',
	},
	{
		name: 'vi_VN-vais1000-medium',
		languages: ['vi-VN', 'vi'],
		gender: 'female',
	},

	{
		name: 'zh_CN-huayan-x_low',
		languages: ['zh-CN', 'zh'],
		gender: 'female',
	},
	{
		name: 'zh_CN-huayan-medium',
		languages: ['zh-CN', 'zh'],
		gender: 'female',
	},
]
