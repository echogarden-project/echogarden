import * as API from '../api/API.js'
import { CLIArguments, parseCLIArguments } from './CLIParser.js'
import { convertHtmlToText, formatIntegerWithLeadingZeros, formatListWithQuotedElements, getWithDefault, logToStderr, setupProgramTerminationListeners, setupUnhandledExceptionListeners, stringifyAndFormatJson } from "../utilities/Utilities.js"
import { getOptionTypeFromSchema, SchemaTypeDefinition } from "./CLIOptionsSchema.js"
import { ParsedConfigFile, parseConfigFile, parseJSONConfigFile } from "./CLIConfigFile.js"

import chalk from 'chalk'
import { RawAudio, applyGainDecibels, encodeWaveBuffer, getEmptyRawAudio, normalizeAudioLevel, sliceRawAudioByTime } from "../audio/AudioUtilities.js"
import { SubtitlesConfig, subtitlesToText, subtitlesToTimeline, timelineToSubtitles } from "../subtitles/Subtitles.js"
import { Logger } from "../utilities/Logger.js"
import { isMainThread, parentPort } from 'node:worker_threads'
import { encodeFromChannels, FFMpegOutputOptions } from "../codecs/FFMpegTranscoder.js"
import { parse as parsePath } from "node:path"
import { splitToParagraphs, splitToWords, wordCharacterPattern } from "../nlp/Segmentation.js"
import { playAudioSamples, playAudioWithTimeline } from "../audio/AudioPlayer.js"
import { extendDeep } from "../utilities/ObjectUtilities.js"
import { Timeline, addTimeOffsetToTimeline, roundTimelineProperties, wordTimelineToSegmentSentenceTimeline } from "../utilities/Timeline.js"
import { ensureDir, existsSync, getFileExtension, readAndParseJsonFile, readFile, readdir, resolveToModuleRootDir, writeFileSafe } from '../utilities/FileSystem.js'
import { formatLanguageCodeWithName, getShortLanguageCode } from '../utilities/Locale.js'
import { APIOptions } from '../api/APIOptions.js'
import { ensureAndGetPackagesDir, getVersionTagFromPackageName, loadPackage, resolveVersionTagForUnversionedPackageName } from '../utilities/PackageManager.js'
import { removePackage } from '../utilities/PackageManager.js'
import { appName } from '../api/Globals.js'
import { ServerOptions, startWebSocketServer } from '../server/Server.js'
import { OpenPromise } from '../utilities/OpenPromise.js'

const log = logToStderr

async function startIfInWorkerThread() {
	if (isMainThread || !parentPort) {
		return
	}

	setupUnhandledExceptionListeners()

	const initOpenPromise = new OpenPromise<void>()

	parentPort.once("message", (message) => {
		if (message.name == 'init') {
			process.stderr.isTTY = message.stdErrIsTTY
			process.stderr.hasColors = () => message.hasColors

			process.stderr.write = (text) => {
				parentPort!.postMessage({ name: 'writeToStdErr', text })
				return true
			}

			initOpenPromise.resolve()
		}
	})

	await initOpenPromise.promise

	start(process.argv.slice(2))
}

export async function start(processArgs: string[]) {
	let args: CLIArguments

	try {
		const packageData = await readAndParseJsonFile(resolveToModuleRootDir("package.json"))

		log(chalk.magentaBright(`Echogarden v${packageData.version}\n`))

		const command = processArgs[0]

		if (!command || command == "help") {
			log(`Supported operations:\n\n${commandHelp.join("\n")}`)
			process.exit(0)
		}

		if (command == "--help") {
			log(`There's no command called '--help'. Did you mean to run 'echogarden help'?`)
			process.exit(0)
		}

		args = parseCLIArguments(command, processArgs.slice(1))

		if (!args.options.has("config")) {
			const defaultConfigFile = `./${appName}.config`
			const defaultJsonConfigFile = defaultConfigFile + ".json"

			if (existsSync(defaultConfigFile)) {
				args.options.set("config", defaultConfigFile)
			} else if (existsSync(defaultJsonConfigFile)) {
				args.options.set("config", defaultJsonConfigFile)
			}
		}

		if (args.options.has("config")) {
			const configFilePath = args.options.get("config")!
			args.options.delete("config")

			let parsedOptionFile: ParsedConfigFile

			if (configFilePath.endsWith(".config")) {
				parsedOptionFile = await parseConfigFile(configFilePath)
			} else if (configFilePath.endsWith(".config.json")) {
				parsedOptionFile = await parseJSONConfigFile(configFilePath)
			} else {
				throw new Error(`Specified config file '${configFilePath}' doesn't have a supported extension. Should be either '.config' or '.config.json'`)
			}

			let sectionName = args.command

			if (sectionName.startsWith("speak-")) {
				sectionName = "speak"
			}

			const newOptions = parsedOptionFile.get(sectionName) || new Map<string, string>()

			for (const [key, value] of args.options) {
				newOptions.set(key, value)
			}

			args.options = newOptions
		}
	} catch (e: any) {
		log(`Error: ${e.message}`)
		process.exit(1)
	}

	let debugMode = false
	if (args.options.has('debug')) {
		args.options.delete('debug')

		debugMode = true
	}

	try {
		await startWithArgs(args)
	} catch (e: any) {
		if (debugMode) {
			log(e)
		} else {
			log(`Error: ${e.message}`)
		}

		process.exit(1)
	}

	process.exit(0)
}

const executableName = `${chalk.cyanBright('echogarden')}`

