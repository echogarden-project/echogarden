import * as API from '../api/API.js'
import { parseCLIArguments } from './CLIParser.js'
import { parseJSONAndGetType, getWithDefault, logToStderr, parseJson, setupUnhandledExceptionListeners, splitFilenameOnExtendedExtension, stringifyAndFormatJson } from '../utilities/Utilities.js'
import { getOptionTypeFromSchema, SchemaTypeDefinition } from './CLIOptionsSchema.js'
import { ParsedConfigFile, parseConfigFile, parseJSONConfigFile } from './CLIConfigFile.js'

import chalk from 'chalk'
import { RawAudio, applyGainDecibels, encodeRawAudioToWave, getEmptyRawAudio, getRawAudioDuration, normalizeAudioLevel, sliceRawAudioByTime } from '../audio/AudioUtilities.js'
import { SubtitlesConfig, subtitlesToText, timelineToSubtitles } from '../subtitles/Subtitles.js'
import { Logger, resetActiveLogger } from '../utilities/Logger.js'
import { isMainThread, parentPort } from 'node:worker_threads'
import { encodeFromChannels, getDefaultFFMpegOptionsForSpeech } from '../codecs/FFMpegTranscoder.js'
import { splitToParagraphs, splitToWords, wordCharacterPattern } from '../nlp/Segmentation.js'
import { playAudioSamplesWithKeyboardControls, playAudioWithWordTimeline } from '../audio/AudioPlayer.js'
import { extendDeep } from '../utilities/ObjectUtilities.js'
import { Timeline, TimelineEntry, addTimeOffsetToTimeline, addWordTextOffsetsToTimeline, roundTimelineProperties } from '../utilities/Timeline.js'
import { ensureDir, existsSync, readAndParseJsonFile, readdir, readFileAsUtf8, writeFileSafe } from '../utilities/FileSystem.js'
import { formatLanguageCodeWithName, getShortLanguageCode } from '../utilities/Locale.js'
import { APIOptions } from '../api/APIOptions.js'
import { ensureAndGetPackagesDir, getVersionTagFromPackageName, loadPackage, resolveVersionTagForUnversionedPackageName } from '../utilities/PackageManager.js'
import { removePackage } from '../utilities/PackageManager.js'
import { appName } from '../api/Common.js'
import { ServerOptions, startServer } from '../server/Server.js'
import { OpenPromise } from '../utilities/OpenPromise.js'
import { getLowercaseFileExtension, joinPath, parsePath, resolveToModuleRootDir } from '../utilities/PathUtilities.js'
import { CLIOptions, CLIOptionsKeys } from './CLIOptions.js'
import { convertHtmlToText, formatIntegerWithLeadingZeros, formatListWithQuotedElements } from '../utilities/StringUtilities.js'

//const log = logToStderr

