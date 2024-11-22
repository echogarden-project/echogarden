import { deepClone, extendDeep } from '../utilities/ObjectUtilities.js'

import * as FFMpegTranscoder from '../codecs/FFMpegTranscoder.js'

import { clip, sha256AsHex, stringifyAndFormatJson, logToStderr, yieldToEventLoop, runOperationWithRetries } from '../utilities/Utilities.js'
import { RawAudio, concatAudioSegments, downmixToMono, encodeRawAudioToWave, getSamplePeakDecibels, getEmptyRawAudio, getRawAudioDuration, trimAudioEnd, trimAudioStart, attenuateIfClippingInPlace, normalizeAudioLevelInPlace } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'

import { isWordOrSymbolWord, splitToParagraphs, splitToSentences } from '../nlp/Segmentation.js'
import { type RubberbandOptions } from '../dsp/Rubberband.js'
import { loadLexiconsForLanguage } from '../nlp/Lexicon.js'

import * as API from './API.js'
import { Timeline, TimelineEntry, addTimeOffsetToTimeline, multiplyTimelineByFactor } from '../utilities/Timeline.js'
import { getAppDataDir, ensureDir, existsSync, isFileIsUpToDate, readAndParseJsonFile, writeFileSafe } from '../utilities/FileSystem.js'
import { formatLanguageCodeWithName, getShortLanguageCode, normalizeLanguageCode, defaultDialectForLanguageCode, parseLangIdentifier, normalizeIdentifierToLanguageCode } from '../utilities/Locale.js'
import { loadPackage } from '../utilities/PackageManager.js'
import { EngineMetadata, appName } from './Common.js'
import { shouldCancelCurrentTask } from '../server/Worker.js'
import chalk from 'chalk'
import { type SubtitlesConfig } from '../subtitles/Subtitles.js'
import { type EspeakOptions } from '../synthesis/EspeakTTS.js'
import { type OpenAICloudTTSOptions  } from '../synthesis/OpenAICloudTTS.js'
import { type ElevenlabsTTSOptions } from '../synthesis/ElevenlabsTTS.js'
import { OnnxExecutionProvider } from '../utilities/OnnxUtilities.js'
import { simplifyPunctuationCharacters } from '../nlp/TextNormalizer.js'
import { convertHtmlToText } from '../utilities/StringUtilities.js'
import { joinPath, resolvePath } from '../utilities/PathUtilities.js'
import { Timer } from '../utilities/Timer.js'

const log = logToStderr

/////////////////////////////////////////////////////////////////////////////////////////////
// Synthesis
/////////////////////////////////////////////////////////////////////////////////////////////
export async function synthesize(input: string | string[], options: SynthesisOptions, onSegment?: SynthesisSegmentEvent, onSentence?: SynthesisSegmentEvent): Promise<SynthesisResult> {
	options = extendDeep(defaultSynthesisOptions, options)

	let segments: string[]

	if (Array.isArray(input)) {
		segments = input
	} else if (options.ssml) {
		segments = [input]
	} else {
		const plainTextOptions = options.plainText!

		segments = splitToParagraphs(input, plainTextOptions.paragraphBreaks!, plainTextOptions.whitespace!)
	}

	return synthesizeSegments(segments, options, onSegment, onSentence)
}

