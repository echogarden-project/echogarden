import { spawn } from 'node:child_process'
import { RawAudio, encodeRawAudioToWave, getRawAudioDuration } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'
import { type WhisperTask, type WhisperModelName } from './WhisperSTT.js'
import { getRandomHexString, writeToStdinInChunks, writeToStderr } from '../utilities/Utilities.js'
import { Timeline, TimelineEntryType } from '../utilities/Timeline.js'
import { tryParseTimeRangePatternWithHours } from '../subtitles/Subtitles.js'
import { getAppTempDir } from '../utilities/PathUtilities.js'
import { appName } from '../api/Common.js'
import path from 'node:path'
import { readAndParseJsonFile, remove } from '../utilities/FileSystem.js'
import { isWordOrSymbolWord, splitToFragments, splitToLines } from '../nlp/Segmentation.js'
import { extendDeep } from '../utilities/ObjectUtilities.js'
import { getShortLanguageCode } from '../utilities/Locale.js'
import { loadPackage } from '../utilities/PackageManager.js'

export async function recognize(
	sourceRawAudio: RawAudio,
	task: WhisperTask,
	sourceLanguage: string | undefined,
	executablePath: string,
	modelName: WhisperModelName,
	modelPath: string,
	options: WhisperCppOptions) {

	if (sourceRawAudio.sampleRate != 16000) {
		throw new Error('Source audio must have a sample rate of 16000 Hz')
	}

	options = extendDeep(defaultWhisperCppOptions, options)

	return new Promise<RecognitionResult>(async (resolve, reject) => {
		const logger = new Logger()

		logger.start(`Recognize with command-line whisper.cpp (model: '${options.model!}')`)
		logger.log('')
		logger.log('')

		const sourceAsWave = encodeRawAudioToWave(sourceRawAudio)

		const tempDirPath = getAppTempDir(appName)
		const outJsonFilePathWithoutExtension = path.join(tempDirPath, `${getRandomHexString(16)}`)
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
			`${options.coreCount!}`,

			'--best-of',
			`${options.topCandidateCount!}`,

			'--beam-size',
			`${options.beamCount!}`,

			'--entropy-thold',
			`${options.entropyThreshold!}`
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
				modelName.replaceAll('-', '.'),
			)
		} else {
			args.push(
				'--max-len',
				'0',
			)
		}

		if (task === 'translate') {
			args.push('--translate')
		}

		const argsString = args.join(' ')

		const process = spawn(executablePath, [...args, '-'])

		const stdoutLines: string[] = []
		let stderrOutput = ''

		process.stdout.setEncoding('utf8')
		process.stdout.on('data', (str: string) => {
			const parts = splitToLines(str)
				.map(line => line.trim())
				.filter(line => line.length > 0)

			logger.log(parts.join('\n'))

			stdoutLines.push(...parts)
		})

		process.stderr.setEncoding('utf8')
		process.stderr.on('data', (str: string) => {
			if (options.verbose) {
				logger.log(str)
			}

			stderrOutput += str
		})

		process.on('error', (e) => {
			reject(e)
		})

		process.on('close', async (exitCode) => {
			logger.end()

			if (exitCode === 0) {
				const parsedStdOut = parseStdOutLinesToTimeline(stdoutLines, 'word')

				const resultObject: WhisperCppVerboseResult = await readAndParseJsonFile(outJsonFilePath)
				await remove(outJsonFilePath)

				const parsedResultObject = await parseResultObject(resultObject, modelName, getRawAudioDuration(sourceRawAudio), options.enableDTW!)

				resolve(parsedResultObject)
			} else {
				reject(`whisper.cpp exited with code ${exitCode}`)

				logger.log(stderrOutput)
			}
		})

		//writeToStdinInChunks(process, sourceAsWave, 2 ** 10)
		process.stdin.end(sourceAsWave)
	})
}

