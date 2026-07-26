import { spawn } from 'node:child_process'
import { RawAudio, encodeRawAudioToWave, getRawAudioDuration } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'
import { type WhisperTask, type WhisperModelId, type WhisperQuantizedModelId } from './WhisperCommon.js'
import { getRandomHexString } from '../utilities/Utilities.js'
import { Timeline, TimelineEntryType } from '../utilities/Timeline.js'
import { tryParseTimeRangePatternWithHours } from '../subtitles/Subtitles.js'
import { getAppTempDir, joinPath } from '../utilities/PathUtilities.js'
import { appName, OperationCallbacks } from '../api/Common.js'
import { readAndParseJsonFile, remove } from '../utilities/FileSystem.js'
import { splitToLines } from '../nlp/Segmentation.js'
import { extendDeep } from '../utilities/ObjectUtilities.js'
import { formatLanguageCodeWithName, getShortLanguageCode } from '../utilities/Locale.js'
import { loadPackage, LoadPackageCallbacks } from '../utilities/PackageManager.js'
import { detectSpeechLanguageByParts, SpeechLanguageDetectionCallbacks } from '../api/SpeechLanguageDetection.js'
import { RecognitionCallbacks } from '../api/Recognition.js'

export async function recognize(
	sourceRawAudio: RawAudio,
	task: WhisperTask,
	sourceLanguage: string | undefined,
	modelId: WhisperModelId,
	modelPath: string,
	options: WhisperCppCliOptions,
	callbacks: RecognitionCallbacks) {

	return new Promise<RecognitionResult>(async (resolve, reject) => {
		const logger = new Logger(callbacks.logLevel)

		if (sourceRawAudio.sampleRate != 16000) {
			throw new Error('Source audio must have a sample rate of 16000 Hz')
		}

		options = extendDeep(defaultWhisperCppCliOptions, options)

		let buildKind: WhisperCppCliBuild
		let executablePath: string

		if (options.executablePath) {
			buildKind = 'custom'

			executablePath = options.executablePath

			if (options.enableGPU == null) {
				options.enableGPU = true
			}
		} else {
			if (options.build) {
				buildKind = options.build

				if (options.enableGPU == null) {
					options.enableGPU = buildKind.startsWith('cublas-')
				} else if (process.platform !== 'darwin' && options.enableGPU === true && !buildKind.startsWith('cublas-')) {
					throw new Error('GPU support is only available for CUDA builds')
				}
			} else {
				if (process.platform !== 'darwin' && options.enableGPU) {
					buildKind = 'cublas-12.4.0'
				} else {
					buildKind = 'cpu'
				}
			}

			logger.end()

			executablePath = await loadBinariesPackage(buildKind, callbacks)
		}

		if (options.enableFlashAttention && options.enableDTW) {
			options.enableDTW = false
		}

		if (task === 'translate' && options.model!.startsWith('large-v3-turbo')) {
			throw new Error(`The 'large-v3-turbo' model doesn't support translation tasks.`)
		}

		logger.start(`Recognize with command-line whisper.cpp (model: ${options.model || modelId}, build: ${buildKind})`)
		logger.log('')
		logger.log('')

		const sourceAsWave = encodeRawAudioToWave(sourceRawAudio)

		const tempDirPath = getAppTempDir(appName)
		const outJsonFilePathWithoutExtension = joinPath(tempDirPath, `${getRandomHexString(16)}`)
		const outJsonFilePath = `${outJsonFilePathWithoutExtension}.json`

		const args: string[] = [
			'--output-json-full',

			'--output-file',
			outJsonFilePathWithoutExtension,

			'--model',
			modelPath,

			'--language',
			sourceLanguage || 'auto',

			'--threads',
			`${options.threadCount!}`,

			'--processors',
			`${options.splitCount!}`,

			'--best-of',
			`${options.topCandidateCount!}`,

			'--beam-size',
			`${options.beamCount!}`,

			'--entropy-thold',
			`${options.repetitionThreshold!}`,

			'--temperature',
			`${options.temperature!}`,

			'--temperature-inc',
			`${options.temperatureIncrement!}`,
		]

		if (options.prompt) {
			args.push(
				'--prompt',
				options.prompt,
			)
		}

		if (!options.enableGPU) {
			args.push(
				'--no-gpu'
			)
		}

		if (options.enableDTW) {
			args.push(
				'--max-len',
				'0',

				'--dtw',
				modelId.replaceAll('-', '.'),
			)
		} else {
			args.push(
				'--max-len',
				'0',
			)
		}

		if (options.enableFlashAttention) {
			args.push(
				'--flash-attn'
			)
		} else {
			args.push(
				'--no-flash-attn'
			)
		}

		if (task === 'translate') {
			args.push('--translate')
		} else if (task === 'detect-language') {
			args.push('--detect-language')
		}

		const argsString = args.join(' ')

		const cliProcess = spawn(executablePath, [...args, '-'])

		callbacks.abortSignal?.addEventListener('abort', () => {
			reject(new DOMException('whisper.cpp CLI process aborted by user.', 'AbortError'))
			cliProcess.kill()
		})

		const stdoutLines: string[] = []
		let stderrOutput = ''

		cliProcess.stdout.setEncoding('utf8')
		cliProcess.stdout.on('data', (str: string) => {
			if (task === 'detect-language') {
				return
			}

			const parts = splitToLines(str)
				.map(line => line.trim())
				.filter(line => line.length > 0)

			logger.log(parts.join('\n'))

			stdoutLines.push(...parts)
		})

		cliProcess.stderr.setEncoding('utf8')
		cliProcess.stderr.on('data', (str: string) => {
			if (options.verbose) {
				logger.log(str)
			}

			stderrOutput += str
		})

		cliProcess.on('error', (e) => {
			reject(e)
		})

		cliProcess.on('close', async (exitCode) => {
			logger.end()

			if (exitCode === 0) {
				const parsedStdOut = parseStdOutLinesToTimeline(stdoutLines, 'word')

				const resultObject: WhisperCppCliVerboseResult = await readAndParseJsonFile(outJsonFilePath)
				await remove(outJsonFilePath)

				if (task === 'detect-language') {
					resolve({ timeline: [], transcript: '', language: resultObject.result.language })
				} else {
					const parsedResultObject = await parseResultObject(resultObject, modelId, getRawAudioDuration(sourceRawAudio), options.enableDTW!, callbacks)

					resolve(parsedResultObject)
				}
			} else {
				reject(`whisper.cpp exited with code ${exitCode}`)

				logger.log(stderrOutput)
			}
		})

		//writeToStdinInChunks(cliProcess, sourceAsWave, 2 ** 10)
		cliProcess.stdin.end(sourceAsWave)
	})
}