const commandHelp = [
	`${executableName} ${chalk.magentaBright('speak')} text [output files...] [options...]`,
	`    Speak the given text\n`,
	`${executableName} ${chalk.magentaBright('speak-file')} inputFile [output files...] [options...]`,
	`    Speak the given text file\n`,
	`${executableName} ${chalk.magentaBright('speak-url')} url [output files...] [options...]`,
	`    Speak the HTML document on the given URL\n`,
	`${executableName} ${chalk.magentaBright('speak-wikipedia')} articleName [output files...] [options...]`,
	`    Speak the given wikipedia article, language edition can be specified by --language=<langCode>\n`,
	`${executableName} ${chalk.magentaBright('transcribe')} audioFile [output files...] [options...]`,
	`    Transcribe audio file\n`,
	`${executableName} ${chalk.magentaBright('align')} audioFile referenceFile [output files...] [options...]`,
	`    Align audio file to the reference transcript file\n`,
	`${executableName} ${chalk.magentaBright('translate-speech')} inputFile [output files...] [options...]`,
	`    Transcribe audio file directly to a different language\n`,
	`${executableName} ${chalk.magentaBright('detect-speech-language')} audioFile [output files...] [options...]`,
	`    Detect language of audio file\n`,
	`${executableName} ${chalk.magentaBright('detect-text-language')} inputFile [output files...] [options...]`,
	`    Detect language of textual file\n`,
	`${executableName} ${chalk.magentaBright('detect-voice-activity')} audioFile [output files...] [options...]`,
	`    Detect voice activity in audio file\n`,
	`${executableName} ${chalk.magentaBright('denoise')} audioFile [output files...] [options...]`,
	`    Denoise audio file\n`,
	`${executableName} ${chalk.magentaBright('list-engines')} operation`,
	`    List available engines for the specified operation\n`,
	`${executableName} ${chalk.magentaBright('list-voices')} tts-engine [output files...] [options...]`,
	`    List available voices for the specified TTS engine\n`,
	`${executableName} ${chalk.magentaBright('install')} [package names...] [options...]`,
	`    Install one or more Echogarden packages\n`,
	`${executableName} ${chalk.magentaBright('uninstall')} [package names...] [options...]`,
	`    Uninstall one or more Echogarden packages\n`,
	`${executableName} ${chalk.magentaBright('list-packages')} [options...]`,
	`    List installed Echogarden packages\n`,
]

async function startWithArgs(parsedArgs: CLIArguments) {
	switch (parsedArgs.command) {
		case 'speak':
		case 'speak-file':
		case 'speak-url':
		case 'speak-wikipedia': {
			await speak(parsedArgs.command, parsedArgs.commandArgs, parsedArgs.options)
			break
		}

		case 'transcribe': {
			await transcribe(parsedArgs.commandArgs, parsedArgs.options)
			break
		}

		case 'align': {
			await align(parsedArgs.commandArgs, parsedArgs.options)
			break
		}

		case 'translate-speech': {
			await translateSpeech(parsedArgs.commandArgs, parsedArgs.options)
			break
		}

		case 'detect-language': {
			await detectLanguage(parsedArgs.commandArgs, parsedArgs.options, "auto")
			break
		}

		case 'detect-speech-language': {
			await detectLanguage(parsedArgs.commandArgs, parsedArgs.options, "speech")
			break
		}

		case 'detect-text-language': {
			await detectLanguage(parsedArgs.commandArgs, parsedArgs.options, "text")
			break
		}

		case 'detect-voice-activity': {
			await detectVoiceActivity(parsedArgs.commandArgs, parsedArgs.options)
			break
		}

		case 'denoise': {
			await denoise(parsedArgs.commandArgs, parsedArgs.options)
			break
		}

		case 'list-engines': {
			await listEngines(parsedArgs.commandArgs, parsedArgs.options)
			break
		}

		case 'list-voices': {
			await listTTSVoices(parsedArgs.commandArgs, parsedArgs.options)
			break
		}

		case 'install': {
			await installPackages(parsedArgs.commandArgs, parsedArgs.options)
			break
		}

		case 'uninstall': {
			await uninstallPackages(parsedArgs.commandArgs, parsedArgs.options)
			break
		}

		case 'list-packages': {
			await listPackages(parsedArgs.commandArgs, parsedArgs.options)
			break
		}

		case 'serve': {
			await startServer(parsedArgs.commandArgs, parsedArgs.options)
			break
		}

		default: {
			log(`Unknown command: ${parsedArgs.command}`)
			process.exit(1)
		}
	}
}

type SpeakCommand = "speak" | "speak-file" | "speak-url" | "speak-wikipedia"