async function parseResultObject(resultObject: WhisperCppVerboseResult, modelName: WhisperModelName, totalDuration: number, useDTWTimestamps: boolean): Promise<RecognitionResult> {
	const { Whisper } = await import('../recognition/WhisperSTT.js')

	const whisper = new Whisper(modelName, '')
	await whisper.initializeTokenizerIfNeeded()

	const tokenTimeline: Timeline = []

	const tokens = resultObject.transcription
		.flatMap(partEntry => partEntry.tokens)

	for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
		const tokenEntry = tokens[tokenIndex]

		const tokenId = tokenEntry.id
		const tokenText = whisper.tokenToText(tokenId)
		const tokenConfidence = tokenEntry.p

		let startTime: number
		let endTime: number

		if (useDTWTimestamps) {
			const nextTokenEntry = tokens[tokenIndex + 1]

			const tokenEntryDtwStartTime = tokenEntry.t_dtw / 100
			const nextTokenEntryDtwStartTime = nextTokenEntry ? nextTokenEntry.t_dtw / 100 : totalDuration

			startTime = Math.max(tokenEntryDtwStartTime, 0)
			endTime = nextTokenEntryDtwStartTime
		} else {
			startTime = tokenEntry.offsets.from / 1000
			endTime = tokenEntry.offsets.to / 1000
		}

		tokenTimeline.push({
			type: 'token',
			text: tokenText,
			id: tokenId,
			startTime,
			endTime,
			confidence: tokenConfidence
		})
	}

	const allTokenIds = tokenTimeline.map(entry => entry.id!)
	const transcript = whisper.tokensToText(allTokenIds).trim()

	let timeline = whisper.tokenTimelineToWordTimeline(tokenTimeline)

	return {
		transcript,
		timeline,
		language: resultObject.result.language
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

export async function loadPackagesAndGetPaths(modelId: WhisperCppModelId | undefined, languageCode: string | undefined) {
	if (modelId === 'large') {
		modelId = 'large-v2'
	}

	if (modelId) {
		const modelName = getModelNameFromModelId(modelId)

		if (languageCode != 'en' && modelName.endsWith('.en')) {
			throw new Error(`The English-only model '${modelName}' cannot be used with a non-English language '${languageCode}'.`)
		}
	} else {
		if (languageCode) {
			const shortLanguageCode = getShortLanguageCode(languageCode)

			modelId = shortLanguageCode == 'en' ? 'base.en' : 'base'
		} else {
			modelId = 'base'
		}
	}

	const packageName = `whisper.cpp-${modelId}`
	const modelDir = await loadPackage(packageName)
	const modelPath = path.join(modelDir, `ggml-${modelId}.bin`)
	const modelName = getModelNameFromModelId(modelId)

	return { modelName, modelPath }
}

export async function loadPackageAndGetExecutablePath(customPath: string | undefined) {
	if (customPath) {
		return customPath
	}

	const platform = process.platform
	const arch = process.arch

	let packageName: string

	if (platform === 'win32' && arch === 'x64') {
		packageName = `whisper.cpp-binaries-windows-x64-cpu-latest-patched`
	} else if (platform === 'linux' && arch === 'x64') {
		packageName = `whisper.cpp-binaries-linux-x64-cpu-latest-patched`
	} else {
		throw new Error(`Couldn't find a matching whisper.cpp binary package. Please specify a custom path to the binary in the 'executablePath' option.`)
	}

	const ffmpegPackagePath = await loadPackage(packageName)

	let filename = 'main'

	if (platform === 'win32') {
		filename += '.exe'
	}

	return path.join(ffmpegPackagePath, filename)
}

function getModelNameFromModelId(modelId: WhisperCppModelId): WhisperModelName {
	let lastDashIndex = modelId.lastIndexOf('-')

	if (modelId.startsWith('large-v') && lastDashIndex === 5) {
		lastDashIndex = -1
	}

	let modelName: string

	if (lastDashIndex >= 0) {
		modelName = modelId.substring(0, lastDashIndex) as WhisperModelName
	} else {
		modelName = modelId
	}

	return modelName as WhisperModelName
}

export interface WhisperCppVerboseResult {
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

export interface WhisperCppOptions {
	executablePath?: string
	model?: WhisperCppModelId

	threadCount?: number,
	coreCount?: number,
	enableGPU?: boolean

	topCandidateCount?: number
	beamCount?: number
	entropyThreshold?: number

	prompt?: string

	enableDTW?: boolean

	verbose?: boolean
}

export const defaultWhisperCppOptions: WhisperCppOptions = {
	model: undefined,
	executablePath: undefined,

	threadCount: 4,
	coreCount: 1,
	enableGPU: false,

	topCandidateCount: 5,
	beamCount: 5,
	entropyThreshold: 2.4,

	prompt: undefined,

	enableDTW: false,

	verbose: false,
}

export type WhisperCppModelId =
	'tiny' |
	'tiny-q5_1' |
	'tiny.en' |
	'tiny.en-q5_1' |
	'tiny.en-q8_0' |
	'base' |
	'base-q5_1' |
	'base.en' |
	'base.en-q5_1' |
	'small' |
	'small-q5_1' |
	'small.en' |
	'small.en-q5_1' |
	'medium' |
	'medium-q5_0' |
	'medium.en' |
	'medium.en-q5_0' |
	'large' |
	'large-v1' |
	'large-v2' |
	'large-v2-q5_0' |
	'large-v3' |
	'large-v3-q5_0'