async function synthesizeSegments(segments: string[], options: SynthesisOptions, onSegment?: SynthesisSegmentEvent, onSentence?: SynthesisSegmentEvent): Promise<SynthesisResult> {
	const logger = new Logger()
	options = extendDeep(defaultSynthesisOptions, options)

	const totalSynthesisTimeTimer = new Timer()

	if (!options.language && !options.voice) {
		logger.start('No language or voice specified. Detect language')

		let segmentsPlainText = segments

		if (options.ssml) {
			segmentsPlainText= []

			for (const segment of segments) {
				segmentsPlainText.push(await convertHtmlToText(segment))
			}
		}

		const { detectedLanguage } = await API.detectTextLanguage(segmentsPlainText.join('\n\n'), options.languageDetection || {})

		options.language = detectedLanguage

		logger.end()
		logger.logTitledMessage('Language detected', formatLanguageCodeWithName(detectedLanguage))
	}

	if (!options.engine) {
		if (options.voice) {
			throw new Error(`Voice '${options.voice}' was specified but no engine was specified.`)
		}

		options.engine = await selectBestOfflineEngineForLanguage(options.language!)

		logger.logTitledMessage('No engine specified. Auto-selected engine', options.engine)
	}

	logger.start(`Get voice list for ${options.engine}`)

	const { bestMatchingVoice } = await requestVoiceList(options)

	if (!bestMatchingVoice) {
		throw new Error('No matching voice found')
	}

	options.voice = bestMatchingVoice.name

	if (!options.language) {
		options.language = bestMatchingVoice.languages[0]
	}

	logger.end()
	logger.logTitledMessage('Selected voice', `'${options.voice}' (${formatLanguageCodeWithName(bestMatchingVoice.languages[0], 2)})`)

	const segmentsRawAudio: RawAudio[] = []
	const segmentsTimelines: Timeline[] = []

	const timeline: Timeline = []

	let peakDecibelsSoFar = -100

	let timeOffset = 0

	for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
		const segmentText = segments[segmentIndex].trim()

		logger.log(`\n${chalk.magentaBright(`Synthesizing segment ${segmentIndex + 1}/${segments.length}`)}: '${segmentText}'`)

		const segmentStartTime = timeOffset

		const segmentEntry: TimelineEntry = {
			type: 'segment',
			text: segmentText,
			startTime: timeOffset,
			endTime: -1,
			timeline: []
		}

		let sentences: string[]

		if ((options.splitToSentences || options.engine == 'vits') && !options.ssml) {
			sentences = splitToSentences(segmentText, options.language!)
			sentences = sentences.filter(sentence => sentence.trim() != '')

			if (sentences.length == 0) {
				sentences = ['']
			}
		} else {
			sentences = [segmentText]
		}

		const sentencesRawAudio: RawAudio[] = []
		const sentencesTimelines: Timeline[] = []

		for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex++) {
			await yieldToEventLoop()

			if (shouldCancelCurrentTask()) {
				//log('\n\n\n\n\nCANCELED\n\n\n\n')
				throw new Error('Canceled')
			}

			const sentenceText = sentences[sentenceIndex].trim()

			logger.log(`\n${chalk.magentaBright(`Synthesizing sentence ${sentenceIndex + 1}/${sentences.length}`)}: "${sentenceText}"`)

			const sentenceStartTime = timeOffset

			let sentencetSynthesisOptions: SynthesisOptions = { postProcessing: { normalizeAudio: false } }
			sentencetSynthesisOptions = extendDeep(options, sentencetSynthesisOptions)

			const { synthesizedAudio: sentenceRawAudio, timeline: sentenceTimeline } = await synthesizeSegment(sentenceText, sentencetSynthesisOptions)

			const endPause = sentenceIndex == sentences.length - 1 ? options.segmentEndPause! : options.sentenceEndPause!
			sentenceRawAudio.audioChannels[0] = trimAudioEnd(sentenceRawAudio.audioChannels[0], endPause * sentenceRawAudio.sampleRate)

			sentencesRawAudio.push(sentenceRawAudio)

			if (sentenceTimeline.length > 0) {
				sentencesTimelines.push(sentenceTimeline)
			}

			const sentenceAudioLength = sentenceRawAudio.audioChannels[0].length / sentenceRawAudio.sampleRate

			timeOffset += sentenceAudioLength

			const sentenceTimelineWithOffset = addTimeOffsetToTimeline(sentenceTimeline, sentenceStartTime)

			const sentenceEndTime = timeOffset - endPause

			segmentEntry.timeline!.push({
				type: 'sentence',
				text: sentenceText,
				startTime: sentenceStartTime,
				endTime: sentenceEndTime,
				timeline: sentenceTimelineWithOffset
			})

			peakDecibelsSoFar = Math.max(peakDecibelsSoFar, getSamplePeakDecibels(sentenceRawAudio.audioChannels))

			const sentenceAudio = await convertToTargetCodecIfNeeded(sentenceRawAudio)

			if (onSentence) {
				await onSentence({
					index: sentenceIndex,
					total: sentences.length,
					audio: sentenceAudio,
					timeline: sentenceTimeline,
					transcript: sentenceText,
					language: options.language!,
					peakDecibelsSoFar
				})
			}
		}

		segmentEntry.endTime = segmentEntry.timeline?.[segmentEntry.timeline.length - 1]?.endTime || timeOffset

		logger.end()

		logger.start(`Merge and postprocess sentences`)

		let segmentRawAudio: RawAudio

		if (sentencesRawAudio.length > 0) {
			const joinedAudioBuffers = concatAudioSegments(sentencesRawAudio.map(part => part.audioChannels))
			segmentRawAudio = { audioChannels: joinedAudioBuffers, sampleRate: sentencesRawAudio[0].sampleRate }
		} else {
			segmentRawAudio = getEmptyRawAudio(1, 24000)
		}

		segmentsRawAudio.push(segmentRawAudio)

		timeline.push(segmentEntry)
		const segmentTimelineWithoutOffset = addTimeOffsetToTimeline(segmentEntry.timeline!, -segmentStartTime)
		segmentsTimelines.push(segmentTimelineWithoutOffset)

		const segmentAudio = await convertToTargetCodecIfNeeded(segmentRawAudio)

		logger.end()

		if (onSegment) {
			await onSegment({
				index: segmentIndex,
				total: segments.length,
				audio: segmentAudio,
				timeline: segmentTimelineWithoutOffset,
				transcript: segmentText,
				language: options.language!,
				peakDecibelsSoFar
			})
		}
	}

	logger.start(`\nMerge and postprocess segments`)
	let resultRawAudio: RawAudio

	if (segmentsRawAudio.length > 0) {
		const joinedAudioBuffers = concatAudioSegments(segmentsRawAudio.map(part => part.audioChannels))
		resultRawAudio = { audioChannels: joinedAudioBuffers, sampleRate: segmentsRawAudio[0].sampleRate }

		if (options.postProcessing!.normalizeAudio) {
			normalizeAudioLevelInPlace(resultRawAudio, options.postProcessing!.targetPeak, options.postProcessing!.maxGainIncrease)
		} else {
			attenuateIfClippingInPlace(resultRawAudio)
		}
	} else {
		resultRawAudio = getEmptyRawAudio(1, 24000)
	}

	async function convertToTargetCodecIfNeeded(rawAudio: RawAudio) {
		const targetCodec = options.outputAudioFormat?.codec

		let output: RawAudio | Uint8Array

		if (targetCodec) {
			logger.start(`Convert to ${targetCodec} codec`)

			if (targetCodec == 'wav') {
				output = encodeRawAudioToWave(rawAudio)
			} else {
				const ffmpegOptions = FFMpegTranscoder.getDefaultFFMpegOptionsForSpeech(targetCodec, options.outputAudioFormat?.bitrate)
				output = await FFMpegTranscoder.encodeFromChannels(rawAudio, ffmpegOptions)
			}
		} else {
			output = rawAudio
		}

		return output
	}

	const resultAudio = await convertToTargetCodecIfNeeded(resultRawAudio)

	logger.end()

	logger.logTitledMessage('Total synthesis time', `${totalSynthesisTimeTimer.elapsedTime.toFixed(1)}ms`, chalk.magentaBright)

	return {
		audio: resultAudio,
		timeline,
		language: options.language,
		voice: options.voice
	}
}

export interface SynthesisResult {
	audio: RawAudio | Uint8Array
	timeline: Timeline
	language: string
	voice: string
}