export async function detectLanguage(sourceRawAudio: RawAudio, modelId: WhisperModelId, modelPath: string, callbacks: SpeechLanguageDetectionCallbacks) {
	if (sourceRawAudio.sampleRate != 16000) {
		throw new Error('Source audio must have a sample rate of 16000')
	}

	async function detectLanguageForPart(partAudio: RawAudio) {
		const { language } = await recognize(
			partAudio,
			'detect-language',
			undefined,
			modelId,
			modelPath,
			{},
			{ abortSignal: callbacks.abortSignal, logLevel: callbacks.logLevel }
		)

		const partResults = [{
			language: language!,
			languageName: formatLanguageCodeWithName(language!),
			probability: 1.0,
		}]

		return partResults
	}

	const results = await detectSpeechLanguageByParts(
		sourceRawAudio,
		detectLanguageForPart,
		undefined,
		undefined,
		callbacks,
	)

	results.sort((entry1, entry2) => entry2.probability - entry1.probability)

	return results
}

async function parseResultObject(resultObject: WhisperCppCliVerboseResult, modelId: WhisperModelId, totalDuration: number, enableDTW: boolean, callbacks: OperationCallbacks): Promise<RecognitionResult> {
	const { Whisper } = await import('./WhisperSTT.js')

	const whisper = new Whisper(modelId, '', '')
	await whisper.initializeTokenizerIfNeeded(callbacks)

	const tokenTimeline: Timeline = []

	let currentCorrectionTimeOffset = 0

	let lastTokenEndOffset = 0

	for (let segmentIndex = 0; segmentIndex < resultObject.transcription.length; segmentIndex++) {
		const segmentObject = resultObject.transcription[segmentIndex]

		const tokens = segmentObject.tokens

		for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
			const tokenObject = tokens[tokenIndex]

			// Workaround whisper.cpp issue with missing offsets by falling back to last known end offset
			// when they are not included
			if (!tokenObject.offsets) {
				tokenObject.offsets = {
					from: lastTokenEndOffset,
					to: lastTokenEndOffset,
				}
			} else {
				lastTokenEndOffset = tokenObject.offsets.to
			}

			if (tokenIndex === 0 && tokenObject.text === '[_BEG_]' && tokenObject.offsets.from === 0) {
				currentCorrectionTimeOffset = segmentObject.offsets.from / 1000
			}

			const tokenId = tokenObject.id
			const tokenText = whisper.tokenToText(tokenId, true)
			const tokenConfidence = tokenObject.p

			let startTime: number
			let endTime: number

			if (enableDTW) {
				const nextTokenEntry = tokens[tokenIndex + 1]

				const tokenEntryDtwStartTime = tokenObject.t_dtw / 100
				const nextTokenEntryDtwStartTime = nextTokenEntry ? nextTokenEntry.t_dtw / 100 : totalDuration

				startTime = Math.max(tokenEntryDtwStartTime, 0)
				endTime = nextTokenEntryDtwStartTime
			} else {
				startTime = tokenObject.offsets.from / 1000
				endTime = tokenObject.offsets.to / 1000
			}

			startTime += currentCorrectionTimeOffset
			endTime += currentCorrectionTimeOffset

			tokenTimeline.push({
				type: 'token',
				text: tokenText,
				id: tokenId,
				startTime,
				endTime,
				confidence: tokenConfidence
			})
		}
	}

	const allTokenIds = tokenTimeline.map(entry => entry.id!)
	const transcript = whisper.tokensToText(allTokenIds).trim()
	const language = resultObject.result.language

	const timeline = whisper.tokenTimelineToWordTimeline(tokenTimeline, language)

	return {
		transcript,
		timeline,
		language
	}
}