async function speak(command: SpeakCommand, commandArgs: string[], cliOptions: Map<string, string>) {
	const progressLogger = new Logger()

	const mainArg = commandArgs[0]
	const outputFilenames = commandArgs.slice(1)

	if (mainArg == undefined) {
		if (command == "speak") {
			throw new Error(`'speak' requires an argument containing the text to speak.`)
		} else if (command == "speak-file") {
			throw new Error(`'speak-file' requires an argument containing the file to speak.`)
		} else if (command == "speak-url") {
			throw new Error(`'speak-url' requires an argument containing the url to speak.`)
		} else if (command == "speak-wikipedia") {
			throw new Error(`'speak-wikipedia' requires an argument containing the name of the Wikipedia article to speak.`)
		}

		return
	}

	const additionalOptionsSchema = new Map<string, SchemaTypeDefinition>()
	additionalOptionsSchema.set('play', { type: 'boolean' })
	additionalOptionsSchema.set('overwrite', { type: 'boolean' })

	if (!cliOptions.has('play') && !cliOptions.has('no-play')) {
		cliOptions.set('play', `${outputFilenames.length == 0}`)
	}

	const options: API.SynthesisOptions = await cliOptionsMapToOptionsObject(cliOptions, "SynthesisOptions", additionalOptionsSchema)

	const allowOverwrite = getWithDefault((options as any).overwrite, overwriteByDefault)
	const { includesPartPattern } = await checkOutputFilenames(outputFilenames, true, true, true, allowOverwrite)

	let textSegments: string[]

	const plainTextParagraphBreaks = options.plainText?.paragraphBreaks || API.defaultSynthesisOptions.plainText!.paragraphBreaks!
	const plainTextWhitespace = options.plainText?.whitespace || API.defaultSynthesisOptions.plainText!.whitespace!

	if (command == "speak") {
		if (options.ssml) {
			textSegments = [mainArg]
		} else {
			textSegments = splitToParagraphs(mainArg, plainTextParagraphBreaks, plainTextWhitespace)
		}
	} else if (command == "speak-file") {
		const sourceFile = mainArg

		if (!existsSync(sourceFile)) {
			throw new Error(`The given source file '${sourceFile}' was not found.`)
		}

		const sourceFileExtension = getFileExtension(sourceFile)
		const fileContent = await readFile(sourceFile, { encoding: 'utf-8' })

		if (options.ssml && sourceFileExtension != "xml" && sourceFileExtension != "ssml") {
			throw new Error(`SSML option is set, but source file doesn't have an 'xml' or 'ssml' extension.`)
		}

		if (sourceFileExtension == "txt") {
			textSegments = splitToParagraphs(fileContent, plainTextParagraphBreaks, plainTextWhitespace)
		} else if (sourceFileExtension == "html" || sourceFileExtension == "htm") {
			const textContent = await convertHtmlToText(fileContent)
			textSegments = splitToParagraphs(textContent, 'single', 'preserve')
		} else if (sourceFileExtension == "srt" || sourceFileExtension == "vtt") {
			const fileContent = await readFile(sourceFile, { encoding: 'utf-8' })
			textSegments = subtitlesToTimeline(fileContent).map(entry => entry.text)
		} else if (sourceFileExtension == "xml" || sourceFileExtension == "ssml") {
			options.ssml = true
			textSegments = [fileContent]
		} else {
			throw new Error(`'speak-file' only supports inputs with extensions 'txt', 'html', 'htm', 'xml', 'ssml', 'srt', 'vtt'`)
		}
	} else if (command == "speak-url") {
		if (options.ssml) {
			throw new Error(`speak-url doesn't provide SSML inputs`)
		}

		const url = mainArg

		if (!url.startsWith("http://") && !url.startsWith("https://")) {
			throw new Error(`'${url}' is not a valid URL. Only 'http://' and 'https://' protocols are supported`)
		}

		const { fetchDocumentText } = await import("../utilities/WebReader.js")
		const textContent = await fetchDocumentText(url)

		textSegments = splitToParagraphs(textContent, 'single', 'preserve')
	} else if (command == "speak-wikipedia") {
		if (options.ssml) {
			throw new Error(`speak-wikipedia doesn't provide SSML inputs`)
		}

		const { parseWikipediaArticle } = await import("../utilities/WikipediaReader.js")
		if (!options.language) {
			options.language = "en"
		}

		textSegments = await parseWikipediaArticle(mainArg, getShortLanguageCode(options.language))
	} else {
		throw new Error("Invalid command")
	}

	async function onSegment(segmentData: API.SynthesisSegmentEventData) {
		if (includesPartPattern) {
			progressLogger.start("Writing output files for segment")
		}

		await writeOutputFilesForSegment(outputFilenames, segmentData.index, segmentData.total, segmentData.audio, segmentData.timeline, segmentData.transcript, segmentData.language)

		progressLogger.end()

		if ((options as any).play) {
			let gainAmount = -3 - segmentData.peakDecibelsSoFar
			//gainAmount = Math.min(gainAmount, 0)

			const audioWithAddedGain = applyGainDecibels(segmentData.audio, gainAmount)
			const segmentWordTimeline = segmentData.timeline.flatMap(sentenceTimeline => sentenceTimeline.timeline!)

			await playAudioWithTimeline(audioWithAddedGain, segmentWordTimeline, segmentData.transcript)
		}
	}

	const { synthesizedAudio, timeline } = await API.synthesizeSegments(textSegments, options, onSegment, undefined)

	if (outputFilenames.length > 0) {
		progressLogger.start("\nWriting output files")
	}

	for (const outputFile of outputFilenames) {
		const partPatternMatch = outputFile.match(segmentFilenamePattern)

		if (partPatternMatch) {
			continue
		}

		const fileSaver = getFileSaver(outputFile)
		await fileSaver(synthesizedAudio, timeline, textSegments.join("\n\n"))
	}

	progressLogger.end()
}

async function transcribe(commandArgs: string[], cliOptions: Map<string, string>) {
	const progressLogger = new Logger()

	const sourceFilename = commandArgs[0]
	const outputFilenames = commandArgs.slice(1)

	if (sourceFilename == undefined) {
		throw new Error(`'transcribe' requires an argument containing the source file name.`)
	}

	if (!existsSync(sourceFilename)) {
		throw new Error(`The given source audio file '${sourceFilename}' was not found.`)
	}

	const additionalOptionsSchema = new Map<string, SchemaTypeDefinition>()
	additionalOptionsSchema.set('play', { type: 'boolean' })
	additionalOptionsSchema.set('overwrite', { type: 'boolean' })

	if (!cliOptions.has('play') && !cliOptions.has('no-play')) {
		cliOptions.set('play', `${outputFilenames.length == 0}`)
	}

	const options: API.RecognitionOptions = await cliOptionsMapToOptionsObject(cliOptions, "RecognitionOptions", additionalOptionsSchema)

	const allowOverwrite = getWithDefault((options as any).overwrite, overwriteByDefault)
	const { includesPartPattern } = await checkOutputFilenames(outputFilenames, true, true, true, allowOverwrite)

	const { transcript, timeline, rawAudio } = await API.recognizeFile(sourceFilename, options)

	if (outputFilenames.length > 0) {
		progressLogger.start("\nWriting output files")
	}

	for (const outputFile of outputFilenames) {
		const partPatternMatch = outputFile.match(segmentFilenamePattern)

		if (partPatternMatch) {
			continue
		}

		const fileSaver = getFileSaver(outputFile)

		await fileSaver(rawAudio, timeline, transcript)
	}

	if ((options as any).play) {
		const normalizedAudio = normalizeAudioLevel(rawAudio)

		await playAudioWithTimeline(normalizedAudio, timeline, transcript)
	}

	progressLogger.end()
}