async function synthesizeSegment(text: string, options: SynthesisOptions) {
	const logger = new Logger()

	const startTimestamp = logger.getTimestamp()

	logger.start('Prepare text for synthesis')

	const simplifiedText = simplifyPunctuationCharacters(text)

	const engine = options.engine

	logger.start(`Get voice list for ${engine}`)

	const { bestMatchingVoice } = await requestVoiceList(options)

	if (!bestMatchingVoice) {
		throw new Error('No matching voice found')
	}

	const selectedVoice = bestMatchingVoice

	let voicePackagePath: string | undefined

	if (selectedVoice.packageName) {
		logger.end()

		voicePackagePath = await loadPackage(selectedVoice.packageName)
	}

	logger.start(`Initialize ${engine} module`)

	const voice = selectedVoice.name

	let language: string

	if (options.language) {
		language = await normalizeIdentifierToLanguageCode(options.language)
	} else {
		language = selectedVoice.languages[0]
	}

	const voiceGender = selectedVoice.gender

	const speed = clip(options.speed!, 0.1, 10.0)
	const pitch = clip(options.pitch!, 0.1, 10.0)

	const inputIsSSML = options.ssml!

	let synthesizedAudio: RawAudio

	let timeline: Timeline | undefined

	let shouldPostprocessSpeed = false
	let shouldPostprocessPitch = false

	switch (engine) {
		case 'vits': {
			if (inputIsSSML) {
				throw new Error(`The VITS engine doesn't currently support SSML inputs`)
			}

			let vitsLanguage = language

			if (vitsLanguage == 'en') {
				vitsLanguage = 'en-us'
			}

			const vitsTTS = await import('../synthesis/VitsTTS.js')

			const lengthScale = 1 / speed

			const vitsOptions = options.vits!

			const speakerId = vitsOptions.speakerId

			if (speakerId != undefined) {
				if (selectedVoice.speakerCount == undefined) {
					if (speakerId != 0) {
						throw new Error('Selected VITS model has only one speaker. Speaker ID must be 0 if specified.')
					}
				} else if (speakerId < 0 || speakerId >= selectedVoice.speakerCount) {
					throw new Error(`Selected VITS model has ${selectedVoice.speakerCount} speaker IDs. Speaker ID should be in the range ${0} to ${selectedVoice.speakerCount - 1}`)
				}
			}

			const lexicons = await loadLexiconsForLanguage(language, options.customLexiconPaths)

			const modelPath = voicePackagePath!

			const onnxExecutionProviders: OnnxExecutionProvider[] = vitsOptions.provider ? [vitsOptions.provider] : []

			logger.end()

			const { rawAudio, timeline: outTimeline } = await vitsTTS.synthesizeSentence(
				text,
				voice,
				modelPath,
				lengthScale,
				speakerId ?? 0,
				lexicons,
				onnxExecutionProviders)

			synthesizedAudio = rawAudio
			timeline = outTimeline

			shouldPostprocessPitch = true

			logger.end()

			break
		}

		case 'pico': {
			if (inputIsSSML) {
				throw new Error(`The SVOX Pico engine doesn't currently support SSML inputs`)
			}

			const SvoxPicoTTS = await import('../synthesis/SvoxPicoTTS.js')

			const picoSpeed = Math.round(speed * 1.0 * 100)
			const picoPitch = Math.round(pitch * 1.0 * 100)
			const picoVolume = 35.0

			const preparedText = `<speed level='${picoSpeed}'><pitch level='${picoPitch}'><volume level='${picoVolume}'>${simplifiedText}</volume></pitch></speed>`

			logger.end()

			const { textAnalysisFilename, signalGenerationFilename } = SvoxPicoTTS.getResourceFilenamesForLanguage(language)

			const resourceFilePath = resolvePath(voicePackagePath!, textAnalysisFilename)
			const signalGenerationFilePath = resolvePath(voicePackagePath!, signalGenerationFilename)

			const { rawAudio } = await SvoxPicoTTS.synthesize(preparedText, resourceFilePath, signalGenerationFilePath)

			synthesizedAudio = rawAudio

			break
		}

		case 'flite': {
			if (inputIsSSML) {
				throw new Error(`The Flite engine doesn't currently support SSML inputs`)
			}

			const FliteTTS = await import('../synthesis/FliteTTS.js')

			logger.end()

			const { rawAudio, events } = await FliteTTS.synthesize(simplifiedText, voice, voicePackagePath, speed)

			synthesizedAudio = rawAudio

			shouldPostprocessPitch = true

			break
		}

		case 'espeak': {
			const EspeakTTS = await import('../synthesis/EspeakTTS.js')

			const engineOptions = options.espeak!

			const espeakVoice = voice
			const espeakLanguage = selectedVoice.languages[0]
			const espeakRate = engineOptions.rate || speed * 150
			const espeakPitch = engineOptions.pitch || options.pitch! * 50
			const espeakPitchRange = engineOptions.pitchRange || options.pitchVariation! * 50
			const espeakUseKlatt = engineOptions.useKlatt || false
			const espeakInsertSeparators = engineOptions.insertSeparators || false

			const espeakOptions: EspeakOptions = {
				voice: espeakVoice,
				ssml: inputIsSSML,
				rate: espeakRate,
				pitch: espeakPitch,
				pitchRange: espeakPitchRange,
				useKlatt: espeakUseKlatt,
				insertSeparators: espeakInsertSeparators,
			}

			if (inputIsSSML) {
				logger.end()

				const { rawAudio } = await EspeakTTS.synthesize(text, espeakOptions)

				synthesizedAudio = rawAudio
			} else {
				const lexicons = await loadLexiconsForLanguage(language, options.customLexiconPaths)

				logger.end()

				const { referenceSynthesizedAudio, referenceTimeline } = await EspeakTTS.preprocessAndSynthesize(text, espeakLanguage, espeakOptions, lexicons)

				synthesizedAudio = referenceSynthesizedAudio
				timeline = referenceTimeline.flatMap(clause => clause.timeline!)
			}

			break
		}

		case 'sam': {
			if (inputIsSSML) {
				throw new Error(`The SAM engine doesn't support SSML inputs`)
			}

			const SamTTS = await import('../synthesis/SamTTS.js')

			const engineOptions = options.sam!

			const samPitch = clip(engineOptions.pitch || Math.round((1 / pitch) * 64), 0, 255)
			const samSpeed = clip(engineOptions.speed || Math.round((1 / speed) * 72), 0, 255)
			const samMouth = clip(engineOptions.mouth!, 0, 255)
			const samThroat = clip(engineOptions.throat!, 0, 255)

			logger.end()

			const { rawAudio } = await SamTTS.synthesize(simplifiedText, samPitch, samSpeed, samMouth, samThroat)

			synthesizedAudio = rawAudio

			break
		}

		case 'sapi': {
			if (inputIsSSML) {
				throw new Error(`The SAPI engine doesn't currently support SSML inputs`)
			}

			const SapiTTS = await import('../synthesis/SapiTTS.js')

			await SapiTTS.AssertSAPIAvailable(false)

			const engineOptions = options.sapi!

			const sapiRate = engineOptions.rate || 0

			logger.end()

			const { rawAudio, timeline: outTimeline } = await SapiTTS.synthesize(text, voice, sapiRate, false)

			synthesizedAudio = rawAudio
			timeline = outTimeline

			shouldPostprocessSpeed = true
			shouldPostprocessPitch = true

			break
		}

		case 'msspeech': {
			if (inputIsSSML) {
				throw new Error(`The MSSpeech engine doesn't currently support SSML inputs`)
			}

			const SapiTTS = await import('../synthesis/SapiTTS.js')

			await SapiTTS.AssertSAPIAvailable(true)

			const engineOptions = options.msspeech!

			const sapiRate = engineOptions.rate || 0

			logger.end()

			const { rawAudio, timeline: outTimeline } = await SapiTTS.synthesize(text, voice, sapiRate, true)

			synthesizedAudio = rawAudio
			timeline = outTimeline

			shouldPostprocessSpeed = true
			shouldPostprocessPitch = true

			break
		}

		case 'coqui-server': {
			if (inputIsSSML) {
				throw new Error(`The Coqui Server engine doesn't support SSML inputs`)
			}

			const CoquiServerTTS = await import('../synthesis/CoquiServerTTS.js')

			const engineOptions = options.coquiServer!

			const speakerId = engineOptions.speakerId!
			const serverUrl = engineOptions.serverUrl

			if (!serverUrl) {
				throw new Error(`'coqui-server' requires a server URL`)
			}

			logger.end()

			const { rawAudio } = await CoquiServerTTS.synthesize(simplifiedText, speakerId, serverUrl)

			synthesizedAudio = rawAudio

			shouldPostprocessSpeed = true
			shouldPostprocessPitch = true

			break
		}

		case 'google-cloud': {
			const GoogleCloudTTS = await import('../synthesis/GoogleCloudTTS.js')

			const engineOptions = options.googleCloud!

			const apiKey = engineOptions.apiKey

			if (!apiKey) {
				throw new Error(`No Google Cloud API key provided`)
			}

			let pitchDeltaSemitones: number

			// 1 semitone up = multiply by 1.05946
			// 1 semitone down = divide by 1.05946
			if (engineOptions.pitchDeltaSemitones != undefined) {
				pitchDeltaSemitones = engineOptions.pitchDeltaSemitones
			} else if (pitch >= 1.0) {
				pitchDeltaSemitones = Math.round(17.3132 * Math.log(pitch))
			} else {
				pitchDeltaSemitones = Math.round(-17.3132 * Math.log(1 / pitch))
			}

			logger.end()

			const { audioData, timepoints } = await GoogleCloudTTS.synthesize(text, apiKey, language, voice, speed, pitchDeltaSemitones, 0, inputIsSSML)
			const rawAudio = await FFMpegTranscoder.decodeToChannels(audioData)

			synthesizedAudio = rawAudio

			break
		}

		case 'microsoft-azure': {
			const AzureCognitiveServicesTTS = await import('../synthesis/AzureCognitiveServicesTTS.js')

			const engineOptions = options.microsoftAzure!

			const subscriptionKey = engineOptions.subscriptionKey

			if (!subscriptionKey) {
				throw new Error(`No Microsoft Azure subscription key provided`)
			}

			const serviceRegion = engineOptions!.serviceRegion

			if (!serviceRegion) {
				throw new Error(`No Microsoft Azure service region provided`)
			}

			let ssmlPitch: string

			if (engineOptions.pitchDeltaHz != undefined) {
				if (engineOptions.pitchDeltaHz >= 0) {
					ssmlPitch = `+${Math.abs(engineOptions.pitchDeltaHz)}Hz`
				} else {
					ssmlPitch = `-${Math.abs(engineOptions.pitchDeltaHz)}Hz`
				}
			} else {
				ssmlPitch = convertPitchScaleToSSMLValueString(pitch, voiceGender)
			}

			const ssmlRate = convertSpeedScaleToSSMLValueString(speed)

			logger.end()

			const { rawAudio, timeline: outTimeline } = await AzureCognitiveServicesTTS.synthesize(text, subscriptionKey, serviceRegion, language, voice, inputIsSSML, ssmlPitch, ssmlRate)

			synthesizedAudio = rawAudio
			timeline = outTimeline

			break
		}

		case 'amazon-polly': {
			const AwsPollyTTS = await import('../synthesis/AwsPollyTTS.js')

			const engineOptions = options.amazonPolly!

			const region = engineOptions.region

			if (!region) {
				throw new Error(`No Amazon Polly region provided`)
			}

			const accessKeyId = engineOptions.accessKeyId

			if (!accessKeyId) {
				throw new Error(`No Amazon Polly access key id provided`)
			}

			const secretAccessKey = engineOptions.secretAccessKey

			if (!secretAccessKey) {
				throw new Error(`No Amazon Polly secret access key provided`)
			}

			const pollyEngine = engineOptions.pollyEngine
			const lexiconNames = engineOptions.lexiconNames

			logger.end()

			const { rawAudio } = await AwsPollyTTS.synthesize(text, undefined, voice, region, accessKeyId, secretAccessKey, pollyEngine, inputIsSSML, lexiconNames)

			synthesizedAudio = rawAudio

			shouldPostprocessSpeed = true
			shouldPostprocessPitch = true

			break
		}

		case 'openai-cloud': {
			const OpenAICloudTTS = await import('../synthesis/OpenAICloudTTS.js')

			const openAICloudTTSOptions = options.openAICloud!

			if (!openAICloudTTSOptions.apiKey) {
				throw new Error(`No API key given`)
			}

			logger.end();

			synthesizedAudio = await OpenAICloudTTS.synthesize(text, voice, speed, openAICloudTTSOptions)

			shouldPostprocessSpeed = false
			shouldPostprocessPitch = true

			break
		}

		case 'elevenlabs': {
			if (inputIsSSML) {
				throw new Error(`The Elevenlabs engine doesn't support SSML inputs`)
			}

			const ElevenLabsTTS = await import('../synthesis/ElevenlabsTTS.js')

			const engineOptions = options.elevenlabs!

			if (!engineOptions.apiKey) {
				throw new Error(`No ElevenLabs API key provided`)
			}

			const voiceId = (selectedVoice as any)['elevenLabsVoiceId']
			const modelId = (selectedVoice as any)['elevenLabsModelId']

			logger.end()

			const { rawAudio } = await ElevenLabsTTS.synthesize(text, voiceId, modelId, engineOptions)

			synthesizedAudio = rawAudio

			shouldPostprocessSpeed = true
			shouldPostprocessPitch = true

			break
		}

		case 'google-translate': {
			if (inputIsSSML) {
				throw new Error(`The Google Translate engine doesn't support SSML inputs`)
			}

			const GoogleTranslateTTS = await import('../synthesis/GoogleTranslateTTS.js')

			logger.end()

			const { rawAudio, timeline: segmentTimeline } =
				await runOperationWithRetries(
					() => GoogleTranslateTTS.synthesizeLongText(text, language, options.googleTranslate?.tld, options.sentenceEndPause, options.segmentEndPause),
					logger)

			synthesizedAudio = rawAudio

			logger.start(`Generate word-level timestamps by individually aligning fragments`)
			const alignmentOptions: API.AlignmentOptions = extendDeep(options.alignment, { language })

			timeline = await API.alignSegments(synthesizedAudio, segmentTimeline, alignmentOptions)

			shouldPostprocessSpeed = true
			shouldPostprocessPitch = true

			break
		}

		case 'microsoft-edge': {
			if (inputIsSSML) {
				throw new Error(`The Microsoft Edge engine doesn't support SSML inputs`)
			}

			const MicrosoftEdgeTTS = await import('../synthesis/MicrosoftEdgeTTS.js')

			const engineOptions = options.microsoftEdge!

			const trustedClientToken = engineOptions.trustedClientToken

			if (!trustedClientToken) {
				throw new Error('No Microsoft Edge trusted client token provided')
			}

			if (await sha256AsHex(trustedClientToken) != '558d7c6a7f7db444895946fe23a54ad172fd6d159f46cb34dd4db21bb27c07d7') {
				throw new Error('Trusted client token is incorrect.')
			}

			let ssmlPitch: string

			if (engineOptions.pitchDeltaHz != undefined) {
				if (engineOptions.pitchDeltaHz >= 0) {
					ssmlPitch = `+${Math.abs(engineOptions.pitchDeltaHz)}Hz`
				} else {
					ssmlPitch = `-${Math.abs(engineOptions.pitchDeltaHz)}Hz`
				}
			} else {
				ssmlPitch = convertPitchScaleToSSMLValueString(pitch, voiceGender)
			}

			const ssmlRate = convertSpeedScaleToSSMLValueString(speed)

			logger.end()

			const { rawAudio, timeline: edgeTimeline } =
				await runOperationWithRetries(
					() => MicrosoftEdgeTTS.synthesize(text, trustedClientToken!, voice, ssmlPitch, ssmlRate),
					logger)

			synthesizedAudio = rawAudio
			timeline = edgeTimeline

			break
		}

		case 'streamlabs-polly': {
			if (inputIsSSML) {
				throw new Error(`The Streamlabs Polly Engine engine doesn't support SSML inputs`)
			}

			const StreamlabsPollyTTS = await import('../synthesis/StreamlabsPollyTTS.js')

			logger.end()

			const { rawAudio, timeline: segmentTimeline } = await StreamlabsPollyTTS.synthesizeLongText(text, voice, language, options.sentenceEndPause, options.segmentEndPause)

			synthesizedAudio = rawAudio

			logger.start(`Generate word-level timestamps by individually aligning fragments`)
			const alignmentOptions: API.AlignmentOptions = extendDeep(options.alignment, { language })

			timeline = await API.alignSegments(synthesizedAudio, segmentTimeline, alignmentOptions)

			shouldPostprocessSpeed = true
			shouldPostprocessPitch = true

			break
		}

		default: {
			throw new Error(`Engine '${options.engine}' is not supported`)
		}
	}

	logger.start('Postprocess synthesized audio')
	synthesizedAudio = downmixToMono(synthesizedAudio)

	if (options.postProcessing!.normalizeAudio) {
		normalizeAudioLevelInPlace(synthesizedAudio, options.postProcessing!.targetPeak!, options.postProcessing!.maxGainIncrease!)
	} else {
		attenuateIfClippingInPlace(synthesizedAudio)
	}

	const preTrimSampleCount = synthesizedAudio.audioChannels[0].length
	synthesizedAudio.audioChannels[0] = trimAudioStart(synthesizedAudio.audioChannels[0])

	if (timeline) {
		const oldDuration = preTrimSampleCount / synthesizedAudio.sampleRate
		const newDuration = synthesizedAudio.audioChannels[0].length / synthesizedAudio.sampleRate

		timeline = addTimeOffsetToTimeline(timeline, newDuration - oldDuration)
	}

	if (!timeline) {
		logger.start('Align synthesized audio with text')

		let plainText = text

		if (inputIsSSML) {
			plainText = await convertHtmlToText(text)
		}

		const alignmentOptions = options.alignment!

		alignmentOptions.language = language

		if (!alignmentOptions.customLexiconPaths) {
			alignmentOptions.customLexiconPaths = options.customLexiconPaths
		}

		if (alignmentOptions.dtw!.windowDuration == null) {
			alignmentOptions.dtw!.windowDuration = Math.max(5, Math.ceil(0.2 * getRawAudioDuration(synthesizedAudio)))
		}

		const { wordTimeline } = await API.align(synthesizedAudio, plainText, alignmentOptions)

		timeline = wordTimeline

		logger.end()
	}

	const postProcessingOptions = options.postProcessing!

	let timeStretchFactor = postProcessingOptions.speed

	if (shouldPostprocessSpeed && timeStretchFactor == undefined) {
		timeStretchFactor = speed
	}

	let pitchShiftFactor = postProcessingOptions.pitch

	if (shouldPostprocessPitch && pitchShiftFactor == undefined) {
		pitchShiftFactor = pitch
	}

	if ((timeStretchFactor != undefined && timeStretchFactor != 1.0) || (pitchShiftFactor != undefined && pitchShiftFactor != 1.0)) {
		logger.start('Apply time and pitch shifting')

		timeStretchFactor = timeStretchFactor || 1.0
		pitchShiftFactor = pitchShiftFactor || 1.0

		const timePitchShiftingMethod = postProcessingOptions.timePitchShiftingMethod

		if (timePitchShiftingMethod == 'sonic') {
			const sonic = await import('../dsp/Sonic.js')
			synthesizedAudio = await sonic.stretchTimePitch(synthesizedAudio, timeStretchFactor, pitchShiftFactor)
		} else if (timePitchShiftingMethod == 'rubberband') {
			const rubberband = await import('../dsp/Rubberband.js')

			const rubberbandOptions: RubberbandOptions = extendDeep(rubberband.defaultRubberbandOptions, postProcessingOptions.rubberband || {})

			synthesizedAudio = await rubberband.stretchTimePitch(synthesizedAudio, timeStretchFactor, pitchShiftFactor, rubberbandOptions)
		} else {
			throw new Error(`'${timePitchShiftingMethod}' is not a valid time and pitch shifting method`)
		}

		if (timeStretchFactor != 1.0 && timeline) {
			timeline = multiplyTimelineByFactor(timeline, 1 / timeStretchFactor)
		}
	}

	if (timeline) {
		timeline = timeline.filter(entry => isWordOrSymbolWord(entry.text))
	}

	logger.end()

	logger.logDuration('Segment synthesis time', startTimestamp, chalk.magentaBright)

	return { synthesizedAudio, timeline }
}

