import { SynthesisVoice } from '../api/API.js'
import { decodeToChannels } from '../audio/AudioBufferConversion.js'
import { RawAudio } from '../audio/AudioUtilities.js'
import { SampleFormat } from '../codecs/WaveCodec.js'
import { getShortLanguageCode, lcidToIsoLanguageCode } from '../utilities/Locale.js'
import { Logger } from '../utilities/Logger.js'
import { Timeline, TimelineEntry } from '../utilities/Timeline.js'
import { logToStderr } from '../utilities/Utilities.js'

const log = logToStderr

export function synthesize(text: string, voiceName: string, rate = 0, useSpeechPlatform = false) {
	return new Promise<{ rawAudio: RawAudio, timeline: Timeline }>(async (resolve, reject) => {
		const logger = new Logger()
		logger.start('Initialize winax module')

		const { default: WinAX } = await import('winax')

		const ActiveXObject = (global as any).ActiveXObject

		logger.start('Create SAPI COM object')
		const sapiVoice = new ActiveXObject(useSpeechPlatform ? 'Speech.SPVoice' : 'SAPI.SPVoice')
		sapiVoice.EventInterests = 33790

		logger.start('Get SAPI voice list and select best match')

		if (voiceName) {
			const voiceObjects = sapiVoice.GetVoices()

			for (let i = 0; i < voiceObjects.Count; i++) {
				const voiceObject = voiceObjects.Item(i)
				const candidateVoiceName = voiceObject.GetDescription()

				if (candidateVoiceName == voiceName) {
					sapiVoice.Voice = voiceObject
				}
			}
		}

		sapiVoice.Rate = rate

		// Create phone converter for language
		const sapiPhoneConverter = new ActiveXObject(useSpeechPlatform ? 'Speech.SpPhoneConverter' : 'SAPI.SpPhoneConverter')
		const sapiLanguageCodeHex = sapiVoice.Voice.GetAttribute('Language')
		const sapiLanguageCode = parseInt(sapiLanguageCodeHex, 16)

		sapiPhoneConverter.LanguageId = sapiLanguageCode

		logger.start('Synthesize with SAPI')

		const sampleRate = 22050
		const bytesPerSecond = sampleRate * 2

		const sapiOutputStream = new ActiveXObject('SAPI.SpMemoryStream')
		sapiOutputStream.Format.Type = 22 // format code code for SAFT22kHz16BitMono
		sapiVoice.AudioOutputStream = sapiOutputStream

		const dispatchMessagesInterval = setInterval(() => {
			WinAX.peekAndDispatchMessages()
		}, 50)

		const connectionPoints = WinAX.getConnectionPoints(sapiVoice)
		const connectionPoint = connectionPoints[0]

		const methods = connectionPoint.getMethods()

		const events: Timeline = []
		let lastWordEvent: TimelineEntry | null = null
		let lastWordCharPos = -1

		connectionPoint.advise({
			StartStream: () => {
			},

			Word: (streamId: number, streamPos: number, charPos: number, length: number) => {
				if (lastWordCharPos == charPos) {
					return
				}

				const wordText = text.substring(charPos, charPos + length)
				const startTime = streamPos / bytesPerSecond

				const wordEvent = { type: 'word', text: wordText, startTime, endTime: -1, timeline: [] } as TimelineEntry
				events.push(wordEvent)

				lastWordEvent = wordEvent
				lastWordCharPos = charPos
			},

			Phoneme: (streamId: number, streamPos: number, duration: number, nextPhoneId: number, feature: number, currentPhoneId: number) => {
				if (events.length == 0) {
					return
				}

				const phoneText = sapiPhoneConverter.IdToPhone(currentPhoneId)

				if (phoneText == ',' || phoneText == '_') {
					return
				}

				const startTime = streamPos / bytesPerSecond
				const endTime = startTime + (duration / 1000)

				events.push({ type: 'phone', text: phoneText, startTime, endTime })
			},

			EndStream: (streamId: number, streamPos: number) => {
				clearInterval(dispatchMessagesInterval)

				const audioData = new Uint8Array(sapiOutputStream.GetData())
				const audioChannels = decodeToChannels(audioData, 1, 16, SampleFormat.PCM)

				WinAX.release(sapiOutputStream)
				WinAX.release(sapiVoice)

				logger.end()

				resolve({ rawAudio: { audioChannels, sampleRate }, timeline: eventsToTimeline(events, audioChannels[0].length / sampleRate) })
			}
		})

		sapiVoice.Speak(text)
	})
}