async function align(commandArgs: string[], cliOptions: Map<string, string>) {
	const progressLogger = new Logger()

	const audioFilename = commandArgs[0]
	const outputFilenames = commandArgs.slice(2)

	if (audioFilename == undefined) {
		throw new Error(`align requires an argument containing the audio file path.`)
	}

	if (!existsSync(audioFilename)) {
		throw new Error(`The given source file '${audioFilename}' was not found.`)
	}

	const alignmentReferenceFile = commandArgs[1]

	if (alignmentReferenceFile == undefined) {
		throw new Error(`align requires a second argument containing the alignment reference file path.`)
	}

	if (!existsSync(alignmentReferenceFile)) {
		throw new Error(`The given reference file '${alignmentReferenceFile}' was not found.`)
	}

	const referenceFileExtension = getFileExtension(alignmentReferenceFile)
	const fileContent = await readFile(alignmentReferenceFile, { encoding: 'utf-8' })

	let text: string

	if (referenceFileExtension == "txt") {
		text = fileContent
	} else if (referenceFileExtension == "html" || referenceFileExtension == "htm") {
		text = await convertHtmlToText(fileContent)
	} else if (referenceFileExtension == "srt" || referenceFileExtension == "vtt") {
		text = subtitlesToText(fileContent)
	} else {
		throw new Error(`align only supports reference files with extensions 'txt', 'html', 'htm', 'srt' or 'vtt'`)
	}

	const additionalOptionsSchema = new Map<string, SchemaTypeDefinition>()
	additionalOptionsSchema.set('play', { type: 'boolean' })
	additionalOptionsSchema.set('overwrite', { type: 'boolean' })

	if (!cliOptions.has('play') && !cliOptions.has('no-play')) {
		cliOptions.set('play', `${outputFilenames.length == 0}`)
	}

	const options: API.AlignmentOptions = await cliOptionsMapToOptionsObject(cliOptions, "AlignmentOptions", additionalOptionsSchema)

	const allowOverwrite = getWithDefault((options as any).overwrite, overwriteByDefault)
	const { includesPartPattern } = await checkOutputFilenames(outputFilenames, true, true, true, allowOverwrite)

	const { wordTimeline, rawAudio, transcript, language } = await API.alignFile(audioFilename, text, options)

	const { segmentTimeline } = await wordTimelineToSegmentSentenceTimeline(wordTimeline, transcript, language)

	if (outputFilenames.length > 0) {
		progressLogger.start("\nWriting output files")
	}

	if (includesPartPattern) {
		for (let segmentIndex = 0; segmentIndex < segmentTimeline.length; segmentIndex++) {
			const segmentEntry = segmentTimeline[segmentIndex]
			const segmentAudio = sliceRawAudioByTime(rawAudio, segmentEntry.startTime, segmentEntry.endTime)
			const sentenceTimeline = addTimeOffsetToTimeline(segmentEntry.timeline!, -segmentEntry.startTime)

			await writeOutputFilesForSegment(outputFilenames, segmentIndex, segmentTimeline.length, segmentAudio, sentenceTimeline, segmentEntry.text, language)
		}
	}

	for (const outputFile of outputFilenames) {
		const partPatternMatch = outputFile.match(segmentFilenamePattern)

		if (partPatternMatch) {
			continue
		}

		const fileSaver = getFileSaver(outputFile)

		await fileSaver(rawAudio, segmentTimeline, transcript)
	}

	if ((options as any).play) {
		const normalizedAudio = normalizeAudioLevel(rawAudio)

		const wordTimeline = segmentTimeline.flatMap(segmentEntry => segmentEntry.timeline!).flatMap(sentenceEntry => sentenceEntry.timeline!)

		await playAudioWithTimeline(normalizedAudio, wordTimeline, transcript)
	}

	progressLogger.end()
}

async function translateSpeech(commandArgs: string[], cliOptions: Map<string, string>) {
	const progressLogger = new Logger()

	const inputFilename = commandArgs[0]
	const outputFilenames = commandArgs.slice(1)

	if (inputFilename == undefined) {
		throw new Error(`translate-speech requires an argument containing the input file path.`)
	}

	if (!existsSync(inputFilename)) {
		throw new Error(`The given input file '${inputFilename}' was not found.`)
	}

	const additionalOptionsSchema = new Map<string, SchemaTypeDefinition>()
	additionalOptionsSchema.set('play', { type: 'boolean' })
	additionalOptionsSchema.set('overwrite', { type: 'boolean' })

	if (!cliOptions.has('play') && !cliOptions.has('no-play')) {
		cliOptions.set('play', `${outputFilenames.length == 0}`)
	}

	const options: API.SpeechTranslationOptions = await cliOptionsMapToOptionsObject(cliOptions, "SpeechTranslationOptions", additionalOptionsSchema)

	const allowOverwrite = getWithDefault((options as any).overwrite, overwriteByDefault)
	await checkOutputFilenames(outputFilenames, true, true, true, allowOverwrite)

	const { transcript, timeline, rawAudio, sourceLanguage } = await API.translateSpeechFile(inputFilename, options)

	if (outputFilenames.length > 0) {
		progressLogger.start("\nWriting output files")
	}

	for (const outputFile of outputFilenames) {
		const partPatternMatch = outputFile.match(segmentFilenamePattern)

		if (partPatternMatch) {
			continue
		}

		const fileSaver = getFileSaver(outputFile)

		await fileSaver(rawAudio, timeline, transcript)
	}

	if ((options as any).play) {
		const normalizedAudio = normalizeAudioLevel(rawAudio)

		await playAudioWithTimeline(normalizedAudio, timeline, transcript)
	}
}