function convertSpeedScaleToSSMLValueString(rate: number) {
	if (rate >= 1.0) {
		const ratePercentage = Math.floor((rate - 1) * 100)
		return `+${ratePercentage}%`
	} else {
		const ratePercentage = Math.floor(((1 / rate) - 1) * 100)
		return `-${ratePercentage}%`
	}
}

function convertPitchScaleToSSMLValueString(pitch: number, voiceGender: VoiceGender) {
	let fundementalFrequency
	if (voiceGender == 'male') {
		// Use an estimate of the average male voice fundemental frequency
		fundementalFrequency = 120
	} else if (voiceGender == 'female') {
		// Use an estimate of the average female voice fundemental frequency
		fundementalFrequency = 210
	} else {
		// (shouldn't occur since all voices should have a gender specified)
		// Use the average of male and female voice frequency
		fundementalFrequency = 165
	}

	if (pitch >= 1.0) {
		const pitchDeltaHertz = Math.floor(pitch * fundementalFrequency) - fundementalFrequency
		return `+${pitchDeltaHertz}Hz`
	} else {
		const pitchDeltaHertz = fundementalFrequency - Math.floor(pitch * fundementalFrequency)
		return `-${pitchDeltaHertz}Hz`
	}
}

export type SynthesisEngine = 'vits' | 'pico' | 'flite' | 'espeak' | 'sam' | 'sapi' | 'msspeech' | 'coqui-server' | 'google-cloud' | 'microsoft-azure' | 'amazon-polly' | 'openai-cloud' | 'elevenlabs' | 'google-translate' | 'microsoft-edge' | 'streamlabs-polly'