export async function getVoiceList(useSpeechPlatform = false) {
	const { default: WinAX } = await import('winax')

	const ActiveXObject = (global as any).ActiveXObject

	const sapiVoice = new ActiveXObject(useSpeechPlatform ? 'Speech.SPVoice' : 'SAPI.SPVoice')

	const voiceObjects = sapiVoice.GetVoices()

	const voices: SynthesisVoice[] = []

	for (let i = 0; i < voiceObjects.Count; i++) {
		const voiceObject = voiceObjects.Item(i)
		const voiceName = voiceObject.GetDescription()
		const voiceGender = voiceObject.GetAttribute('Gender')?.toLowerCase()

		const sapiLanguageCodeHex = voiceObject.GetAttribute('Language')
		const sapiLanguageCode = parseInt(sapiLanguageCodeHex, 16)

		const languageCodes = await lcidToIsoLanguageCode(sapiLanguageCode)

		if (!languageCodes) {
			throw new Error(`Couldn't translate SAPI language code ${sapiLanguageCode} to ISO, for voice '${voiceName}'`)
		}

		const resultLanguageCodes: string[] = []

		for (const languageCode of languageCodes) {
			if (!resultLanguageCodes.includes(languageCode)) {
				resultLanguageCodes.push(languageCode)
			}

			const shortLanguageCode = getShortLanguageCode(languageCode)
			if (!resultLanguageCodes.includes(shortLanguageCode)) {
				resultLanguageCodes.push(shortLanguageCode)
			}
		}

		voices.push({
			name: voiceName,
			languages: resultLanguageCodes,
			gender: voiceGender || 'unknown'
		})
	}

	WinAX.release(sapiVoice)

	return voices
}

export async function AssertSAPIAvailable(testForSpeechPlatform = false) {
	if (process.platform != 'win32') {
		throw new Error(`SAPI is not available on your platform. SAPI is a Microsoft Windows technology that is only runs on a Windows OS.`)
	}

	try {
		const { default: WinAX } = await import('winax')
	} catch (e) {
		throw new Error(`winax package, which is required for SAPI support, was not found. You can install it by running 'npm install winax -g'.`)
	}

	const ActiveXObject = (global as any).ActiveXObject

	try {
		const voice = new ActiveXObject('SAPI.SPVoice')
	} catch (e) {
		throw new Error(`Failed creating a SAPI instance: ${e}`)
	}

	try {
		const voice = new ActiveXObject('Speech.SPVoice')
	} catch(e) {
		throw new Error(`Failed creating an msspeech instance. Please ensure you installed the Microsoft Speech Platform runtime correctly.`)
	}
}

function eventsToTimeline(events: Timeline, totalDuration: number): Timeline {
	const timeline: Timeline = []

	for (const event of events) {
		if (event.type == 'word') {
			timeline.push(event)
		} else if (event.type == 'phone') {
			if (timeline.length == 0) {
				throw new Error('Unexpected: phone event preceded a word event')
			}

			const lastWordEntry = timeline[timeline.length - 1]

			lastWordEntry.endTime = event.endTime

			const phoneTimeline = lastWordEntry.timeline!

			phoneTimeline.push(event)
		}
	}

	if (timeline.length > 0 && timeline[timeline.length - 1].endTime == -1) {
		timeline[timeline.length - 1].endTime = totalDuration
	}

	return timeline
}