async function detectLanguage(commandArgs: string[], cliOptions: Map<string, string>, mode: "speech" | "text" | "auto") {
	const progressLogger = new Logger()

	const inputFilePath = commandArgs[0]
	const outputFilenames = commandArgs.slice(1)

	if (!existsSync(inputFilePath)) {
		throw new Error(`The given input file '${inputFilePath}' was not found.`)
	}

	const additionalOptionsSchema = new Map<string, SchemaTypeDefinition>()
	additionalOptionsSchema.set('overwrite', { type: 'boolean' })

	const inputFileExtension = getFileExtension(inputFilePath)
	const supportedInputTextFormats = ["txt", "srt", "vtt"]

	let results: API.LanguageDetectionResults

	if (mode == "text" || (mode == "auto" && supportedInputTextFormats.includes(inputFileExtension))) {
		if (inputFilePath == undefined) {
			throw new Error(`detect-text-language requires an argument containing the input file path.`)
		}

		if (!supportedInputTextFormats.includes(inputFileExtension)) {
			throw new Error(`'detect-text-language' doesn't support input file extension '${inputFileExtension}'`)
		}

		const options: API.TextLanguageDetectionOptions = await cliOptionsMapToOptionsObject(cliOptions, "TextLanguageDetectionOptions", additionalOptionsSchema)

		const allowOverwrite = getWithDefault((options as any).overwrite, overwriteByDefault)
		await checkOutputFilenames(outputFilenames, false, true, false, allowOverwrite)

		let text = await readFile(inputFilePath, { encoding: "utf-8" })

		if (inputFileExtension == "srt" || inputFileExtension == "vtt") {
			text = subtitlesToText(text)
		}

		const { detectedLanguage, detectedLanguageProbabilities } = await API.detectTextLanguage(text, options)

		results = detectedLanguageProbabilities
	} else {
		if (inputFilePath == undefined) {
			throw new Error(`detect-speech-language requires an argument containing the input audio file path.`)
		}

		const options: API.SpeechLanguageDetectionOptions = await cliOptionsMapToOptionsObject(cliOptions, "SpeechLanguageDetectionOptions", additionalOptionsSchema)

		const allowOverwrite = getWithDefault((options as any).overwrite, overwriteByDefault)
		await checkOutputFilenames(outputFilenames, false, true, false, allowOverwrite)

		const { detectedLanguage, detectedLanguageProbabilities } = await API.detectSpeechFileLanguage(inputFilePath, options)

		results = detectedLanguageProbabilities
	}

	if (outputFilenames.length > 0) {
		progressLogger.start("\nWriting output files")

		const resultsAsText = results.map(result => `${formatLanguageCodeWithName(result.language)}: ${result.probability.toFixed(5)}`).join("\n")

		for (const outputFile of outputFilenames) {
			const fileSaver = getFileSaver(outputFile)

			await fileSaver(getEmptyRawAudio(0, 0), results as any, resultsAsText)
		}
	} else {
		const resultsAsText = results.slice(0, 10).map(result => `${formatLanguageCodeWithName(result.language)}: ${result.probability.toFixed(5)}`).join("\n")

		log("")
		log(resultsAsText)
	}
}

async function detectVoiceActivity(commandArgs: string[], cliOptions: Map<string, string>) {
	const progressLogger = new Logger()

	const audioFilename = commandArgs[0]
	const outputFilenames = commandArgs.slice(1)

	if (audioFilename == undefined) {
		throw new Error(`detect-voice-activity requires an argument containing the audio file path.`)
	}

	if (!existsSync(audioFilename)) {
		throw new Error(`The given source audio file '${audioFilename}' was not found.`)
	}

	const additionalOptionsSchema = new Map<string, SchemaTypeDefinition>()
	additionalOptionsSchema.set('play', { type: 'boolean' })
	additionalOptionsSchema.set('overwrite', { type: 'boolean' })

	if (!cliOptions.has('play') && !cliOptions.has('no-play')) {
		cliOptions.set('play', `${outputFilenames.length == 0}`)
	}

	const options: API.VADOptions = await cliOptionsMapToOptionsObject(cliOptions, "VADOptions", additionalOptionsSchema)

	const allowOverwrite = getWithDefault((options as any).overwrite, overwriteByDefault)
	await checkOutputFilenames(outputFilenames, true, true, false, allowOverwrite)

	const { timeline, rawAudio } = await API.detectFileVoiceActivity(audioFilename, options)

	if (outputFilenames.length > 0) {
		progressLogger.start("\nWriting output files")
	}

	for (const outputFile of outputFilenames) {
		const partPatternMatch = outputFile.match(segmentFilenamePattern)

		if (partPatternMatch) {
			continue
		}

		const fileSaver = getFileSaver(outputFile)

		await fileSaver(rawAudio, timeline, "")
	}

	if ((options as any).play) {
		const normalizedAudio = normalizeAudioLevel(rawAudio)

		await playAudioWithTimeline(normalizedAudio, timeline)
	}

	progressLogger.end()
}

async function denoise(commandArgs: string[], cliOptions: Map<string, string>) {
	const progressLogger = new Logger()

	const audioFilename = commandArgs[0]
	const outputFilenames = commandArgs.slice(1)

	if (audioFilename == undefined) {
		throw new Error(`'denoise' requires an argument containing the audio file path.`)
	}

	if (!existsSync(audioFilename)) {
		throw new Error(`The given source audio file '${audioFilename}' was not found.`)
	}

	const additionalOptionsSchema = new Map<string, SchemaTypeDefinition>()
	additionalOptionsSchema.set('play', { type: 'boolean' })
	additionalOptionsSchema.set('overwrite', { type: 'boolean' })

	if (!cliOptions.has('play') && !cliOptions.has('no-play')) {
		cliOptions.set('play', `${outputFilenames.length == 0}`)
	}

	const options: API.DenoisingOptions = await cliOptionsMapToOptionsObject(cliOptions, "DenoisingOptions", additionalOptionsSchema)

	const allowOverwrite = getWithDefault((options as any).overwrite, overwriteByDefault)
	await checkOutputFilenames(outputFilenames, true, false, false, allowOverwrite)

	const outputAudio = await API.denoiseFile(audioFilename, options)

	if (outputFilenames.length > 0) {
		progressLogger.start("\nWriting output files")
	}

	for (const filename of outputFilenames) {
		const fileSaver = getFileSaver(filename)

		await fileSaver(outputAudio, [], "")
	}

	if ((options as any).play) {
		await playAudioSamples(outputAudio)
	}

	progressLogger.end()
}