export type TimePitchShiftingMethod = 'sonic' | 'rubberband'

export interface SynthesisOptions {
	engine?: SynthesisEngine

	language?: string
	voice?: string
	voiceGender?: VoiceGender

	speed?: number
	pitch?: number
	pitchVariation?: number

	splitToSentences?: boolean

	ssml?: boolean

	segmentEndPause?: number
	sentenceEndPause?: number

	customLexiconPaths?: string[]

	plainText?: API.PlainTextOptions

	alignment?: API.AlignmentOptions

	postProcessing?: {
		normalizeAudio?: boolean
		targetPeak?: number
		maxGainIncrease?: number

		speed?: number
		pitch?: number

		timePitchShiftingMethod?: TimePitchShiftingMethod,
		rubberband?: RubberbandOptions
	}

	outputAudioFormat?: {
		codec?: 'wav' | 'mp3' | 'opus' | 'm4a' | 'ogg' | 'flac'
		bitrate?: number
	}

	languageDetection?: API.TextLanguageDetectionOptions

	subtitles?: SubtitlesConfig

	vits?: {
		speakerId?: number
		provider?: OnnxExecutionProvider
	}

	pico?: {
	}

	flite?: {
	}

	espeak?: {
		rate?: number
		pitch?: number
		pitchRange?: number

		useKlatt?: boolean
		insertSeparators?: boolean
	}

