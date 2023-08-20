import { concatFloat32Arrays, logToStderr, objToString, simplifyPunctuationCharacters } from "../utilities/Utilities.js"
import { int16PcmToFloat32 } from "../audio/AudioBufferConversion.js"
import { Logger } from '../utilities/Logger.js'
import { WasmMemoryManager } from "../utilities/WasmMemoryManager.js"
import { RawAudio, getEmptyRawAudio } from "../audio/AudioUtilities.js"
import { playAudioWithTimelinePhones } from "../audio/AudioPlayer.js"
import { getNormalizedFragmentsForSpeech } from "../nlp/TextNormalizer.js"
import { ipaPhoneToKirshenbaum } from "../nlp/PhoneConversion.js"
import { splitToWords } from "../nlp/Segmentation.js"
import { Lexicon, tryGetFirstLexiconSubstitution } from "../nlp/Lexicon.js"
import { phonemizeSentence } from "../nlp/EspeakPhonemizer.js"
import { Timeline, TimelineEntry } from "../utilities/Timeline.js"

const log = logToStderr

let espeakInstance: any
let espeakModule: any

export async function preprocessAndSynthesize(text: string, espeakVoice: string, language: string, lexicons: Lexicon[] = [], rate?: number, pitch?: number, pitchRange?: number) {
	const logger = new Logger()

	await logger.startAsync("Tokenize and analyze text")

	let lowerCaseLanguageCode = language.toLowerCase()

	if (lowerCaseLanguageCode == "en-gb") {
		lowerCaseLanguageCode = "en-gb-x-rp"
	}

	let fragments: string[]
	let preprocessedFragments: string[]
	const phonemizedFragmentsSubstitutions = new Map<number, string[]>()

	fragments = []
	preprocessedFragments = []

	const words = (await splitToWords(text, language)).filter(word => word.trim() != "")

	const { normalizedFragments, referenceFragments } = getNormalizedFragmentsForSpeech(words, language)

	const simplifiedFragments = normalizedFragments.map(word => simplifyPunctuationCharacters(word).toLocaleLowerCase())

	for (let fragmentIndex = 0; fragmentIndex < normalizedFragments.length; fragmentIndex++) {
		const fragment = normalizedFragments[fragmentIndex]

		const substitutionPhonemes = tryGetFirstLexiconSubstitution(simplifiedFragments, fragmentIndex, lexicons, lowerCaseLanguageCode)

		if (!substitutionPhonemes) {
			continue
		}

		phonemizedFragmentsSubstitutions.set(fragmentIndex, substitutionPhonemes)
		const referenceIPA = (await textToPhonemes(fragment, espeakVoice, true)).replaceAll("_", " ")
		const referenceKirshenbaum = (await textToPhonemes(fragment, espeakVoice, false)).replaceAll("_", "")

		const kirshenbaumPhonemes = substitutionPhonemes.map(phone => ipaPhoneToKirshenbaum(phone)).join("")

		logger.logTitledMessage(`\nLexicon substitution for '${fragment}'`, `IPA: ${substitutionPhonemes.join(" ")} (original: ${referenceIPA}), Kirshenbaum: ${kirshenbaumPhonemes} (reference: ${referenceKirshenbaum})`)

		const substitutionPhonemesFragment = ` [[${kirshenbaumPhonemes}]] `

		normalizedFragments[fragmentIndex] = substitutionPhonemesFragment
	}

	fragments = referenceFragments
	preprocessedFragments = normalizedFragments

	logger.start("Synthesize preprocessed fragments with eSpeak")

	const { rawAudio: referenceSynthesizedAudio, timeline: referenceTimeline } = await synthesizeFragments(preprocessedFragments, espeakVoice, false, rate, pitch, pitchRange)

	await logger.startAsync("Build phonemized tokens")

	const phonemizedSentence: string[][][] = []

	let wordIndex = 0
	for (const phraseEntry of referenceTimeline) {
		const phrase: string[][] = []

		for (const wordEntry of phraseEntry.timeline!) {
			wordEntry.text = fragments[wordIndex]

			if (phonemizedFragmentsSubstitutions.has(wordIndex)) {
				phrase.push(phonemizedFragmentsSubstitutions.get(wordIndex)!)
			} else {
				for (const tokenEntry of wordEntry.timeline!) {
					const tokenPhonemes: string[] = []

					for (const phoneme of tokenEntry.timeline!) {
						if (phoneme.text) {
							tokenPhonemes.push(phoneme.text)
						}
					}

					if (tokenPhonemes.length > 0) {
						phrase.push(tokenPhonemes)
					}
				}
			}

			wordIndex += 1
		}

		if (phrase.length > 0) {
			phonemizedSentence.push(phrase)
		}
	}

	logger.log(phonemizedSentence.map(phrase => phrase.map(word => word.join(" ")).join(" | ")).join(" || "))

	logger.end()

	return { referenceSynthesizedAudio, referenceTimeline, fragments, preprocessedFragments, phonemizedFragmentsSubstitutions, phonemizedSentence }
}