async function listEngines(commandArgs: string[], cliOptions: Map<string, string>) {
	const logger = new Logger()

	const targetOperation = commandArgs[0]

	if (!targetOperation) {
		throw new Error(`The 'list-engines' command requires an argument specifying the operation to list engines for, like 'echogarden list-engines transcribe'.`)
	}

	let engines: API.EngineMetadata[]

	switch (targetOperation) {
		case 'speak':
		case 'speak-file':
		case 'speak-url':
		case 'speak-wikipedia': {
			engines = API.synthesisEngines

			break
		}

		case 'transcribe': {
			engines = API.recognitionEngines

			break
		}

		case 'align': {
			engines = API.alignmentEngines

			break
		}

		case 'translate-speech': {
			engines = API.speechTranslationEngines

			break
		}

		case 'detect-language': {
			engines = [...API.speechLanguageDetectionEngines, ...API.textLanguageDetectionEngines]

			break
		}

		case 'detect-speech-language': {
			engines = API.speechLanguageDetectionEngines

			break
		}

		case 'detect-text-language': {
			engines = API.textLanguageDetectionEngines

			break
		}

		case 'detect-voice-activity': {
			engines = API.vadEngines

			break
		}

		case 'denoise': {
			engines = API.denoisingEngines

			break
		}

		case 'list-voices': {
			engines = API.synthesisEngines

			break
		}

		case 'list-engines':
		case 'install':
		case 'uninstall':
		case 'list-packages': {
			throw new Error(`The operation '${targetOperation}' is not associated with a list of engines.`)
		}

		default: {
			throw new Error(`Unrecognized operation: '${targetOperation}'`)
		}
	}

	for (const [index, engine] of engines.entries()) {
		logger.logTitledMessage('Identifier', chalk.magentaBright(engine.id))
		logger.logTitledMessage('Name', engine.name)
		logger.logTitledMessage('Description', engine.description)
		logger.logTitledMessage('Type', engine.type)

		if (index < engines.length - 1) {
			log("")
		}
	}
}

async function listTTSVoices(commandArgs: string[], cliOptions: Map<string, string>) {
	const progressLogger = new Logger()

	const targetEngine = commandArgs[0]
	const outputFilenames = commandArgs.slice(1)

	if (!targetEngine) {
		const optionsSchema = await getOptionsSchema()
		const { enum: ttsEnginesEnum } = getOptionTypeFromSchema(["VoiceListRequestOptions", "engine"], optionsSchema)

		throw new Error(`list-voices requires an argument specifying one of these supported engines:\n${ttsEnginesEnum!.join(", ")}`)
	}

	const additionalOptionsSchema = new Map<string, SchemaTypeDefinition>()
	additionalOptionsSchema.set('overwrite', { type: 'boolean' })

	cliOptions.set('engine', targetEngine)

	const options: API.VoiceListRequestOptions = await cliOptionsMapToOptionsObject(cliOptions, "VoiceListRequestOptions", additionalOptionsSchema)

	const allowOverwrite = getWithDefault((options as any).overwrite, overwriteByDefault)
	await checkOutputFilenames(outputFilenames, false, true, false, allowOverwrite)

	const { voiceList } = await API.requestVoiceList(options)

	const voiceListText = voiceList.map(entry => {
		const nameText = entry.name
		const languagesNamesText = entry.languages.map(language => formatLanguageCodeWithName(language)).join(", ")
		const genderText = entry.gender

		let entryText = `${chalk.cyanBright('Identifier')}: ${chalk.magentaBright(nameText)}\n${chalk.cyanBright('Languages')}: ${languagesNamesText}\n${chalk.cyanBright('Gender')}: ${genderText}`

		const speakerCount = entry.speakerCount

		if (speakerCount) {
			entryText += `\n${chalk.cyanBright('Speaker count')}: ${speakerCount}`
		}

		return entryText
	}).join("\n\n")

	if (outputFilenames.length > 0) {
		progressLogger.start("\nWriting output files")

		for (const filename of outputFilenames) {
			const fileSaver = getFileSaver(filename)

			const { default: stripAnsi } = await import('strip-ansi')
			const voiceListTextWithoutColors = stripAnsi(voiceListText)

			await fileSaver(getEmptyRawAudio(0, 0), voiceList as any, voiceListTextWithoutColors)
		}
	} else {
		log(voiceListText)
	}
}

async function installPackages(commandArgs: string[], cliOptions: Map<string, string>) {
	if (commandArgs.length == 0) {
		throw new Error("No package names specified")
	}

	const failedPackageNames: string[] = []

	for (const packageName of commandArgs) {
		try {
			await loadPackage(packageName)
		} catch (e) {
			log(`Failed installing package ${packageName}: ${e}`)
			failedPackageNames.push(packageName)
		}
	}

	if (failedPackageNames.length > 0) {
		if (failedPackageNames.length == 1) {
			log(`The package ${failedPackageNames[0]} failed to install`)
		} else {
			log(`The packages ${failedPackageNames.join(', ')} failed to install`)
		}
	}
}