	sam?: {
		pitch?: number
		speed?: number
		mouth?: number
		throat?: number
	}

	sapi?: {
		rate?: number
	}

	msspeech?: {
		rate?: number
	}

	coquiServer?: {
		serverUrl?: string
		speakerId?: string | null
	}

	googleCloud?: {
		apiKey?: string,
		pitchDeltaSemitones?: number,

		customVoice?: {
			model?: string
			reportedUsage?: string
		}
	}

	microsoftAzure?: {
		subscriptionKey?: string
		serviceRegion?: string
		pitchDeltaHz?: number
	}

	amazonPolly?: {
		region?: string
		accessKeyId?: string
		secretAccessKey?: string
		pollyEngine?: 'standard' | 'neural'
		lexiconNames?: string[]
	}

	openAICloud?: OpenAICloudTTSOptions

	elevenlabs?: ElevenlabsTTSOptions,

	googleTranslate?: {
		tld?: string
	}

	microsoftEdge?: {
		trustedClientToken?: string
		pitchDeltaHz?: number
	}

	streamlabsPolly?: {
	},
}

export const defaultSynthesisOptions: SynthesisOptions = {
	engine: undefined,

	language: undefined,

	voice: undefined,
	voiceGender: undefined,

	speed: 1.0,
	pitch: 1.0,
	pitchVariation: 1.0,

	ssml: false,

	splitToSentences: true,

	segmentEndPause: 1.0,
	sentenceEndPause: 0.75,

	customLexiconPaths: undefined,

	plainText: {
		paragraphBreaks: 'double',
		whitespace: 'collapse'
	},

	alignment: {
		engine: 'dtw',

		dtw: {
			granularity: 'high'
		}
	},

	postProcessing: {
		normalizeAudio: true,
		targetPeak: -3,
		maxGainIncrease: 30,

		speed: undefined,
		pitch: undefined,

		timePitchShiftingMethod: 'sonic',
		rubberband: {
		}
	},

	outputAudioFormat: undefined,

	languageDetection: undefined,

	subtitles: {
	},

	vits: {
		speakerId: undefined,
		provider: undefined,
	},

	pico: {
	},

	flite: {
	},

	espeak: {
		rate: undefined,
		pitch: undefined,
		pitchRange: undefined,
		useKlatt: false
	},

	sam: {
		speed: undefined,
		pitch: undefined,
		mouth: 128,
		throat: 128
	},

	sapi: {
		rate: 0,
	},

	msspeech: {
		rate: 0,
	},

	coquiServer: {
		serverUrl: 'http://[::1]:5002',
		speakerId: null
	},

	googleCloud: {
		apiKey: undefined,

		pitchDeltaSemitones: undefined,

		customVoice: {
		}
	},

	microsoftAzure: {
		subscriptionKey: undefined,
		serviceRegion: undefined,

		pitchDeltaHz: undefined
	},

	amazonPolly: {
		region: undefined,
		accessKeyId: undefined,
		secretAccessKey: undefined,
		pollyEngine: undefined,
		lexiconNames: undefined,
	},

	openAICloud: {
	},

	elevenlabs: {
	},

	googleTranslate: {
		tld: 'us'
	},

	microsoftEdge: {
		trustedClientToken: undefined,

		pitchDeltaHz: undefined
	},

	streamlabsPolly: {
	},
}