export async function synthesizeFragments(fragments: string[], voice: string, insertSeparators = false, rate?: number, pitch?: number, pitchRange?: number) {
	const logger = new Logger()

	const sampleRate = await getSampleRate()

	//fragments = fragments.filter(fragment => fragment.trim() != "")

	if (fragments.length == 0) {
		return {
			rawAudio: getEmptyRawAudio(1, sampleRate),
			timeline: [] as Timeline,
			events: [] as EspeakEvent[]
		}
	}

	let textWithMarkers = '() | '

	for (let i = 0; i < fragments.length; i++) {
		let fragment = fragments[i]

		fragment = fragment.replaceAll("<", "&lt;").replaceAll(">", "&gt;")

		if (insertSeparators) {
			textWithMarkers += `<mark name="wordstart-${i}"/> | ${fragment} | <mark name="wordend-${i}"/>`
		} else {
			if (fragment.endsWith(".")) {
				fragment += " ()"
			}

			textWithMarkers += `<mark name="wordstart-${i}"/>${fragment}<mark name="wordend-${i}"/> `
		}
	}

	//log(textWithMarkers)

	const { rawAudio, events } = await synthesize(textWithMarkers, voice, true, rate, pitch, pitchRange)

	// Build word timeline from events
	const wordTimeline: Timeline = fragments.map(word => ({
		type: "word",
		text: word,
		startTime: -1,
		endTime: -1,
		timeline: [{
			type: "token",
			text: "",
			startTime: -1,
			endTime: -1,
			timeline: []
		}]
	}))

	let wordIndex = 0

	const clauseEndIndexes: number[] = []

	for (const event of events) {
		const eventTime = event.audio_position / 1000

		const currentWordEntry = wordTimeline[wordIndex]

		const currentTokenTimeline = currentWordEntry.timeline!
		const currentTokenEntry = currentTokenTimeline[currentTokenTimeline.length - 1]

		const currentPhoneTimeline = currentTokenEntry.timeline!
		const lastPhoneEntry = currentPhoneTimeline[currentPhoneTimeline.length - 1]

		if (lastPhoneEntry && lastPhoneEntry.endTime == -1) {
			lastPhoneEntry.endTime = eventTime
		}

		if (event.type == "word") {
			if (!event.id || currentPhoneTimeline.length == 0) {
				continue
			}

			if (currentTokenEntry.endTime == -1) {
				currentTokenEntry.endTime = eventTime
			}

			currentTokenTimeline.push({
				type: "token",
				text: "",
				startTime: eventTime,
				endTime: -1,
				timeline: []
			})
		} else if (event.type == "phoneme") {
			const phoneText = event.id as string

			if (!phoneText || phoneText.startsWith("(")) {
				continue
			}

			currentPhoneTimeline.push({
				type: "phone",
				text: phoneText,
				startTime: eventTime,
				endTime: -1
			})

			currentTokenEntry.text += phoneText
			currentTokenEntry.startTime = currentPhoneTimeline[0].startTime
		} else if (event.type == "mark") {
			const markerName = event.id! as string

			if (markerName.startsWith("wordstart-")) {
				const markerIndex = parseInt(markerName.substring(10))

				if (markerIndex != wordIndex) {
					throw new Error(`Word start marker for index ${wordIndex} is not consistent with word index. The words were: ${objToString(fragments)}`)
				}

				if (currentPhoneTimeline.length > 0) {
					throw new Error(`Word entry ${wordIndex} already has phones before its start marker was seen. The words were: ${objToString(fragments)}`)
				}

				currentWordEntry.startTime = eventTime
				currentTokenEntry.startTime = eventTime
			} else if (markerName.startsWith("wordend-")) {
				const markerIndex = parseInt(markerName.substring(8))

				if (markerIndex != wordIndex) {
					throw new Error(`Word end marker for index ${wordIndex} is not consistent with word index. The words were: ${objToString(fragments)}`)
				}

				currentWordEntry.startTime = currentTokenTimeline[0].startTime

				currentWordEntry.endTime = eventTime
				currentTokenEntry.endTime = eventTime

				wordIndex += 1

				if (wordIndex == wordTimeline.length) {
					break
				}
			} else {
				continue
			}
		} else if (event.type == "end") {
			clauseEndIndexes.push(wordIndex)
		}
	}

	clauseEndIndexes.push(wordTimeline.length)

	// Split compound tokens
	for (const [index, wordEntry] of wordTimeline.entries()) {
		const tokenTimeline = wordEntry.timeline

		if (index == 0) {
			continue
		}

		if (!tokenTimeline || tokenTimeline.length == 0) {
			throw new Error("Unexpected: token timeline should exist and have at least one token")
		}

		if (tokenTimeline[0].text != '') {
			continue
		}

		const wordReferencePhonemes = (await textToPhonemes(wordEntry.text, voice, true)).split("_")

		const wordReferenceIPA = wordReferencePhonemes.join(" ")

		if (wordReferenceIPA.trim().length == 0) {
			continue
		}

		const wordReferenceIPAWithoutStress = wordReferenceIPA.replaceAll("ˈ", "").replaceAll("ˌ", "")

		const previousWordEntry = wordTimeline[index - 1]

		if (!previousWordEntry.timeline) {
			continue
		}

		const previousWordTokenEntry = previousWordEntry.timeline[0]

		if (!previousWordTokenEntry.timeline || previousWordTokenEntry.timeline.length <= wordReferencePhonemes.length) {
			continue
		}

		const previousWordTokenIPAWithoutStress = previousWordTokenEntry.timeline.map(phoneEntry => phoneEntry.text.replaceAll("ˈ", "").replaceAll("ˌ", "")).join(" ")

		if (!previousWordTokenIPAWithoutStress.endsWith(wordReferenceIPAWithoutStress)) {
			continue
		}

		const tokenEntry = tokenTimeline[0]

		tokenEntry.timeline = previousWordTokenEntry.timeline.splice(previousWordTokenEntry.timeline.length - wordReferencePhonemes.length)
		tokenEntry.text = tokenEntry.timeline.map(phoneEntry => phoneEntry.text).join("")

		tokenEntry.startTime = tokenEntry.timeline[0].startTime
		tokenEntry.endTime = tokenEntry.timeline[tokenEntry.timeline.length - 1].endTime
		wordEntry.startTime = tokenEntry.startTime
		wordEntry.endTime = tokenEntry.endTime

		previousWordTokenEntry.text = previousWordTokenEntry.timeline.map(phoneEntry => phoneEntry.text).join("")
		previousWordTokenEntry.endTime = previousWordTokenEntry.timeline[previousWordTokenEntry.timeline.length - 1].endTime
		previousWordEntry.endTime = previousWordTokenEntry.endTime
	}

	// Build clause timeline
	const clauseTimeline: Timeline = []

	let clauseStartIndex = 0

	for (const clauseEndIndex of clauseEndIndexes) {
		const newClause: TimelineEntry = {
			type: "clause",
			text: "",
			startTime: -1,
			endTime: -1,
			timeline: []
		}

		for (let entryIndex = clauseStartIndex; entryIndex <= clauseEndIndex && entryIndex < wordTimeline.length; entryIndex++) {
			const wordEntry = wordTimeline[entryIndex]
			if (newClause.startTime == -1) {
				newClause.startTime = wordEntry.startTime
			}

			newClause.endTime = wordEntry.endTime

			newClause.text += `${wordEntry.text} `

			newClause.timeline!.push(wordEntry)
		}

		if (newClause.timeline!.length > 0) {
			clauseTimeline.push(newClause)
			clauseStartIndex = clauseEndIndex + 1
		}
	}

	return { rawAudio, timeline: clauseTimeline, events }
}