async function uninstallPackages(commandArgs: string[], cliOptions: Map<string, string>) {
	if (commandArgs.length == 0) {
		throw new Error("No package names specified")
	}

	const failedPackageNames: string[] = []

	for (const packageName of commandArgs) {
		try {
			await removePackage(packageName)
		} catch (e) {
			log(`Failed uninstalling package ${packageName}: ${e}`)
			failedPackageNames.push(packageName)
		}
	}

	if (failedPackageNames.length > 0) {
		log(`The packages ${failedPackageNames.join(', ')} failed to uninstall`)
	}
}

async function listPackages(commandArgs: string[], cliOptions: Map<string, string>) {
	const packagesDir = await ensureAndGetPackagesDir()

	const installedPackageNames = await readdir(packagesDir)

	const installedPackageNamesFormatted = installedPackageNames.map(packageName => {
		const versionTag = getVersionTagFromPackageName(packageName)

		let unversionedPackageName = packageName

		if (versionTag) {
			unversionedPackageName = packageName.substring(0, packageName.length - versionTag.length - 1)
		}

		const resolvedVersionTag = resolveVersionTagForUnversionedPackageName(unversionedPackageName)

		if (resolvedVersionTag == versionTag) {
			return packageName
		} else {
			return `${packageName} (unused)`
		}
	})

	installedPackageNamesFormatted.sort()

	log(`Total of ${installedPackageNamesFormatted.length} packages installed in '${packagesDir}'\n`)

	log(installedPackageNamesFormatted.join("\n"))
}

async function startServer(commandArgs: string[], cliOptions: Map<string, string>) {
	const options: ServerOptions = await cliOptionsMapToOptionsObject(cliOptions, "ServerOptions")

	async function onServerStarted(serverOptions: ServerOptions) {
		// Run a test routine (early development)
		//await runClientWebSocketTest(serverOptions.port!, serverOptions.secure!)
	}

	await startWebSocketServer(options, onServerStarted)
}

async function cliOptionsMapToOptionsObject(cliOptionsMap: Map<string, string>, optionsRoot: keyof APIOptions, additionalOptionsSchema?: Map<string, SchemaTypeDefinition>) {
	const optionsSchema = await getOptionsSchema()
	const resultingObj: any = {}

	function setValueAtPath(path: string[], value: any) {
		let currentObject = resultingObj

		for (let keyIndex = 0; keyIndex < path.length; keyIndex++) {
			const key = path[keyIndex]

			if (keyIndex == path.length - 1) {
				currentObject[key] = value
			} else {
				if (!(key in currentObject)) {
					currentObject[key] = {}
				}

				currentObject = currentObject[key]
			}
		}
	}

	for (let [key, value] of cliOptionsMap) {
		let isNegated = false

		if (key.startsWith("no-")) {
			isNegated = true
			key = key.slice(3)

			if (value) {
				throw new Error(`The negated property '${key}' cannot have a value.`)
			}
		}

		const path = key.split(".")

		let optionType: string
		let optionEnum: any[] | undefined

		if (additionalOptionsSchema && additionalOptionsSchema.has(key)) {
			({ type: optionType, enum: optionEnum } = additionalOptionsSchema.get(key)!)
		} else {
			const extendedPath = [optionsRoot, ...path];
			({ type: optionType, enum: optionEnum } = getOptionTypeFromSchema(extendedPath, optionsSchema))
		}

		let parsedValue: any

		if (optionType == 'boolean') {
			if (value == null || value == '') {
				parsedValue = !isNegated
			} else if (value == 'true') {
				parsedValue = true
			} else if (value == 'false') {
				parsedValue = false
			} else {
				throw new Error(`The property '${key}' is a Boolean, which can receive either 'true' or 'false', not '${value}'.`)
			}
		} else if (value == null || value == '') {
			throw new Error(`No value was specified for the property '${key}', which has type ${optionType}.`)
		} else if (isNegated) {
			throw new Error(`The property '${key}' is not a Boolean, and cannot be negated using the 'not-' prefix.`)
		} else if (optionType == 'number') {
			parsedValue = parseFloat(value)

			if (isNaN(parsedValue)) {
				throw new Error(`The property '${key}' is a number. '${value}' cannot be parsed as a number.`)
			}
		} else if (optionType == 'array' || optionType == 'object') {
			try {
				parsedValue = JSON.parse(value)
			} catch (e) {
				parsedValue = value
			}
		} else {
			parsedValue = value
		}

		if (optionEnum && !optionEnum.includes(parsedValue)) {
			throw new Error(`The property '${key}' must be one of ${optionEnum.join(", ")}`)
		}

		setValueAtPath(path, parsedValue)
	}

	return resultingObj
}

let cachedOptionsSchema: any
export async function getOptionsSchema() {
	if (!cachedOptionsSchema) {
		cachedOptionsSchema = await readAndParseJsonFile(resolveToModuleRootDir("data/schemas/options.json"))
	}

	return cachedOptionsSchema
}