function parseStdOutLinesToTimeline(lines: string[], entryType: TimelineEntryType): RecognitionResult {
	let transcript = ''
	const timeline: Timeline = []

	for (const line of lines) {
		const openingSquareBracketIndex = line.indexOf('[')
		const closingSquareBracketIndex = line.indexOf(']', openingSquareBracketIndex + 1)

		const timeRangeString = line.substring(openingSquareBracketIndex + 1, closingSquareBracketIndex)

		const { startTime, endTime, succeeded } = tryParseTimeRangePatternWithHours(timeRangeString)

		if (!succeeded) {
			continue
		}

		const text = line.substring(closingSquareBracketIndex + 1 + 2)

		if (text.length === 0) {
			continue
		}

		transcript += text

		if (timeline.length === 0 || text.startsWith(' ')) {
			timeline.push({
				type: entryType,
				text: text.trim(),
				startTime: startTime,
				endTime: endTime,
			})
		} else {
			const previousEntry = timeline[timeline.length - 1]

			previousEntry.text += text
			previousEntry.endTime = endTime
		}
	}

	return { transcript, timeline }
}

export type WhisperCppCliBuild = 'cpu' | 'cublas-12.4.0' | 'custom'

export async function loadBinariesPackage(buildKind: WhisperCppCliBuild, callbacks: LoadPackageCallbacks) {
	if (buildKind === 'custom') {
		throw new Error(`A 'custom' build kind requires providing a custom path to the 'whisper-cli' executable in the 'executablePath' option.`)
	}

	const platform = process.platform
	const arch = process.arch

	let packageName: string

	if (buildKind.startsWith('cublas-')) {
		if (platform === 'win32' && arch === 'x64') {
			packageName = `whisper.cpp-binaries-windows-x64-${buildKind}`
		} else if (platform === 'linux' && arch === 'x64') {
			packageName = `whisper.cpp-binaries-linux-x64-${buildKind}`
		} else {
			throw new Error(`whisper.cpp GPU builds (NVIDIA CUDA only) are currently only available as packages for Windows x64 and Linux x64. Please specify a custom path to a whisper.cpp 'main' binary in the 'executablePath' option.`)
		}
	} else if (buildKind === 'cpu') {
		if (platform === 'win32' && arch === 'x64') {
			packageName = `whisper.cpp-binaries-windows-x64-cpu`
		} else if (platform === 'win32' && arch === 'arm64') {
			packageName = `whisper.cpp-binaries-windows-arm64-cpu`
		} else if (platform === 'darwin' && arch === 'x64') {
			packageName = `whisper.cpp-binaries-macos-universal`
		} else if (platform === 'darwin' && arch === 'arm64') {
			packageName = `whisper.cpp-binaries-macos-universal`
		} else if (platform === 'linux' && arch === 'x64') {
			packageName = `whisper.cpp-binaries-linux-x64-cpu`
		} else if (platform === 'linux' && arch === 'arm64') {
			packageName = `whisper.cpp-binaries-linux-arm64-cpu`
		} else {
			throw new Error(`Couldn't find a matching whisper.cpp binary package. Please specify a custom path to a whisper.cpp 'main' binary in the 'executablePath' option.`)
		}
	} else {
		throw new Error(`Unsupported build kind '${buildKind}'`)
	}

	const packagePath = await loadPackage(packageName, callbacks)

	let filename = 'whisper-cli'

	if (platform === 'win32') {
		filename += '.exe'
	}

	return joinPath(packagePath, filename)
}