export async function synthesize(text: string, voice: string, ssmlEnabled: boolean, rate = 150, pitch = 50, pitchRange = 50) {
	const logger = new Logger()
	logger.start("Get espeak WASM instance")

	if (!ssmlEnabled) {
		const { escape } = await import('html-escaper')

		text = escape(text)
	}

	const { instance } = await getEspeakInstance()

	const sampleChunks: Float32Array[] = []
	const allEvents: EspeakEvent[] = []

	logger.start("Synthesize with eSpeak")

	await setVoice(voice)
	await setRate(rate)
	await setPitch(pitch)
	await setPitchRange(pitchRange)

	instance.synthesize(text, (samples: Int16Array, events: EspeakEvent[]) => {
		if (samples && samples.length > 0) {
			sampleChunks.push(int16PcmToFloat32(samples))
		}

		for (const event of events) {
			if (event.type == "word") {
				const textPosition = event.text_position - 1;
				(event as any)["text"] = text.substring(textPosition, textPosition + event.word_length)
			}
		}

		allEvents.push(...events)
	})

	const concatenatedSamples = concatFloat32Arrays(sampleChunks)

	const rawAudio: RawAudio = { audioChannels: [concatenatedSamples], sampleRate: 22050 }

	logger.end()

	return { rawAudio, events: allEvents }
}