export async function checkOutputFilenames(outputFilenames: string[], acceptMediaOutputs: boolean, acceptMetadataOutputs: boolean, acceptSubtitleOutputs: boolean, allowOverwrite: boolean) {
	const supportedFileExtensions: string[] = []

	if (acceptMediaOutputs) {
		supportedFileExtensions.push(...supportedOutputMediaFileExtensions)
	}

	if (acceptMetadataOutputs) {
		supportedFileExtensions.push(...supportedMetadataFileExtensions)
	}

	if (acceptSubtitleOutputs) {
		supportedFileExtensions.push(...supportedSubtitleFileExtensions)
	}

	let includesPartPattern = false

	for (const outputFilename of outputFilenames) {
		const fileExtension = getFileExtension(outputFilename)

		if (!supportedFileExtensions.includes(fileExtension)) {
			let errorText = ""
			errorText += `\nThe specified output path '${outputFilename}' doesn't have a supported file extension.\n`
			errorText += `\nSupported extensions are:\n`

			if (acceptMediaOutputs) {
				errorText += `${formatListWithQuotedElements(supportedOutputMediaFileExtensions)} for audio output files.\n`
			}

			if (acceptMetadataOutputs) {
				errorText += `${formatListWithQuotedElements(supportedMetadataFileExtensions)} for metadata output files.\n`
			}

			if (acceptMetadataOutputs) {
				errorText += `${formatListWithQuotedElements(supportedSubtitleFileExtensions)} for subtitle output files.\n`
			}

			throw new Error(errorText)
		}

		const partPatternMatch = outputFilename.match(segmentFilenamePattern)

		if (partPatternMatch) {
			if (partPatternMatch[1] != "segment") {
				throw new Error(`Invalid square bracket pattern: '${partPatternMatch[1]}'. Square bracket output filename pattern currently only supports the value 'segment'. For example: '/segment/[segment].wav'`)
			}

			includesPartPattern = true
		}

		if (!allowOverwrite && existsSync(outputFilename)) {
			throw new Error(`The output file '${outputFilename}' already exists`)
		}
	}

	return { includesPartPattern }
}

export async function writeOutputFilesForSegment(outputFilenames: string[], index: number, total: number, audio: RawAudio, timeline: Timeline, text: string, language: string) {
	const digitCount = Math.max((total + 1).toString().length, 2)

	const segmentWords = (await splitToWords(text, language)).filter(text => wordCharacterPattern.test(text))

	const segmentJoinedWords = segmentWords.join(" ").trim()

	let initialText: string

	const maxLength = 50

	if (segmentJoinedWords.length < maxLength) {
		initialText = segmentJoinedWords.substring(0, maxLength).trim()
	} else {
		initialText = segmentJoinedWords.substring(0, maxLength - 4).trim() + ".. "
	}

	for (const outputFilename of outputFilenames) {
		const partPatternMatch = outputFilename.match(segmentFilenamePattern)

		if (!partPatternMatch) {
			continue
		}

		const segmentFilename = outputFilename.replace(segmentFilenamePattern, `${formatIntegerWithLeadingZeros(index + 1, digitCount)} - ${initialText}.$2`)

		const fileSaver = getFileSaver(segmentFilename)
		await fileSaver(audio, timeline, text)
	}
}

type FileSaver = (audio: RawAudio, timeline: Timeline, text: string, subtitlesConfig?: SubtitlesConfig) => Promise<void>

function getFileSaver(outputFilePath: string): FileSaver {
	const fileDir = parsePath(outputFilePath).dir || "./"
	const fileExtension = getFileExtension(outputFilePath)

	let fileSaver: FileSaver

	if (fileExtension == "txt") {
		fileSaver = async (audio, timeline, text) => {
			await ensureDir(fileDir)
			return writeFileSafe(outputFilePath, text, { encoding: "utf-8" })
		}
	} else if (fileExtension == "json") {
		fileSaver = async (audio, timeline, text) => {
			await ensureDir(fileDir)

			const roundedTimeline = roundTimelineProperties(timeline)
			return writeFileSafe(outputFilePath, stringifyAndFormatJson(roundedTimeline))
		}
	} else if (fileExtension == "srt") {
		fileSaver = async (audio, timeline, text, subtitlesConfig) => {
			await ensureDir(fileDir)

			subtitlesConfig = extendDeep(subtitlesConfig, { format: "srt" })

			const subtitles = timelineToSubtitles(timeline, subtitlesConfig, false)

			return writeFileSafe(outputFilePath, subtitles)
		}
	} else if (fileExtension == "vtt") {
		fileSaver = async (audio, timeline, text, subtitlesConfig) => {
			await ensureDir(fileDir)

			subtitlesConfig = extendDeep(subtitlesConfig, { format: "webvtt" })

			const subtitles = timelineToSubtitles(timeline, subtitlesConfig, false)

			return writeFileSafe(outputFilePath, subtitles)
		}
	} else if (fileExtension == "wav") {
		fileSaver = async (audio) => {
			await ensureDir(fileDir)

			return writeFileSafe(outputFilePath, encodeWaveBuffer(audio))
		}
	} else if (supportedOutputMediaFileExtensions.includes(fileExtension)) {
		fileSaver = async (audio) => {
			let ffmpegOptions: FFMpegOutputOptions

			if (fileExtension == "mp3") {
				ffmpegOptions = {
					format: "mp3",
					codec: "libmp3lame",
					bitrate: 64,
					customOptions: []
				}
			} else if (fileExtension == "opus") {
				ffmpegOptions = {
					codec: "libopus",
					bitrate: 48,
					customOptions: []
				}
			} else if (fileExtension == "m4a") {
				ffmpegOptions = {
					format: "mp4",
					codec: "aac",
					bitrate: 48,
					customOptions: ["-profile:a", "aac_low", "-movflags", "frag_keyframe+empty_moov"]
				}
			} else if (fileExtension == "ogg") {
				ffmpegOptions = {
					codec: "libvorbis",
					bitrate: 48,
					customOptions: []
				}
			} else if (fileExtension == "flac") {
				ffmpegOptions = {
					format: "flac",
					customOptions: ["-compression_level", "6"]
				}
			} else {
				ffmpegOptions = {
					format: fileExtension,
					customOptions: []
				}
			}

			ffmpegOptions.filename = outputFilePath

			await ensureDir(fileDir)

			await encodeFromChannels(audio, ffmpegOptions)

			return
		}
	} else {
		throw new Error("Unsupported file extension")
	}

	return fileSaver
}

const supportedMetadataFileExtensions = ['txt', 'json']
const supportedSubtitleFileExtensions = ['srt', 'vtt']
const supportedOutputMediaFileExtensions = ["wav", "mp3", "opus", "m4a", "ogg", "flac"]

const segmentFilenamePattern = /\[(.*)\]\.(.*)$/

const overwriteByDefault = true

startIfInWorkerThread()