export interface WhisperCppCliVerboseResult {
	model: {
		type: string
		multilingual: boolean

		ftype: number
		mels: number
		vocab: number

		text: {
			ctx: number
			state: number
			head: number
			layer: number
		}

		audio: {
			ctx: number
			state: number
			head: number
			layer: number
		}
	}

	params: {
		language: string
		model: string
		translate: boolean
	}

	result: {
		language: string
	}

	systeminfo: string

	transcription: {
		text: string
		timestamps: { from: string, to: string }
		offsets: { from: number, to: number }

		tokens: {
			text: string
			timestamps: { from: string, to: string }
			offsets: { from: number, to: number }

			t_dtw: number
			p: number
			id: number
		}[]
	}[]
}

interface RecognitionResult {
	transcript: string
	timeline: Timeline
	language?: string
}

export interface WhisperCppCliOptions {
	build?: WhisperCppCliBuild
	executablePath?: string

	model?: WhisperQuantizedModelId

	enableGPU?: boolean
	threadCount?: number,
	splitCount?: number,

	topCandidateCount?: number
	beamCount?: number
	repetitionThreshold?: number
	temperature?: number
	temperatureIncrement?: number

	prompt?: string

	enableDTW?: boolean
	enableFlashAttention?: boolean

	verbose?: boolean
}

export const defaultWhisperCppCliOptions: WhisperCppCliOptions = {
	build: undefined,
	executablePath: undefined,

	model: undefined,

	enableGPU: undefined,
	threadCount: 4,
	splitCount: 1,

	topCandidateCount: 5,
	beamCount: 5,
	repetitionThreshold: 2.4,

	temperature: 0,
	temperatureIncrement: 0.2,

	prompt: undefined,

	enableDTW: false,
	enableFlashAttention: false,

	verbose: false,
}