/////////////////////////////////////////////////////////////////////////////////////////////
// Voice list request
/////////////////////////////////////////////////////////////////////////////////////////////
export async function requestVoiceList(options: VoiceListRequestOptions): Promise<RequestVoiceListResult> {
	options = extendDeep(defaultVoiceListRequestOptions, options)

	const logger = new Logger()

	const cacheOptions = options.cache!

	let cacheDir = cacheOptions?.path

	if (!cacheDir) {
		const appDataDir = getAppDataDir(appName)
		cacheDir = joinPath(appDataDir, 'voice-list-cache')
		await ensureDir(cacheDir)
	}

	const cacheFilePath = joinPath(cacheDir, `${options.engine}.voices.json`)

	async function loadVoiceList() {
		let voiceList: SynthesisVoice[] = []

		switch (options.engine) {
			case 'espeak': {
				const EspeakTTS = await import('../synthesis/EspeakTTS.js')

				const voices = await EspeakTTS.listVoices()

				voiceList = voices.map(voice => {
					const languages = voice.languages.map(lang => normalizeLanguageCode(lang.name))

					for (const language of languages) {
						const shortLanguageCode = getShortLanguageCode(language)

						if (!languages.includes(shortLanguageCode)) {
							languages.push(shortLanguageCode)
						}
					}


					return {
						name: voice.identifier,
						languages,
						gender: 'male'
					}
				})

				break
			}

			case 'flite': {
				const FliteTTS = await import('../synthesis/FliteTTS.js')

				voiceList = deepClone(FliteTTS.voiceList)

				break
			}

			case 'pico': {
				const SvoxPicoTTS = await import('../synthesis/SvoxPicoTTS.js')

				voiceList = SvoxPicoTTS.voiceList

				break
			}

			case 'sam': {
				voiceList.push({
					name: 'sam',
					languages: ['en-US', 'en'],
					gender: 'male'
				})

				break
			}

			case 'vits': {
				const VitsTTS = await import('../synthesis/VitsTTS.js')

				voiceList = VitsTTS.voiceList.map(entry => {
					return { ...entry, packageName: `vits-${entry.name}` }
				})

				break
			}

			case 'sapi': {
				const SapiTTS = await import('../synthesis/SapiTTS.js')

				await SapiTTS.AssertSAPIAvailable(false)

				voiceList = await SapiTTS.getVoiceList(false)

				break
			}

			case 'msspeech': {
				const SapiTTS = await import('../synthesis/SapiTTS.js')

				await SapiTTS.AssertSAPIAvailable(true)

				voiceList = await SapiTTS.getVoiceList(true)

				break
			}

			case 'coqui-server': {
				voiceList = [{
					name: 'coqui',
					languages: ['en-US'],
					gender: 'unknown'
				}]

				break
			}

			case 'google-cloud': {
				const GoogleCloudTTS = await import('../synthesis/GoogleCloudTTS.js')

				const apiKey = options.googleCloud!.apiKey

				if (!apiKey) {
					throw new Error(`No Google Cloud API key provided`)
				}

				const voices = await GoogleCloudTTS.getVoiceList(apiKey)

				voiceList = voices.map(voice => ({
					name: voice.name,
					languages: [normalizeLanguageCode(voice.languageCodes[0]), getShortLanguageCode(voice.languageCodes[0])],
					gender: voice.ssmlGender.toLowerCase() as ('male' | 'female'),
				}))

				break
			}

			case 'microsoft-azure': {
				const AzureCognitiveServicesTTS = await import('../synthesis/AzureCognitiveServicesTTS.js')

				const subscriptionKey = options.microsoftAzure!.subscriptionKey

				if (!subscriptionKey) {
					throw new Error(`No Microsoft Azure subscription key provided`)
				}

				const serviceRegion = options.microsoftAzure!.serviceRegion

				if (!serviceRegion) {
					throw new Error(`No Microsoft Azure service region provided`)
				}

				const voices = await AzureCognitiveServicesTTS.getVoiceList(subscriptionKey, serviceRegion)

				for (const voice of voices) {
					voiceList.push({
						name: voice.name,
						languages: [normalizeLanguageCode(voice.locale), getShortLanguageCode(voice.locale)],
						gender: voice.gender == 1 ? 'female' : 'male'
					})
				}

				break
			}

			case 'amazon-polly': {
				const AwsPollyTTS = await import('../synthesis/AwsPollyTTS.js')

				const region = options.amazonPolly!.region

				if (!region) {
					throw new Error(`No Amazon Polly region provided`)
				}

				const accessKeyId = options.amazonPolly!.accessKeyId

				if (!accessKeyId) {
					throw new Error(`No Amazon Polly access key id provided`)
				}

				const secretAccessKey = options.amazonPolly!.secretAccessKey

				if (!secretAccessKey) {
					throw new Error(`No Amazon Polly secret access key provided`)
				}

				const voices = await AwsPollyTTS.getVoiceList(region, accessKeyId, secretAccessKey)

				for (const voice of voices) {
					const languageCode = normalizeLanguageCode(voice.LanguageCode!)
					const languageCodes = [languageCode, getShortLanguageCode(languageCode)]

					if (voice.AdditionalLanguageCodes) {
						for (const additionalLanguageCode of voice.AdditionalLanguageCodes) {
							languageCodes.push(
								normalizeLanguageCode(additionalLanguageCode),
								getShortLanguageCode(additionalLanguageCode)
							)
						}
					}

					voiceList.push({
						name: voice.Id!,
						languages: languageCodes,
						gender: voice.Gender!.toLowerCase() as ('male' | 'female')
					})
				}

				break
			}

			case 'openai-cloud': {
				const OpenAICloudTTS = await import('../synthesis/OpenAICloudTTS.js')

				voiceList = OpenAICloudTTS.voiceList

				break
			}

			case 'elevenlabs': {
				const ElevenLabsTTS = await import('../synthesis/ElevenlabsTTS.js')

				const engineOptions = options.elevenlabs!

				const apiKey = engineOptions.apiKey

				if (!apiKey) {
					throw new Error(`No Elevenlabs API key provided`)
				}

				voiceList = await ElevenLabsTTS.getVoiceList(apiKey)

				break
			}

			case 'google-translate': {
				const GoogleTranslateTTS = await import('../synthesis/GoogleTranslateTTS.js')

				const langLookup = GoogleTranslateTTS.supportedLanguageLookup

				for (const langCode in langLookup) {
					voiceList.push({
						name: langLookup[langCode],
						languages: langCode.includes('-') ? [normalizeLanguageCode(langCode), getShortLanguageCode(langCode)] : [normalizeLanguageCode(langCode)],
						gender: 'unknown'
					})
				}

				break
			}

			case 'microsoft-edge': {
				const MicrosoftEdgeTTS = await import('../synthesis/MicrosoftEdgeTTS.js')

				const trustedClientToken = options.microsoftEdge?.trustedClientToken

				if (!trustedClientToken) {
					throw new Error('No Microsoft Edge trusted client token provided')
				}

				const voices =
					await runOperationWithRetries(
						() => MicrosoftEdgeTTS.getVoiceList(trustedClientToken),
						logger)

				voiceList = voices.map((voice: any) => ({
					name: voice.Name,
					languages: [normalizeLanguageCode(voice.Locale), getShortLanguageCode(voice.Locale)],
					gender: voice.Gender == 'Male' ? 'male' : 'female',
				}))

				break
			}

			case 'streamlabs-polly': {
				const StreamlabsPollyTTS = await import('../synthesis/StreamlabsPollyTTS.js')

				voiceList = StreamlabsPollyTTS.voiceList

				break
			}
		}


		if (cacheFilePath) {
			await writeFileSafe(cacheFilePath, await stringifyAndFormatJson(voiceList))
		}

		return voiceList
	}

	let voiceList: SynthesisVoice[]

	if (cacheFilePath && existsSync(cacheFilePath) && await isFileIsUpToDate(cacheFilePath, options.cache!.duration!)) {
		voiceList = await readAndParseJsonFile(cacheFilePath)
	} else {
		voiceList = await loadVoiceList()
	}

	const languageCode = await normalizeIdentifierToLanguageCode(options.language || '')

	if (languageCode) {
		let filteredVoiceList = voiceList.filter(voice => voice.languages.includes(languageCode))

		if (filteredVoiceList.length == 0 && languageCode.includes('-')) {
			const shortLanguageCode = getShortLanguageCode(languageCode)

			filteredVoiceList = voiceList.filter(voice => voice.languages.includes(shortLanguageCode))
		}

		voiceList = filteredVoiceList
	}

	if (options.voiceGender) {
		const genderLowercase = options.voiceGender.toLowerCase()
		voiceList = voiceList.filter(voice => voice.gender == genderLowercase || voice.gender == 'unknown')
	}

	if (options.voice) {
		const namePatternLowerCase = options.voice.toLocaleLowerCase()
		const namePatternParts = namePatternLowerCase.split(/\b/g)

		if (namePatternParts.length > 1) {
			voiceList = voiceList.filter(voice => voice.name.toLocaleLowerCase().includes(namePatternLowerCase))
		} else {
			voiceList = voiceList.filter(voice => {
				const name = voice.name.toLocaleLowerCase()
				const nameParts = name.split(/\b/g)

				for (const namePart of nameParts) {
					if (namePart.startsWith(namePatternLowerCase)) {
						return true
					}
				}

				return false
			})
		}
	}

	let bestMatchingVoice = voiceList[0]

	if (bestMatchingVoice && voiceList.length > 1 && defaultDialectForLanguageCode[languageCode]) {
		const expandedLanguageCode = defaultDialectForLanguageCode[languageCode]

		for (const voice of voiceList) {
			if (voice.languages.includes(expandedLanguageCode)) {
				bestMatchingVoice = voice
				break
			}
		}
	}

	return { voiceList, bestMatchingVoice }
}