export async function textToIPA(text: string, voice: string) {
	await setVoice(voice)
	const { instance } = await getEspeakInstance()
	const ipa: string = (instance.synthesize_ipa(text).ipa as string).trim()

	return ipa
}

export async function textToPhonemes(text: string, voice: string, useIPA = true) {
	await setVoice(voice)
	const { instance, module } = await getEspeakInstance()
	const textPtr = instance.convert_to_phonemes(text, useIPA)

	const wasmMemory = new WasmMemoryManager(module)

	const resultRef = wasmMemory.wrapNullTerminatedUtf8String(textPtr.ptr)
	const result = resultRef.getValue()

	wasmMemory.freeAll()

	return result
}

export async function setVoice(voiceId: string) {
	const { instance } = await getEspeakInstance()

	instance.set_voice(voiceId)
}

export async function setVolume(volume: number) {
	const { instance } = await getEspeakInstance()

	return instance.setVolume(volume)
}

export async function setRate(rate: number) {
	const { instance } = await getEspeakInstance()

	return instance.set_rate(rate)
}

export async function setPitch(pitch: number) {
	const { instance } = await getEspeakInstance()

	return instance.set_pitch(pitch)
}

export async function setPitchRange(pitchRange: number) {
	const { instance } = await getEspeakInstance()

	return instance.set_range(pitchRange)
}

export async function getSampleRate(): Promise<22050> {
	return 22050
}

export async function listVoices() {
	const { instance } = await getEspeakInstance()

	const voiceList: {
		identifier: string,
		name: string,
		languages: {
			priority: number,
			name: string
		}[]
	}[] = instance.list_voices()

	return voiceList
}

async function getEspeakInstance() {
	if (!espeakInstance) {
		const { default: EspeakInitializer } = await import('@echogarden/espeak-ng-emscripten')

		const m = await EspeakInitializer()
		espeakInstance = await (new m.eSpeakNGWorker())
		espeakModule = m
	}

	return { instance: espeakInstance, module: espeakModule }
}

export type EspeakEventType = "sentence" | "word" | "phoneme" | "end" | "mark" | "play" | "msg_terminated" | "list_terminated" | "samplerate"

export interface EspeakEvent {
	audio_position: number
	type: EspeakEventType
	text_position: number
	word_length: number
	id?: string | number
}

type SynthesisOptions = {
	format?: 'int16' | 'float32'
	channels?: 1 | 2
	ssml?: boolean
	phonemes?: boolean
	endpause?: boolean
}

export async function testEspeakSynthesisWithPrePhonemizedInputs(text: string) {
	const ipaPhonemizedSentence = (await phonemizeSentence(text, "en-us")).flatMap(clause => clause)
	const kirshenbaumPhonemizedSentence = (await phonemizeSentence(text, "en-us", undefined, false)).flatMap(clause => clause)
	log(kirshenbaumPhonemizedSentence)

	const fragments = ipaPhonemizedSentence.map(word =>
		word.map(phoneme =>
			ipaPhoneToKirshenbaum(phoneme)).join("")).map(word => ` [[${word}]] `)

	const { rawAudio, timeline } = await synthesizeFragments(fragments, 'en-us')

	await playAudioWithTimelinePhones(rawAudio, timeline)
}

export async function testKirshenbaumPhonemization(text: string) {
	const ipaPhonemizedSentence = (await phonemizeSentence(text, "en-us")).flatMap(clause => clause)
	const kirshenbaumPhonemizedSentence = (await phonemizeSentence(text, "en-us", undefined, false)).flatMap(clause => clause)

	const ipaFragments = ipaPhonemizedSentence.map(word => word.join(""))

	const kirshenbaumFragments = kirshenbaumPhonemizedSentence.map(word => word.join(""))

	const fragments = ipaPhonemizedSentence.map(word =>
		word.map(phoneme =>
			ipaPhoneToKirshenbaum(phoneme)).join(""))

	for (let i = 0; i < fragments.length; i++) {
		log(`IPA: ${ipaFragments[i]} | converted: ${fragments[i]} | ground truth: ${kirshenbaumFragments[i]}`)
	}
}