async function startIfInWorkerThread() {
	if (isMainThread || !parentPort) {
		return
	}

	setupUnhandledExceptionListeners()

	const initOpenPromise = new OpenPromise<void>()

	parentPort.once('message', (message) => {
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

type CLIOperationData = {
	operation: string
	operationArgs: string[]

	globalOptions: API.GlobalOptions
	cliOptions: CLIOptions

	operationOptionsLookup: Map<string, string>
}

export async function start(processArgs: string[]) {
	const logger = new Logger()

	const operationData: CLIOperationData = {
		operation: '',
		operationArgs: [],

		globalOptions: {},
		cliOptions: {},

		operationOptionsLookup: new Map<string, string>(),
	}

	try {
		const packageData = await readAndParseJsonFile(resolveToModuleRootDir('package.json'))

		logger.log(chalk.magentaBright(`Echogarden v${packageData.version}\n`))

		const operation = processArgs[0]

		if (!operation || operation == 'help') {
			logger.log(`Supported operations:\n\n${help.join('\n')}`)
			process.exit(0)
		}

		if (operation == '--help' || operation == '-h') {
			logger.log(`There's no operation called '${operation}'. Did you mean to run 'echogarden help'?`)
			process.exit(1)
		}

		if (operation.startsWith('-')) {
			logger.log(`Operation name '${operation}' is invalid. It cannot start with a hyphen.`)
			process.exit(1)
		}

		const { operationArgs, parsedArgumentsLookup } = parseCLIArguments(processArgs.slice(1))

		const globalOptionsLookup = new Map<string, string>()
		const cliOptionsLookup = new Map<string, string>()
		const operationsOptionsLookup = new Map<string, string>()

		if (!parsedArgumentsLookup.has('config')) {
			const defaultConfigFile = `./${appName}.config`
			const defaultJsonConfigFile = defaultConfigFile + '.json'

			if (existsSync(defaultConfigFile)) {
				parsedArgumentsLookup.set('config', defaultConfigFile)
			} else if (existsSync(defaultJsonConfigFile)) {
				parsedArgumentsLookup.set('config', defaultJsonConfigFile)
			}
		}

		if (parsedArgumentsLookup.has('config')) {
			const configFilePath = parsedArgumentsLookup.get('config')!
			parsedArgumentsLookup.delete('config')

			let parsedConfigFile: ParsedConfigFile

			if (configFilePath.endsWith('.config')) {
				parsedConfigFile = await parseConfigFile(configFilePath)
			} else if (configFilePath.endsWith('.config.json')) {
				parsedConfigFile = await parseJSONConfigFile(configFilePath)
			} else {
				throw new Error(`Specified config file '${configFilePath}' doesn't have a supported extension. Should be either '.config' or '.config.json'`)
			}

			let sectionName = operation

			if (sectionName.startsWith('speak-')) {
				sectionName = 'speak'
			}

			if (parsedConfigFile.has('global')) {
				for (const [key, value] of parsedConfigFile.get('global')!) {
					globalOptionsLookup.set(key, value)
				}
			}

			if (parsedConfigFile.has('cli')) {
				for (const [key, value] of parsedConfigFile.get('cli')!) {
					cliOptionsLookup.set(key, value)
				}
			}

			if (parsedConfigFile.has(sectionName)) {
				for (const [key, value] of parsedConfigFile.get(sectionName)!) {
					operationsOptionsLookup.set(key, value)
				}
			}
		}

		const globalOptionsKeys = API.listGlobalOptions()
		const cliOptionsKeys = CLIOptionsKeys

		for (const [key, value] of parsedArgumentsLookup) {
			if (globalOptionsKeys.includes(key)) {
				globalOptionsLookup.set(key, value)
			} else if (cliOptionsKeys.includes(key as any)) {
				cliOptionsLookup.set(key, value)
			} else {
				operationsOptionsLookup.set(key, value)
			}
		}

		operationData.operation = operation
		operationData.operationArgs = operationArgs

		operationData.globalOptions = await optionsLookupToTypedObject(globalOptionsLookup, 'GlobalOptions')
		operationData.cliOptions = await optionsLookupToTypedObject(cliOptionsLookup, 'CLIOptions')
		operationData.operationOptionsLookup = operationsOptionsLookup
	} catch (e: any) {
		resetActiveLogger()

		logger.logTitledMessage(`Error`, e.message, chalk.redBright, 'error')
		process.exit(1)
	}

	for (const key in operationData.globalOptions) {
		const value = (operationData.globalOptions as any)[key]

		API.setGlobalOption(key as any, value)
	}

	const debugMode = operationData.cliOptions.debug || false

	try {
		await startWithArgs(operationData)
	} catch (e: any) {
		resetActiveLogger()

		if (debugMode) {
			logger.log(e, 'error')
		} else {
			logger.logTitledMessage(`Error`, e.message, chalk.redBright, 'error')
		}

		process.exit(1)
	}

	process.exit(0)
}

const executableName = `${chalk.cyanBright('echogarden')}`

const help = [
	`${executableName} ${chalk.magentaBright('speak')} text [output files...] [options...]`,
	`    Speak the given text\n`,
	`${executableName} ${chalk.magentaBright('speak-file')} inputFile [output files...] [options...]`,
	`    Speak the given text file\n`,
	`${executableName} ${chalk.magentaBright('speak-url')} url [output files...] [options...]`,
	`    Speak the HTML document on the given URL\n`,
	`${executableName} ${chalk.magentaBright('speak-wikipedia')} articleName [output files...] [options...]`,
	`    Speak the given Wikipedia article. Language edition can be specified by --language=<langCode>\n`,
	`${executableName} ${chalk.magentaBright('transcribe')} audioFile [output files...] [options...]`,
	`    Transcribe a spoken audio file\n`,
	`${executableName} ${chalk.magentaBright('align')} audioFile transcriptFile [output files...] [options...]`,
	`    Align spoken audio file to its transcript\n`,
	`${executableName} ${chalk.magentaBright('translate-text')} inputFile [output files...] [options...]`,
	`    Translate text to a different language\n`,
	`${executableName} ${chalk.magentaBright('translate-speech')} audioFile [output files...] [options...]`,
	`    Transcribe spoken audio file directly to a different language\n`,
	`${executableName} ${chalk.magentaBright('align-translation')} audioFile translatedTranscriptFile [output files...] [options...]`,
	`    Align spoken audio file to its translated transcript\n`,
	`${executableName} ${chalk.magentaBright('align-transcript-and-translation')} audioFile transcriptFile translatedTranscriptFile [output files...] [options...]`,
	`    Align spoken audio file to both its transcript and its translated transcript using a two-stage approach.\n`,
	`${executableName} ${chalk.magentaBright('align-timeline-translation')} timelineFile translatedFile [output files...] [options...]`,
	`    Align a given timeline file to its translated text\n`,
	`${executableName} ${chalk.magentaBright('detect-text-language')} inputFile [output files...] [options...]`,
	`    Detect language of textual file\n`,
	`${executableName} ${chalk.magentaBright('detect-speech-language')} audioFile [output files...] [options...]`,
	`    Detect language of spoken audio file\n`,
	`${executableName} ${chalk.magentaBright('detect-voice-activity')} audioFile [output files...] [options...]`,
	`    Detect voice activity in audio file\n`,
	`${executableName} ${chalk.magentaBright('denoise')} audioFile [output files...] [options...]`,
	`    Apply speech denoising to audio file\n`,
	`${executableName} ${chalk.magentaBright('isolate')} audioFile [output files...] [options...]`,
	`    Extract isolated voice track from an audio file\n`,
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
	`${executableName} ${chalk.magentaBright('serve')} [options...]`,
	`    Start a server\n`,
	`Options reference: ${chalk.blueBright('https://bit.ly/echogarden-options')}`
]

async function startWithArgs(operationData: CLIOperationData) {
	const logger = new Logger()

	switch (operationData.operation) {
		case 'speak':
		case 'speak-file':
		case 'speak-url':
		case 'speak-wikipedia': {
			await speak(operationData)
			break
		}

		case 'transcribe': {
			await transcribe(operationData)
			break
		}

		case 'align': {
			await align(operationData)
			break
		}

		case 'translate-text': {
			await translateText(operationData)
			break
		}

		case 'translate-speech': {
			await translateSpeech(operationData)
			break
		}

		case 'align-translation': {
			await alignTranslation(operationData)
			break
		}

		case 'align-transcript-and-translation': {
			await alignTranscriptAndTranslation(operationData)
			break
		}

		case 'align-timeline-translation': {
			await alignTimelineTranslation(operationData)
			break
		}

		case 'detect-language': {
			await detectLanguage(operationData, 'auto')
			break
		}

		case 'detect-speech-language': {
			await detectLanguage(operationData, 'speech')
			break
		}

		case 'detect-text-language': {
			await detectLanguage(operationData, 'text')
			break
		}

		case 'detect-voice-activity': {
			await detectVoiceActivity(operationData)
			break
		}

		case 'denoise': {
			await denoise(operationData)
			break
		}

		case 'isolate': {
			await isolate(operationData)
			break
		}

		case 'list-engines': {
			await listEngines(operationData)
			break
		}

		case 'list-voices': {
			await listTTSVoices(operationData)
			break
		}

		case 'install': {
			await installPackages(operationData)
			break
		}

		case 'uninstall': {
			await uninstallPackages(operationData)
			break
		}

		case 'list-packages': {
			await listPackages(operationData)
			break
		}

		case 'serve': {
			await serve(operationData)
			break
		}

		default: {
			logger.logTitledMessage(`Unknown operation`, operationData.operation, chalk.redBright, 'error')
			process.exit(1)
		}
	}
}

export async function speak(operationData: CLIOperationData) {
	const logger = new Logger()

	const { operationArgs, operation, operationOptionsLookup, cliOptions } = operationData

	const mainArg = operationArgs[0]
	const outputFilenames = operationArgs.slice(1)

	if (mainArg == undefined) {
		if (operation == 'speak') {
			throw new Error(`'speak' requires an argument containing the text to speak.`)
		} else if (operation == 'speak-file') {
			throw new Error(`'speak-file' requires an argument containing the file to speak.`)
		} else if (operation == 'speak-url') {
			throw new Error(`'speak-url' requires an argument containing the url to speak.`)
		} else if (operation == 'speak-wikipedia') {
			throw new Error(`'speak-wikipedia' requires an argument containing the name of the Wikipedia article to speak.`)
		}

		return
	}

	const additionalOptionsSchema = new Map<string, SchemaTypeDefinition>()
	additionalOptionsSchema.set('play', { type: 'boolean' })
	additionalOptionsSchema.set('overwrite', { type: 'boolean' })

	if (cliOptions.play == null) {
		cliOptions.play = outputFilenames.length === 0
	}

	const options = await optionsLookupToTypedObject(operationOptionsLookup, 'SynthesisOptions', additionalOptionsSchema)

	const allowOverwrite = getWithDefault(cliOptions.overwrite, overwriteByDefault)
	const { includesPlaceholderPattern } = await checkOutputFilenames(outputFilenames, true, true, true)

	let plainText: string | undefined = undefined
	let textSegments: string[]

	const plainTextParagraphBreaks = options.plainText?.paragraphBreaks || API.defaultSynthesisOptions.plainText!.paragraphBreaks!
	const plainTextWhitespace = options.plainText?.whitespace || API.defaultSynthesisOptions.plainText!.whitespace!

	if (operation == 'speak') {
		if (options.ssml) {
			textSegments = [mainArg]
		} else {
			textSegments = splitToParagraphs(mainArg, plainTextParagraphBreaks, plainTextWhitespace)
		}

		plainText = mainArg
	} else if (operation == 'speak-file') {
		const sourceFile = mainArg

		if (!existsSync(sourceFile)) {
			throw new Error(`The given source file '${sourceFile}' was not found.`)
		}

		const sourceFileExtension = getLowercaseFileExtension(sourceFile)
		const fileContent = await readFileAsUtf8(sourceFile)

		if (options.ssml && sourceFileExtension != 'xml' && sourceFileExtension != 'ssml') {
			throw new Error(`SSML option is set, but source file doesn't have an 'xml' or 'ssml' extension.`)
		}

		if (sourceFileExtension == 'txt') {
			textSegments = splitToParagraphs(fileContent, plainTextParagraphBreaks, plainTextWhitespace)

			plainText = fileContent
		} else if (sourceFileExtension == 'html' || sourceFileExtension == 'htm') {
			const textContent = await convertHtmlToText(fileContent)
			textSegments = splitToParagraphs(textContent, 'single', 'preserve')
		} else if (sourceFileExtension == 'srt' || sourceFileExtension == 'vtt') {
			const fileContent = await readFileAsUtf8(sourceFile)
			//textSegments = subtitlesToTimeline(fileContent).map(entry => entry.text)
			textSegments = [subtitlesToText(fileContent)]
		} else if (sourceFileExtension == 'xml' || sourceFileExtension == 'ssml') {
			options.ssml = true
			textSegments = [fileContent]
		} else {
			throw new Error(`'speak-file' only supports inputs with extensions 'txt', 'html', 'htm', 'xml', 'ssml', 'srt', 'vtt'`)
		}
	} else if (operation == 'speak-url') {
		if (options.ssml) {
			throw new Error(`speak-url doesn't accept SSML inputs`)
		}

		const url = mainArg

		if (!url.startsWith('http://') && !url.startsWith('https://')) {
			throw new Error(`'${url}' is not a valid URL. Only 'http://' and 'https://' protocols are supported`)
		}

		const { fetchDocumentText } = await import('../utilities/WebReader.js')
		const textContent = await fetchDocumentText(url)

		textSegments = splitToParagraphs(textContent, 'single', 'preserve')
	} else if (operation == 'speak-wikipedia') {
		if (options.ssml) {
			throw new Error(`speak-wikipedia doesn't provide SSML inputs`)
		}

		const { parseWikipediaArticle } = await import('../utilities/WikipediaReader.js')
		if (!options.language) {
			options.language = 'en'
		}

		textSegments = await parseWikipediaArticle(mainArg, getShortLanguageCode(options.language))
	} else {
		throw new Error(`Invalid operation specified: '${operation}'`)
	}

	async function onSegment(segmentData: API.SynthesisSegmentEventData) {
		if (includesPlaceholderPattern) {
			logger.start('Write output files for segment')
		}

		await writeOutputFilesForSegment(outputFilenames, segmentData.index, segmentData.total, segmentData.audio as RawAudio, segmentData.timeline, segmentData.transcript, segmentData.language, allowOverwrite)

		logger.end()

		if (cliOptions.play) {
			let gainAmount = -3 - segmentData.peakDecibelsSoFar
			//gainAmount = Math.min(gainAmount, 0)

			const audioWithAddedGain = applyGainDecibels(segmentData.audio as RawAudio, gainAmount)
			const segmentWordTimeline = segmentData.timeline.flatMap(sentenceTimeline => sentenceTimeline.timeline!)

			await playAudioWithWordTimeline(audioWithAddedGain, segmentWordTimeline, segmentData.transcript, cliOptions.player)
		}
	}

	if (options.outputAudioFormat?.codec) {
		options.outputAudioFormat!.codec = undefined
	}

	const { audio: synthesizedAudio, timeline } = await API.synthesize(textSegments, options, onSegment, undefined)

	if (plainText) {
		addWordTextOffsetsToTimeline(timeline, plainText)
	}

	if (outputFilenames.length > 0) {
		logger.start('\nWrite output files')
	}

	for (const outputFilename of outputFilenames) {
		const placeholderPatternMatch = outputFilename.match(filenamePlaceholderPattern)

		if (placeholderPatternMatch) {
			continue
		}

		const fileSaver = getFileSaver(outputFilename, allowOverwrite)
		await fileSaver(synthesizedAudio as RawAudio, timeline, textSegments.join('\n\n'), options.subtitles)
	}

	logger.end()
}

export async function transcribe(operationData: CLIOperationData) {
	const logger = new Logger()

	const { operationArgs, operationOptionsLookup, cliOptions } = operationData

	const sourceFilename = operationArgs[0]
	const outputFilenames = operationArgs.slice(1)

	if (sourceFilename == undefined) {
		throw new Error(`'transcribe' requires an argument containing the source file name.`)
	}

	if (!existsSync(sourceFilename)) {
		throw new Error(`The given source audio file '${sourceFilename}' was not found.`)
	}

	if (cliOptions.play == null) {
		cliOptions.play = outputFilenames.length === 0
	}

	const options = await optionsLookupToTypedObject(operationOptionsLookup, 'RecognitionOptions')

	const allowOverwrite = getWithDefault(cliOptions.overwrite, overwriteByDefault)
	const { includesPlaceholderPattern } = await checkOutputFilenames(outputFilenames, true, true, true)

	const { transcript, timeline, wordTimeline, language, inputRawAudio, isolatedRawAudio, backgroundRawAudio } = await API.recognize(sourceFilename, options)

	if (outputFilenames.length > 0) {
		logger.start('\nWrite output files')
	}

	for (const outputFilename of outputFilenames) {
		const partPatternMatch = outputFilename.match(filenamePlaceholderPattern)

		if (partPatternMatch) {
			continue
		}

		const fileSaver = getFileSaver(outputFilename, allowOverwrite)

		await fileSaver(inputRawAudio, timeline, transcript, options.subtitles)

		await writeSourceSeparationOutputIfNeeded(outputFilename, isolatedRawAudio, backgroundRawAudio, allowOverwrite, true)
	}

	logger.end()

	if (cliOptions.play) {
		let audioToPlay: RawAudio

		if (isolatedRawAudio) {
			audioToPlay = isolatedRawAudio
		} else {
			audioToPlay = inputRawAudio
		}

		const normalizedAudioToPlay = normalizeAudioLevel(audioToPlay)

		await playAudioWithWordTimeline(normalizedAudioToPlay, wordTimeline, transcript, cliOptions.player)
	}
}

export async function align(operationData: CLIOperationData) {
	const logger = new Logger()

	const { operationArgs, operationOptionsLookup, cliOptions } = operationData

	const audioFilename = operationArgs[0]
	const outputFilenames = operationArgs.slice(2)

	if (audioFilename == undefined) {
		throw new Error(`align requires an argument containing the audio file path.`)
	}

	if (!existsSync(audioFilename)) {
		throw new Error(`The given source file '${audioFilename}' was not found.`)
	}

	const alignmentReferenceFile = operationArgs[1]

	if (alignmentReferenceFile == undefined) {
		throw new Error(`align requires a second argument containing the alignment reference file path.`)
	}

	if (!existsSync(alignmentReferenceFile)) {
		throw new Error(`The given reference file '${alignmentReferenceFile}' was not found.`)
	}

	const referenceFileExtension = getLowercaseFileExtension(alignmentReferenceFile)
	const fileContent = await readFileAsUtf8(alignmentReferenceFile)

	let text: string

	if (referenceFileExtension == 'txt') {
		text = fileContent
	} else if (referenceFileExtension == 'html' || referenceFileExtension == 'htm') {
		text = await convertHtmlToText(fileContent)
	} else if (referenceFileExtension == 'srt' || referenceFileExtension == 'vtt') {
		text = subtitlesToText(fileContent)
	} else {
		throw new Error(`align only supports reference files with extensions 'txt', 'html', 'htm', 'srt' or 'vtt'`)
	}

	if (cliOptions.play == null) {
		cliOptions.play = outputFilenames.length === 0
	}
	const options = await optionsLookupToTypedObject(operationOptionsLookup, 'AlignmentOptions')

	const allowOverwrite = getWithDefault(cliOptions.overwrite, overwriteByDefault)
	const { includesPlaceholderPattern } = await checkOutputFilenames(outputFilenames, true, true, true)

	const { timeline, wordTimeline, transcript, language, inputRawAudio, isolatedRawAudio, backgroundRawAudio } = await API.align(audioFilename, text, options)

	if (outputFilenames.length > 0) {
		logger.start('\nWrite output files')
	}

	if (includesPlaceholderPattern) {
		for (let segmentIndex = 0; segmentIndex < timeline.length; segmentIndex++) {
			const segmentEntry = timeline[segmentIndex]
			const segmentAudio = sliceRawAudioByTime(inputRawAudio, segmentEntry.startTime, segmentEntry.endTime)
			const sentenceTimeline = addTimeOffsetToTimeline(segmentEntry.timeline!, -segmentEntry.startTime)

			await writeOutputFilesForSegment(outputFilenames, segmentIndex, timeline.length, segmentAudio, sentenceTimeline, segmentEntry.text, language, allowOverwrite)
		}
	}

	for (const outputFilename of outputFilenames) {
		const partPatternMatch = outputFilename.match(filenamePlaceholderPattern)

		if (partPatternMatch) {
			continue
		}

		const fileSaver = getFileSaver(outputFilename, allowOverwrite)

		await fileSaver(inputRawAudio, timeline, transcript, options.subtitles)

		await writeSourceSeparationOutputIfNeeded(outputFilename, isolatedRawAudio, backgroundRawAudio, allowOverwrite, true)
	}

	logger.end()

	if (cliOptions.play) {
		let audioToPlay: RawAudio

		if (isolatedRawAudio) {
			audioToPlay = isolatedRawAudio
		} else {
			audioToPlay = inputRawAudio
		}

		const normalizedAudioToPlay = normalizeAudioLevel(audioToPlay)

		await playAudioWithWordTimeline(normalizedAudioToPlay, wordTimeline, transcript, cliOptions.player)
	}
}

export async function alignTranslation(operationData: CLIOperationData) {
	const logger = new Logger()

	const { operationArgs, operationOptionsLookup, cliOptions } = operationData

	const audioFilename = operationArgs[0]
	const outputFilenames = operationArgs.slice(2)

	if (audioFilename == undefined) {
		throw new Error(`align-translation requires a first argument containing the audio file path.`)
	}

	if (!existsSync(audioFilename)) {
		throw new Error(`The given source file '${audioFilename}' was not found.`)
	}

	const alignmentReferenceFile = operationArgs[1]

	if (alignmentReferenceFile == undefined) {
		throw new Error(`align-translation requires a second argument containing the translated reference file path.`)
	}

	if (!existsSync(alignmentReferenceFile)) {
		throw new Error(`The given reference file '${alignmentReferenceFile}' was not found.`)
	}

	const referenceFileExtension = getLowercaseFileExtension(alignmentReferenceFile)
	const fileContent = await readFileAsUtf8(alignmentReferenceFile)

	let text: string

	if (referenceFileExtension == 'txt') {
		text = fileContent
	} else if (referenceFileExtension == 'html' || referenceFileExtension == 'htm') {
		text = await convertHtmlToText(fileContent)
	} else if (referenceFileExtension == 'srt' || referenceFileExtension == 'vtt') {
		text = subtitlesToText(fileContent)
	} else {
		throw new Error(`align-translation only supports reference files with extensions 'txt', 'html', 'htm', 'srt' or 'vtt'`)
	}

	if (cliOptions.play == null) {
		cliOptions.play = outputFilenames.length === 0
	}

	const options = await optionsLookupToTypedObject(operationOptionsLookup, 'TranslationAlignmentOptions')

	const allowOverwrite = getWithDefault(cliOptions.overwrite, overwriteByDefault)
	const { includesPlaceholderPattern } = await checkOutputFilenames(outputFilenames, true, true, true)

	const {
		timeline,
		wordTimeline,
		translatedTranscript,
		sourceLanguage,
		targetLanguage,
		inputRawAudio,
		isolatedRawAudio,
		backgroundRawAudio } = await API.alignTranslation(audioFilename, text, options)

	if (outputFilenames.length > 0) {
		logger.start('\nWrite output files')
	}

	if (includesPlaceholderPattern) {
		for (let segmentIndex = 0; segmentIndex < timeline.length; segmentIndex++) {
			const segmentEntry = timeline[segmentIndex]
			const segmentAudio = sliceRawAudioByTime(inputRawAudio, segmentEntry.startTime, segmentEntry.endTime)
			const sentenceTimeline = addTimeOffsetToTimeline(segmentEntry.timeline!, -segmentEntry.startTime)

			await writeOutputFilesForSegment(outputFilenames, segmentIndex, timeline.length, segmentAudio, sentenceTimeline, segmentEntry.text, targetLanguage, allowOverwrite)
		}
	}

	for (const outputFilename of outputFilenames) {
		const partPatternMatch = outputFilename.match(filenamePlaceholderPattern)

		if (partPatternMatch) {
			continue
		}

		const fileSaver = getFileSaver(outputFilename, allowOverwrite)

		await fileSaver(inputRawAudio, timeline, translatedTranscript, options.subtitles)

		await writeSourceSeparationOutputIfNeeded(outputFilename, isolatedRawAudio, backgroundRawAudio, allowOverwrite, true)
	}

	logger.end()

	if (cliOptions.play) {
		let audioToPlay: RawAudio

		if (isolatedRawAudio) {
			audioToPlay = isolatedRawAudio
		} else {
			audioToPlay = inputRawAudio
		}

		const normalizedAudioToPlay = normalizeAudioLevel(audioToPlay)

		await playAudioWithWordTimeline(normalizedAudioToPlay, wordTimeline, translatedTranscript, cliOptions.player)
	}
}

export async function alignTranscriptAndTranslation(operationData: CLIOperationData) {
	const logger = new Logger()

	const { operationArgs, operationOptionsLookup, cliOptions } = operationData

	const audioFilename = operationArgs[0]
	const outputFilenames = operationArgs.slice(3)

	if (audioFilename == undefined) {
		throw new Error(`align-transcript-and-translation requires a first argument containing the audio file path.`)
	}

	if (!existsSync(audioFilename)) {
		throw new Error(`The given source file '${audioFilename}' was not found.`)
	}

	const nativeTranscriptFilePath = operationArgs[1]

	if (nativeTranscriptFilePath == undefined) {
		throw new Error(`align-transcript-and-translation requires a second argument containing the native language transcript file path.`)
	}

	if (!existsSync(nativeTranscriptFilePath)) {
		throw new Error(`The given transcript file '${nativeTranscriptFilePath}' was not found.`)
	}

	const translatedTranscriptFilePath = operationArgs[2]

	if (translatedTranscriptFilePath == undefined) {
		throw new Error(`align-transcript-and-translation requires a third argument containing the translated language transcript file path.`)
	}

	if (!existsSync(translatedTranscriptFilePath)) {
		throw new Error(`The given translated transcript file '${nativeTranscriptFilePath}' was not found.`)
	}

	let transcript: string

	{
		const nativeTranscriptFileExtension = getLowercaseFileExtension(nativeTranscriptFilePath)
		const fileContent = await readFileAsUtf8(nativeTranscriptFilePath)


		if (nativeTranscriptFileExtension == 'txt') {
			transcript = fileContent
		} else if (nativeTranscriptFileExtension == 'html' || nativeTranscriptFileExtension == 'htm') {
			transcript = await convertHtmlToText(fileContent)
		} else if (nativeTranscriptFileExtension == 'srt' || nativeTranscriptFileExtension == 'vtt') {
			transcript = subtitlesToText(fileContent)
		} else {
			throw new Error(`align-transcript-and-translation only supports transcript files with extensions 'txt', 'html', 'htm', 'srt' or 'vtt'`)
		}
	}

	let translatedTranscript: string

	{
		const translatedTranscriptFileExtension = getLowercaseFileExtension(translatedTranscriptFilePath)
		const fileContent = await readFileAsUtf8(translatedTranscriptFilePath)

		if (translatedTranscriptFileExtension == 'txt') {
			translatedTranscript = fileContent
		} else if (translatedTranscriptFileExtension == 'html' || translatedTranscriptFileExtension == 'htm') {
			translatedTranscript = await convertHtmlToText(fileContent)
		} else if (translatedTranscriptFileExtension == 'srt' || translatedTranscriptFileExtension == 'vtt') {
			translatedTranscript = subtitlesToText(fileContent)
		} else {
			throw new Error(`align-transcript-and-translation only supports transcript files with extensions 'txt', 'html', 'htm', 'srt' or 'vtt'`)
		}
	}

	if (cliOptions.play == null) {
		cliOptions.play = outputFilenames.length === 0
	}

	const options = await optionsLookupToTypedObject(operationOptionsLookup, 'TranscriptAndTranslationAlignmentOptions')

	const allowOverwrite = getWithDefault(cliOptions.overwrite, overwriteByDefault)
	const { includesPlaceholderPattern } = await checkOutputFilenames(outputFilenames, true, true, true)

	const {
		timeline,
		wordTimeline,

		translatedTimeline,
		translatedWordTimeline,

		sourceLanguage,
		targetLanguage,

		inputRawAudio,
		isolatedRawAudio,
		backgroundRawAudio } = await API.alignTranscriptAndTranslation(audioFilename, transcript, translatedTranscript, options)

	if (outputFilenames.length > 0) {
		logger.start('\nWrite output files')
	}

	for (const outputFilename of outputFilenames) {
		const partPatternMatch = outputFilename.match(filenamePlaceholderPattern)

		if (partPatternMatch) {
			continue
		}

		const fileSaver = getFileSaver(outputFilename, allowOverwrite)

		await fileSaver(inputRawAudio, timeline, transcript, options.subtitles)

		await writeSourceSeparationOutputIfNeeded(outputFilename, isolatedRawAudio, backgroundRawAudio, allowOverwrite, true)

		const fileExtension = getLowercaseFileExtension(outputFilename)

		if (['json', 'txt', 'srt', 'vtt'].includes(fileExtension)) {
			const pathWithoutExtension = outputFilename.substring(0, outputFilename.lastIndexOf('.'))
			const translatedOutputPath = `${pathWithoutExtension}.translated.${fileExtension}`

			const translatedFileSaver = getFileSaver(translatedOutputPath, allowOverwrite)
			await translatedFileSaver(inputRawAudio, translatedTimeline, translatedTranscript, options.subtitles)
		}
	}

	logger.end()

	if (cliOptions.play) {
		let audioToPlay: RawAudio

		if (isolatedRawAudio) {
			audioToPlay = isolatedRawAudio
		} else {
			audioToPlay = inputRawAudio
		}

		const normalizedAudioToPlay = normalizeAudioLevel(audioToPlay)

		await playAudioWithWordTimeline(normalizedAudioToPlay, translatedWordTimeline, translatedTranscript, cliOptions.player)
	}
}

export async function alignTimelineTranslation(operationData: CLIOperationData) {
	const logger = new Logger()

	const { operationArgs, operationOptionsLookup, cliOptions } = operationData

	const timelineFilename = operationArgs[0]
	const outputFilenames = operationArgs.slice(2)

	if (timelineFilename == undefined) {
		throw new Error(`align-timeline-translation requires a first argument containing the timeline file path.`)
	}

	if (getLowercaseFileExtension(timelineFilename) != 'json') {
		throw new Error(`align-timeline-translation only supports timeline files with extension 'json'`)
	}

	if (!existsSync(timelineFilename)) {
		throw new Error(`The given timeline file '${timelineFilename}' was not found.`)
	}

	const timeline = await readAndParseJsonFile(timelineFilename) as Timeline

	const translationFilePath = operationArgs[1]

	if (translationFilePath == undefined) {
		throw new Error(`align-timeline-translation requires a second argument containing the translated reference file path.`)
	}

	if (!existsSync(translationFilePath)) {
		throw new Error(`The given reference file '${translationFilePath}' was not found.`)
	}

	const translationFileExtension = getLowercaseFileExtension(translationFilePath)
	const translationFileContent = await readFileAsUtf8(translationFilePath)

	let translationText: string

	if (translationFileExtension == 'txt') {
		translationText = translationFileContent
	} else if (translationFileExtension == 'html' || translationFileExtension == 'htm') {
		translationText = await convertHtmlToText(translationFileContent)
	} else if (translationFileExtension == 'srt' || translationFileExtension == 'vtt') {
		translationText = subtitlesToText(translationFileContent)
	} else {
		throw new Error(`align only supports reference files with extensions 'txt', 'html', 'htm', 'srt' or 'vtt'`)
	}

	const options = await optionsLookupToTypedObject(operationOptionsLookup, 'TimelineTranslationAlignmentOptions')

	const {
		timeline: translationTimeline,
		wordTimeline: translationWordTimeline,
		rawAudio
	} = await API.alignTimelineTranslation(timeline, translationText, options)

	if (outputFilenames.length > 0) {
		logger.start('\nWrite output files')
	}

	const allowOverwrite = getWithDefault(cliOptions.overwrite, overwriteByDefault)

	for (const outputFilename of outputFilenames) {
		const partPatternMatch = outputFilename.match(filenamePlaceholderPattern)

		if (partPatternMatch) {
			continue
		}

		const fileSaver = getFileSaver(outputFilename, allowOverwrite)

		await fileSaver(getEmptyRawAudio(1, 16000), translationTimeline, translationText, options.subtitles)
	}

	logger.end()

	if (cliOptions.play && rawAudio) {
		const normalizedAudioToPlay = normalizeAudioLevel(rawAudio)

		let transcriptToPlay: string
		let timelineToPlay: Timeline

		transcriptToPlay = translationText
		timelineToPlay = translationWordTimeline

		await playAudioWithWordTimeline(normalizedAudioToPlay, timelineToPlay, transcriptToPlay, cliOptions.player)
	}
}

export async function translateText(operationData: CLIOperationData) {
	const logger = new Logger()

	const { operationArgs, operationOptionsLookup, cliOptions } = operationData

	const inputFilename = operationArgs[0]
	const outputFilenames = operationArgs.slice(1)

	if (inputFilename == undefined) {
		throw new Error(`translate-text requires an argument containing the input file path.`)
	}

	if (!existsSync(inputFilename)) {
		throw new Error(`The given input file '${inputFilename}' was not found.`)
	}

	const inputFileExtension = getLowercaseFileExtension(inputFilename)
	const inputFileContent = await readFileAsUtf8(inputFilename)

	let inputText: string

	if (inputFileExtension === 'txt') {
		inputText = inputFileContent
	} else if (inputFileExtension === 'html' || inputFileExtension === 'htm') {
		inputText = await convertHtmlToText(inputFileContent)
	} else if (inputFileExtension == 'srt' || inputFileExtension == 'vtt') {
		inputText = subtitlesToText(inputFileContent)
	} else {
		throw new Error(`translate-text only supports input files with extensions 'txt', 'html', 'htm', 'srt' or 'vtt'`)
	}

	const options = await optionsLookupToTypedObject(operationOptionsLookup, 'TextTranslationOptions')

	const allowOverwrite = getWithDefault(cliOptions.overwrite, overwriteByDefault)

	await checkOutputFilenames(outputFilenames, false, true, true)

	const {
		text,
		translatedText,

		translationPairs,

		sourceLanguage,
		targetLanguage,
	} = await API.translateText(inputText, options)

	if (outputFilenames.length > 0) {
		logger.start('\nWrite output files')

		for (const outputFilename of outputFilenames) {
			const partPatternMatch = outputFilename.match(filenamePlaceholderPattern)

			if (partPatternMatch) {
				continue
			}

			const fileSaver = getFileSaver(outputFilename, allowOverwrite)

			await fileSaver(getEmptyRawAudio(1, 16000), translationPairs as any as Timeline, translatedText, undefined)
		}

		logger.end()
	} else {
		logger.log(``)
		logger.log(translatedText)
	}
}

export async function translateSpeech(operationData: CLIOperationData) {
	const logger = new Logger()

	const { operationArgs, operationOptionsLookup, cliOptions } = operationData

	const inputFilename = operationArgs[0]
	const outputFilenames = operationArgs.slice(1)

	if (inputFilename == undefined) {
		throw new Error(`translate-speech requires an argument containing the input file path.`)
	}

	if (!existsSync(inputFilename)) {
		throw new Error(`The given input file '${inputFilename}' was not found.`)
	}

	if (cliOptions.play == null) {
		cliOptions.play = outputFilenames.length === 0
	}

	const options = await optionsLookupToTypedObject(operationOptionsLookup, 'SpeechTranslationOptions')

	const allowOverwrite = getWithDefault(cliOptions.overwrite, overwriteByDefault)

	await checkOutputFilenames(outputFilenames, true, true, true)

	const {
		transcript,

		timeline,
		wordTimeline,

		sourceLanguage,
		targetLanguage,

		inputRawAudio,
		isolatedRawAudio,
		backgroundRawAudio
	} = await API.translateSpeech(inputFilename, options)

	if (outputFilenames.length > 0) {
		logger.start('\nWrite output files')
	}

	for (const outputFilename of outputFilenames) {
		const partPatternMatch = outputFilename.match(filenamePlaceholderPattern)

		if (partPatternMatch) {
			continue
		}

		const fileSaver = getFileSaver(outputFilename, allowOverwrite)

		await fileSaver(inputRawAudio, timeline, transcript, options.subtitles)

		await writeSourceSeparationOutputIfNeeded(outputFilename, isolatedRawAudio, backgroundRawAudio, allowOverwrite, true)
	}

	logger.end()

	if (cliOptions.play) {
		let audioToPlay: RawAudio

		if (isolatedRawAudio) {
			audioToPlay = isolatedRawAudio
		} else {
			audioToPlay = inputRawAudio
		}

		const normalizedAudioToPlay = normalizeAudioLevel(audioToPlay)

		let transcriptToPlay: string
		let timelineToPlay: Timeline

		if (wordTimeline) {
			transcriptToPlay = transcript
			timelineToPlay = wordTimeline
		} else {
			timelineToPlay = timeline.map(entry => ({
				type: 'word',
				text: entry.text.trim(),
				startTime: entry.startTime,
				endTime: entry.endTime
			}))

			transcriptToPlay = ''

			for (const entry of timelineToPlay) {
				transcriptToPlay += entry.text
				transcriptToPlay += ' '
			}

			transcriptToPlay = transcriptToPlay.trim()
		}

		await playAudioWithWordTimeline(normalizedAudioToPlay, timelineToPlay, transcriptToPlay, cliOptions.player)
	}
}

export async function detectLanguage(operationData: CLIOperationData, mode: 'speech' | 'text' | 'auto') {
	const logger = new Logger()

	const { operationArgs, operationOptionsLookup, cliOptions } = operationData

	const inputFilePath = operationArgs[0]
	const outputFilenames = operationArgs.slice(1)

	if (!existsSync(inputFilePath)) {
		throw new Error(`The given input file '${inputFilePath}' was not found.`)
	}

	const inputFileExtension = getLowercaseFileExtension(inputFilePath)
	const supportedInputTextFormats = ['txt', 'srt', 'vtt']

	let results: API.LanguageDetectionResults

	let allowOverwrite: boolean

	if (mode == 'text' || (mode == 'auto' && supportedInputTextFormats.includes(inputFileExtension))) {
		if (inputFilePath == undefined) {
			throw new Error(`detect-text-language requires an argument containing the input file path.`)
		}

		if (!supportedInputTextFormats.includes(inputFileExtension)) {
			throw new Error(`'detect-text-language' doesn't support input file extension '${inputFileExtension}'`)
		}

		const options = await optionsLookupToTypedObject(operationOptionsLookup, 'TextLanguageDetectionOptions')
		allowOverwrite = getWithDefault(cliOptions.overwrite, overwriteByDefault)

		await checkOutputFilenames(outputFilenames, false, true, false)

		let text = await readFileAsUtf8(inputFilePath)

		if (inputFileExtension == 'srt' || inputFileExtension == 'vtt') {
			text = subtitlesToText(text)
		}

		const { detectedLanguage, detectedLanguageProbabilities } = await API.detectTextLanguage(text, options)

		results = detectedLanguageProbabilities
	} else {
		if (inputFilePath == undefined) {
			throw new Error(`detect-speech-language requires an argument containing the input audio file path.`)
		}

		const options = await optionsLookupToTypedObject(operationOptionsLookup, 'SpeechLanguageDetectionOptions')
		allowOverwrite = getWithDefault(cliOptions.overwrite, overwriteByDefault)

		await checkOutputFilenames(outputFilenames, false, true, false)

		const { detectedLanguage, detectedLanguageProbabilities } = await API.detectSpeechLanguage(inputFilePath, options)

		results = detectedLanguageProbabilities
	}

	if (outputFilenames.length > 0) {
		logger.start('\nWrite output files')

		const resultsAsText = results.map(result => `${formatLanguageCodeWithName(result.language)}: ${result.probability.toFixed(5)}`).join('\n')

		for (const outputFilename of outputFilenames) {
			const fileSaver = getFileSaver(outputFilename, allowOverwrite)

			await fileSaver(getEmptyRawAudio(0, 0), results as any, resultsAsText)
		}
	} else {
		const resultsAsText = results.slice(0, 10).map(result => `${formatLanguageCodeWithName(result.language)}: ${result.probability.toFixed(5)}`).join('\n')

		logger.log('', 'output')
		logger.log(resultsAsText, 'output')
	}

	logger.end()
}

export async function detectVoiceActivity(operationData: CLIOperationData) {
	const logger = new Logger()

	const { operationArgs, operationOptionsLookup, cliOptions } = operationData

	const audioFilename = operationArgs[0]
	const outputFilenames = operationArgs.slice(1)

	if (audioFilename == undefined) {
		throw new Error(`detect-voice-activity requires an argument containing the audio file path.`)
	}

	if (!existsSync(audioFilename)) {
		throw new Error(`The given source audio file '${audioFilename}' was not found.`)
	}

	if (cliOptions.play == null) {
		cliOptions.play = outputFilenames.length === 0
	}

	const options = await optionsLookupToTypedObject(operationOptionsLookup, 'VADOptions')

	const allowOverwrite = getWithDefault(cliOptions.overwrite, overwriteByDefault)

	await checkOutputFilenames(outputFilenames, true, true, true)

	let { timeline, verboseTimeline, inputRawAudio, croppedRawAudio } = await API.detectVoiceActivity(audioFilename, options)

	if (outputFilenames.length > 0) {
		logger.start('\nWrite output files')
	}

	for (const outputFilename of outputFilenames) {
		const partPatternMatch = outputFilename.match(filenamePlaceholderPattern)

		if (partPatternMatch) {
			continue
		}

		const fileSaver = getFileSaver(outputFilename, allowOverwrite)

		await fileSaver(inputRawAudio, timeline, '', { maxAddedDuration: 0 })

		const fileExtension = getLowercaseFileExtension(outputFilename)

		if (supportedOutputMediaFileExtensions.includes(fileExtension)) {
			const pathWithoutExtension = outputFilename.substring(0, outputFilename.lastIndexOf('.'))

			const isolatedOutputFilePath = `${pathWithoutExtension}.cropped.${fileExtension}`

			const fileSaver = getFileSaver(isolatedOutputFilePath, allowOverwrite)

			await fileSaver(croppedRawAudio, [], '')
		}
	}

	logger.end()

	if (cliOptions.play) {
		const normalizedAudio = normalizeAudioLevel(inputRawAudio)

		const timelineToPlay = verboseTimeline.map(entry => {
			return { ...entry, type: 'word' } as TimelineEntry
		})

		await playAudioWithWordTimeline(normalizedAudio, timelineToPlay, cliOptions.player)
	}
}

export async function denoise(operationData: CLIOperationData) {
	const logger = new Logger()

	const { operationArgs, operationOptionsLookup, cliOptions } = operationData

	const audioFilename = operationArgs[0]
	const outputFilenames = operationArgs.slice(1)

	if (audioFilename == undefined) {
		throw new Error(`'denoise' requires an argument containing the audio file path.`)
	}

	if (!existsSync(audioFilename)) {
		throw new Error(`The given source audio file '${audioFilename}' was not found.`)
	}

	if (cliOptions.play == null) {
		cliOptions.play = outputFilenames.length === 0
	}

	const options = await optionsLookupToTypedObject(operationOptionsLookup, 'DenoisingOptions')

	const allowOverwrite = getWithDefault(cliOptions.overwrite, overwriteByDefault)

	await checkOutputFilenames(outputFilenames, true, false, false)

	const { denoisedAudio } = await API.denoise(audioFilename, options)

	if (outputFilenames.length > 0) {
		logger.start('\nWrite output files')
	}

	for (const outputFilename of outputFilenames) {
		const fileSaver = getFileSaver(outputFilename, allowOverwrite)

		await fileSaver(denoisedAudio, [], '')
	}

	logger.end()

	if (cliOptions.play) {
		await playAudioSamplesWithKeyboardControls(denoisedAudio, cliOptions.player)
	}
}

export async function isolate(operationData: CLIOperationData) {
	const logger = new Logger()

	const { operationArgs, operationOptionsLookup, cliOptions } = operationData

	const audioFilename = operationArgs[0]
	const outputFilenames = operationArgs.slice(1)

	if (audioFilename == undefined) {
		throw new Error(`'isolate' requires an argument containing the audio file path.`)
	}

	if (!existsSync(audioFilename)) {
		throw new Error(`The given source audio file '${audioFilename}' was not found.`)
	}

	if (cliOptions.play == null) {
		cliOptions.play = outputFilenames.length === 0
	}

	const options = await optionsLookupToTypedObject(operationOptionsLookup, 'SourceSeparationOptions')

	const allowOverwrite = getWithDefault(cliOptions.overwrite, overwriteByDefault)

	await checkOutputFilenames(outputFilenames, true, false, false)

	const { inputRawAudio, isolatedRawAudio, backgroundRawAudio } = await API.isolate(audioFilename, options)

	if (outputFilenames.length > 0) {
		logger.start('\nWrite output files')
	}

	for (let outputFilename of outputFilenames) {
		await writeSourceSeparationOutputIfNeeded(outputFilename, isolatedRawAudio, backgroundRawAudio, allowOverwrite, false)
	}

	logger.end()

	if (cliOptions.play) {
		await playAudioSamplesWithKeyboardControls(isolatedRawAudio, cliOptions.player)
	}
}

export async function listEngines(operationData: CLIOperationData) {
	const logger = new Logger()

	const { operationArgs } = operationData

	const targetOperation = operationArgs[0]

	if (!targetOperation) {
		throw new Error(`The 'list-engines' operation requires an argument specifying the operation to list engines for, like 'echogarden list-engines transcribe'.`)
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

		case 'list-voices': {
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

		case 'align-translation': {
			engines = API.translationAlignmentEngines

			break
		}

		case 'translate-text': {
			engines = API.textTranslationEngines

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

		case 'isolate': {
			engines = API.sourceSeparationEngines

			break
		}

		case 'list-engines':
		case 'install':
		case 'uninstall':
		case 'list-packages': {
			throw new Error(`The operation '${targetOperation}' is not associated with a list of engines.`)
		}

		default: {
			throw new Error(`Unrecognized operation name: '${targetOperation}'`)
		}
	}

	for (const [index, engine] of engines.entries()) {
		logger.logTitledMessage('Identifier', chalk.magentaBright(engine.id), undefined, 'output')
		logger.logTitledMessage('Name', engine.name, undefined, 'output')
		logger.logTitledMessage('Description', engine.description, undefined, 'output')
		logger.logTitledMessage('Type', engine.type, undefined, 'output')

		if (index < engines.length - 1) {
			logger.log('', 'output')
		}
	}
}

export async function listTTSVoices(operationData: CLIOperationData) {
	const logger = new Logger()

	const { operationArgs, operationOptionsLookup, cliOptions } = operationData

	const targetEngine = operationArgs[0]
	const outputFilenames = operationArgs.slice(1)

	if (!targetEngine) {
		const optionsSchema = await getOptionsSchema()
		const { enum: ttsEnginesEnum } = getOptionTypeFromSchema(['VoiceListRequestOptions', 'engine'], optionsSchema)

		throw new Error(`list-voices requires an argument specifying one of these supported engines:\n${ttsEnginesEnum!.join(', ')}`)
	}

	const additionalOptionsSchema = new Map<string, SchemaTypeDefinition>()
	additionalOptionsSchema.set('overwrite', { type: 'boolean' })

	operationOptionsLookup.set('engine', targetEngine)

	const options = await optionsLookupToTypedObject(operationOptionsLookup, 'VoiceListRequestOptions')

	const allowOverwrite = getWithDefault(cliOptions.overwrite, overwriteByDefault)

	await checkOutputFilenames(outputFilenames, false, true, false)

	const { voiceList } = await API.requestVoiceList(options)

	const voiceListText = voiceList.map(entry => {
		const nameText = entry.name
		const languagesNamesText = entry.languages.map(language => formatLanguageCodeWithName(language)).join(', ')
		const genderText = entry.gender

		let entryText = `${chalk.cyanBright('Identifier')}: ${chalk.magentaBright(nameText)}\n${chalk.cyanBright('Languages')}: ${languagesNamesText}\n${chalk.cyanBright('Gender')}: ${genderText}`

		const speakerCount = entry.speakerCount

		if (speakerCount) {
			entryText += `\n${chalk.cyanBright('Speaker count')}: ${speakerCount}`
		}

		return entryText
	}).join('\n\n')

	if (outputFilenames.length > 0) {
		logger.start('\nWrite output files')

		for (const filename of outputFilenames) {
			const fileSaver = getFileSaver(filename, allowOverwrite)

			const { default: stripAnsi } = await import('strip-ansi')
			const voiceListTextWithoutColors = stripAnsi(voiceListText)

			await fileSaver(getEmptyRawAudio(0, 0), voiceList as any, voiceListTextWithoutColors)
		}
	} else {
		logger.log(voiceListText, 'output')
	}

	logger.end()
}

export async function installPackages(operationData: CLIOperationData) {
	const logger = new Logger()

	const { operationArgs } = operationData

	if (operationArgs.length == 0) {
		throw new Error('No package names specified')
	}

	const failedPackageNames: string[] = []

	for (const packageName of operationArgs) {
		try {
			await loadPackage(packageName)
		} catch (e) {
			resetActiveLogger()

			logger.logTitledMessage(`Failed installing package ${packageName}`, e, chalk.redBright, 'error')
			failedPackageNames.push(packageName)
		}
	}

	if (failedPackageNames.length > 0) {
		if (failedPackageNames.length == 1) {
			logger.log(`The package ${failedPackageNames[0]} failed to install`, 'error')
		} else {
			logger.log(`The packages ${failedPackageNames.join(', ')} failed to install`, 'error')
		}
	}
}

export async function uninstallPackages(operationData: CLIOperationData) {
	const logger = new Logger()

	const { operationArgs } = operationData

	if (operationArgs.length == 0) {
		throw new Error('No package names specified')
	}

	const failedPackageNames: string[] = []

	for (const packageName of operationArgs) {
		try {
			await removePackage(packageName)
		} catch (e) {
			resetActiveLogger()

			logger.logTitledMessage(`Failed uninstalling package ${packageName}`, e, chalk.redBright, 'error')
			failedPackageNames.push(packageName)
		}
	}

	if (failedPackageNames.length > 0) {
		logger.log(`The packages ${failedPackageNames.join(', ')} failed to uninstall`, 'error')
	}
}

export async function listPackages(operationData: CLIOperationData) {
	const logger = new Logger()

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

	logger.log(`Total of ${installedPackageNamesFormatted.length} packages installed in '${packagesDir}'`)
	logger.log(``)
	logger.log(installedPackageNamesFormatted.join('\n'))
}

export async function serve(operationData: CLIOperationData) {
	const { operationOptionsLookup } = operationData

	const options = await optionsLookupToTypedObject(operationOptionsLookup, 'ServerOptions')

	async function onServerStarted(serverOptions: ServerOptions) {
		// Run a test routine (early development)
		//await runClientWebSocketTest(serverOptions.port!, serverOptions.secure!)
	}

	await startServer(options, onServerStarted)
}

async function writeSourceSeparationOutputIfNeeded(outputFilename: string, isolatedRawAudio: RawAudio | undefined, backgroundRawAudio: RawAudio | undefined, allowOverwrite: boolean, prefixIsolated: boolean) {
	// Write source separation output if needed
	const fileExtension = getLowercaseFileExtension(outputFilename)

	if (isolatedRawAudio && backgroundRawAudio && supportedOutputMediaFileExtensions.includes(fileExtension)) {
		const pathWithoutExtension = outputFilename.substring(0, outputFilename.lastIndexOf('.'))

		{
			const isolatedOutputFilePath = prefixIsolated ? `${pathWithoutExtension}.isolated.${fileExtension}` : outputFilename

			const fileSaver = getFileSaver(isolatedOutputFilePath, allowOverwrite)

			await fileSaver(isolatedRawAudio, [], '')
		}

		{
			const backgroundOutputFilePath = `${pathWithoutExtension}.background.${fileExtension}`

			const fileSaver = getFileSaver(backgroundOutputFilePath, allowOverwrite)

			await fileSaver(backgroundRawAudio, [], '')
		}
	}
}

async function optionsLookupToTypedObject<K extends keyof APIOptions>(cliOptionsMap: Map<string, string>, optionsRoot: K, additionalOptionsSchema?: Map<string, SchemaTypeDefinition>): Promise<APIOptions[K]> {
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

		if (key.startsWith('no-')) {
			isNegated = true
			key = key.slice(3)

			if (value) {
				throw new Error(`The negated property '${key}' cannot have a value.`)
			}
		}

		const path = key.split('.')

		let optionType: string | undefined
		let optionEnum: any[] | undefined
		let optionIsUnion: boolean | undefined

		if (additionalOptionsSchema && additionalOptionsSchema.has(key)) {
			({ type: optionType, enum: optionEnum, isUnion: optionIsUnion } = additionalOptionsSchema.get(key)!)
		} else {
			const extendedPath = [optionsRoot, ...path];
			({ type: optionType, enum: optionEnum, isUnion: optionIsUnion } = getOptionTypeFromSchema(extendedPath, optionsSchema))
		}

		let parsedValue: any

		if (optionType == 'string') {
			parsedValue = value
		} else if (optionType == 'number') {
			parsedValue = parseFloat(value)

			if (isNaN(parsedValue)) {
				throw new Error(`The property '${key}' is a number. '${value}' cannot be parsed as a number.`)
			}
		} else if (optionType == 'boolean') {
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
		} else if (optionType == 'array' || optionType == 'object') {
			try {
				parsedValue = await parseJson(value, true)
			} catch (e) {
				parsedValue = value
			}
		} else if (optionIsUnion) {
			const { parsedValue: json5ParsedValue, jsonType } = await parseJSONAndGetType(value, true)

			if (jsonType === 'number' || jsonType === 'boolean' || jsonType === 'array' || jsonType === 'object') {
				parsedValue = json5ParsedValue
			} else {
				parsedValue = value
			}
		} else {
			parsedValue = value
		}

		if (optionEnum && !optionEnum.includes(parsedValue)) {
			throw new Error(`The property '${key}' must be one of ${optionEnum.join(', ')}`)
		}

		setValueAtPath(path, parsedValue)
	}

	return resultingObj
}

let cachedOptionsSchema: any
async function getOptionsSchema() {
	if (!cachedOptionsSchema) {
		cachedOptionsSchema = await readAndParseJsonFile(resolveToModuleRootDir('data/schemas/options.json'))
	}

	return cachedOptionsSchema
}

async function checkOutputFilenames(outputFilenames: string[], acceptMediaOutputs: boolean, acceptMetadataOutputs: boolean, acceptSubtitleOutputs: boolean) {
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

	let includesPlaceholderPattern = false

	for (const outputFilename of outputFilenames) {
		const fileExtension = getLowercaseFileExtension(outputFilename)

		if (!supportedFileExtensions.includes(fileExtension)) {
			let errorText = ''
			errorText += `\nThe specified output path '${outputFilename}' doesn't have a supported file extension.\n`
			errorText += `\nSupported extensions are:\n`

			if (acceptMediaOutputs) {
				errorText += `${formatListWithQuotedElements(supportedOutputMediaFileExtensions)} for audio output files.\n`
			}

			if (acceptMetadataOutputs) {
				errorText += `${formatListWithQuotedElements(supportedMetadataFileExtensions)} for metadata output files.\n`
			}

			if (acceptSubtitleOutputs) {
				errorText += `${formatListWithQuotedElements(supportedSubtitleFileExtensions)} for subtitle output files.\n`
			}

			throw new Error(errorText)
		}

		const placeholderPatternMatch = outputFilename.match(filenamePlaceholderPattern)

		if (placeholderPatternMatch) {
			if (placeholderPatternMatch[1] != 'segment') {
				throw new Error(`Invalid placeholder pattern: '${placeholderPatternMatch[1]}'. Placeholder output filename pattern currently only supports 'segment'. For example: '/out/[segment].wav'`)
			}

			includesPlaceholderPattern = true
		}
	}

	return { includesPlaceholderPattern }
}

async function writeOutputFilesForSegment(outputFilenames: string[], index: number, total: number, audio: RawAudio, timeline: Timeline, text: string, language: string, allowOverwrite: boolean) {
	const digitCount = Math.max((total + 1).toString().length, 2)

	const segmentWords = (await splitToWords(text, language)).filter(text => wordCharacterPattern.test(text))

	const segmentJoinedWords = segmentWords.join(' ').trim()

	let initialText: string

	const maxLength = 50

	if (segmentJoinedWords.length < maxLength) {
		initialText = segmentJoinedWords.substring(0, maxLength).trim()
	} else {
		initialText = segmentJoinedWords.substring(0, maxLength - 4).trim() + '.. '
	}

	for (const outputFilename of outputFilenames) {
		const placeholderPatternMatch = outputFilename.match(filenamePlaceholderPattern)

		if (!placeholderPatternMatch) {
			continue
		}

		const segmentFilename = outputFilename.replace(filenamePlaceholderPattern, `${formatIntegerWithLeadingZeros(index + 1, digitCount)} - ${initialText}.$2`)

		const fileSaver = getFileSaver(segmentFilename, allowOverwrite)
		await fileSaver(audio, timeline, text)
	}
}

type FileSaver = (audio: RawAudio, timeline: Timeline, text: string, subtitlesConfig?: SubtitlesConfig) => Promise<void>

function getFileSaver(outputFilePath: string, allowOverwrite: boolean): FileSaver {
	const parsedPath = parsePath(outputFilePath)

	const fileDir = parsedPath.dir || './'

	if (!allowOverwrite) {
		const filenameParts = splitFilenameOnExtendedExtension(parsedPath.base)

		for (let i = 1; existsSync(outputFilePath); i++) {
			outputFilePath = joinPath(parsedPath.dir, `${filenameParts[0]}_${formatIntegerWithLeadingZeros(i, 3)}`)

			if (filenameParts[1]) {
				outputFilePath += `.${filenameParts[1]}`
			}
		}
	}

	const fileExtension = getLowercaseFileExtension(outputFilePath)

	let fileSaver: FileSaver

	if (fileExtension == 'txt') {
		fileSaver = async (audio, timeline, text) => {
			await ensureDir(fileDir)
			return writeFileSafe(outputFilePath, text)
		}
	} else if (fileExtension == 'json') {
		fileSaver = async (audio, timeline, text) => {
			await ensureDir(fileDir)

			const roundedTimeline = roundTimelineProperties(timeline)
			return writeFileSafe(outputFilePath, await stringifyAndFormatJson(roundedTimeline))
		}
	} else if (fileExtension == 'srt') {
		fileSaver = async (audio, timeline, text, subtitlesConfig) => {
			await ensureDir(fileDir)

			const extraSubtitleConfigOptions: SubtitlesConfig = {
				format: 'srt',
				originalText: text,
				totalDuration: getRawAudioDuration(audio)
			}

			subtitlesConfig = extendDeep(subtitlesConfig, extraSubtitleConfigOptions)

			const subtitles = timelineToSubtitles(timeline, subtitlesConfig)

			return writeFileSafe(outputFilePath, subtitles)
		}
	} else if (fileExtension == 'vtt') {
		fileSaver = async (audio, timeline, text, subtitlesConfig) => {
			await ensureDir(fileDir)

			const extraSubtitleConfigOptions: SubtitlesConfig = {
				format: 'webvtt',
				originalText: text,
				totalDuration: getRawAudioDuration(audio)
			}

			subtitlesConfig = extendDeep(subtitlesConfig, extraSubtitleConfigOptions)

			const subtitles = timelineToSubtitles(timeline, subtitlesConfig)

			return writeFileSafe(outputFilePath, subtitles)
		}
	} else if (fileExtension == 'wav') {
		fileSaver = async (audio) => {
			await ensureDir(fileDir)

			return writeFileSafe(outputFilePath, encodeRawAudioToWave(audio))
		}
	} else if (supportedOutputMediaFileExtensions.includes(fileExtension)) {
		fileSaver = async (audio) => {
			const ffmpegOptions = getDefaultFFMpegOptionsForSpeech(fileExtension)

			ffmpegOptions.filename = outputFilePath

			await ensureDir(fileDir)

			await encodeFromChannels(audio, ffmpegOptions)

			return
		}
	} else {
		throw new Error('Unsupported output file extension')
	}

	return fileSaver
}

const supportedMetadataFileExtensions = ['txt', 'json']
const supportedSubtitleFileExtensions = ['srt', 'vtt']
const supportedOutputMediaFileExtensions = ['wav', 'mp3', 'opus', 'm4a', 'ogg', 'flac']

const filenamePlaceholderPattern = /\[(.*)\]\.(.*)$/

const overwriteByDefault = false

startIfInWorkerThread()