export interface RequestVoiceListResult {
	voiceList: API.SynthesisVoice[]
	bestMatchingVoice: API.SynthesisVoice
}

export async function selectBestOfflineEngineForLanguage(language: string): Promise<SynthesisEngine> {
	language = await normalizeIdentifierToLanguageCode(language)

	const VitsTTS = await import('../synthesis/VitsTTS.js')

	const vitsLanguages = getAllLangCodesFromVoiceList(VitsTTS.voiceList)

	if (vitsLanguages.includes(language)) {
		return 'vits'
	}

	return 'espeak'
}

export function getAllLangCodesFromVoiceList(voiceList: SynthesisVoice[]) {
	const languageCodes = new Set<string>()
	const langList: string[] = []

	for (const voice of voiceList) {
		for (const langCode of voice.languages) {
			if (languageCodes.has(langCode)) {
				continue
			}

			langList.push(langCode)
			languageCodes.add(langCode)
		}
	}

	return langList
}

export interface VoiceListRequestOptions extends SynthesisOptions {
	cache?: {
		path?: string
		duration?: number
	}
}

export const defaultVoiceListRequestOptions: VoiceListRequestOptions = {
	...defaultSynthesisOptions,

	cache: {
		path: undefined,
		duration: 60 * 1
	},
}

export interface SynthesisSegmentEventData {
	index: number
	total: number
	audio: RawAudio | Uint8Array
	timeline: Timeline
	transcript: string
	language: string
	peakDecibelsSoFar: number
}

export type SynthesisSegmentEvent = (data: SynthesisSegmentEventData) => Promise<void>

export interface SynthesisVoice {
	name: string
	languages: string[]
	gender: VoiceGender
	speakerCount?: number
	packageName?: string
}

export type VoiceGender = 'male' | 'female' | 'unknown'

export const synthesisEngines: EngineMetadata[] = [
	{
		id: 'vits',
		name: 'VITS',
		description: 'A high-quality end-to-end neural speech synthesis architecture.',
		type: 'local'
	},
	{
		id: 'pico',
		name: 'SVOX Pico',
		description: 'A legacy diphone-based synthesis engine.',
		type: 'local'
	},
	{
		id: 'flite',
		name: 'Flite',
		description: 'A legacy diphone-based synthesis engine.',
		type: 'local'
	},
	{
		id: 'espeak',
		name: 'eSpeak NG',
		description: `A lightweight 'robot' sounding formant-based synthesizer.`,
		type: 'local'
	},
	{
		id: 'sam',
		name: 'SAM (Software Automatic Mouth)',
		description: `A classic 'robot' speech synthesizer from 1982.`,
		type: 'local'
	},
	{
		id: 'sapi',
		name: 'SAPI',
		description: 'Microsoft Speech API (Windows only).',
		type: 'local'
	},
	{
		id: 'msspeech',
		name: 'Microsoft Speech Platform',
		description: 'Microsoft Server Speech API (Windows only).',
		type: 'local'
	},
	{
		id: 'coqui-server',
		name: 'Coqui TTS',
		description: 'A deep learning toolkit for Text-to-Speech.',
		type: 'server'
	},
	{
		id: 'google-cloud',
		name: 'Google Cloud',
		description: 'Google Cloud text-to-speech service.',
		type: 'cloud'
	},
	{
		id: 'microsoft-azure',
		name: 'Azure Cognitive Services',
		description: 'Microsoft Azure cloud text-to-speech service.',
		type: 'cloud'
	},
	{
		id: 'amazon-polly',
		name: 'Amazon Polly',
		description: 'Amazon Polly (also: AWS Polly) cloud text-to-speech.',
		type: 'cloud'
	},
	{
		id: 'openai-cloud',
		name: 'OpenAI Cloud',
		description: 'OpenAI cloud text-to-speech.',
		type: 'cloud'
	},
	{
		id: 'elevenlabs',
		name: 'Elevenlabs',
		description: 'A generative AI text-to-speech cloud service.',
		type: 'cloud'
	},
	{
		id: 'google-translate',
		name: 'Google Translate',
		description: 'Unoffical text-to-speech API used by the Google Translate web interface.',
		type: 'cloud'
	},
	{
		id: 'microsoft-edge',
		name: 'Microsoft Edge',
		description: 'Unoffical text-to-speech API used by the Microsoft Edge browser.',
		type: 'cloud'
	},
	{
		id: 'streamlabs-polly',
		name: 'Streamlabs Polly',
		description: 'Unoffical text-to-speech API provided by Streamlabs.',
		type: 'cloud'
	},
]

