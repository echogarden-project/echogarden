import { spawn } from 'node:child_process'
import { RawAudio, encodeRawAudioToWave, getRawAudioDuration } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'
import { type WhisperTask, type WhisperModelName } from './WhisperSTT.js'
import { getRandomHexString } from '../utilities/Utilities.js'
import { Timeline, TimelineEntryType } from '../utilities/Timeline.js'
import { tryParseTimeRangePatternWithHours } from '../subtitles/Subtitles.js'
import { getAppTempDir, joinPath } from '../utilities/PathUtilities.js'
import { appName } from '../api/Common.js'
import { readAndParseJsonFile, remove } from '../utilities/FileSystem.js'
import { splitToLines } from '../nlp/Segmentation.js'
import { extendDeep } from '../utilities/ObjectUtilities.js'
import { formatLanguageCodeWithName, getShortLanguageCode } from '../utilities/Locale.js'
import { loadPackage } from '../utilities/PackageManager.js'
import { detectSpeechLanguageByParts } from '../api/SpeechLanguageDetection.js'

export async function recognize(
	sourceRawAudio: RawAudio,
	task: WhisperTask,
	sourceLanguage: string | undefined,
	modelName: WhisperModelName,
	modelPath: string,
	options: WhisperCppOptions) {

	return new Promise<RecognitionResult>(async (resolve, reject) => {
		const logger = new Logger()

		if (sourceRawAudio.sampleRate != 16000) {
			throw new Error('Source audio must have a sample rate of 16000 Hz')
		}

		options = extendDeep(defaultWhisperCppOptions, options)

		let buildKind: WhisperCppBuild
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
				} else if (options.enableGPU === true && !buildKind.startsWith('cublas-')) {
					throw new Error('GPU support is only available for CUDA builds')
				}
			} else {
				if (options.enableGPU) {
					buildKind = 'cublas-12.4.0'
				} else {
					buildKind = 'cpu'
				}
			}

			executablePath = await loadExecutablePackage(buildKind)
		}

		if (options.enableFlashAttention && options.enableDTW) {
			options.enableDTW = false
		}

		if (task === 'translate' && options.model!.startsWith('large-v3-turbo')) {
			throw new Error(`The 'large-v3-turbo' model doesn't support translation tasks.`)
		}

		logger.start(`Recognize with command-line whisper.cpp (model: ${options.model || modelName}, build: ${buildKind})`)
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
				modelName.replaceAll('-', '.'),
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
		}

		if (task === 'translate') {
			args.push('--translate')
		} else if (task === 'detect-language') {
			args.push('--detect-language')
		}

		const argsString = args.join(' ')

		const process = spawn(executablePath, [...args, '-'])

		const stdoutLines: string[] = []
		let stderrOutput = ''

		process.stdout.setEncoding('utf8')
		process.stdout.on('data', (str: string) => {
			if (task === 'detect-language') {
				return
			}

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

				if (task === 'detect-language') {
					resolve({ timeline: [], transcript: '', language: resultObject.result.language })
				} else {
					const parsedResultObject = await parseResultObject(resultObject, modelName, getRawAudioDuration(sourceRawAudio), options.enableDTW!)

					resolve(parsedResultObject)
				}
			} else {
				reject(`whisper.cpp exited with code ${exitCode}`)

				logger.log(stderrOutput)
			}
		})

		//writeToStdinInChunks(process, sourceAsWave, 2 ** 10)
		process.stdin.end(sourceAsWave)
	})
}

export async function detectLanguage(sourceRawAudio: RawAudio, modelName: WhisperModelName, modelPath: string) {
	if (sourceRawAudio.sampleRate != 16000) {
		throw new Error('Source audio must have a sample rate of 16000')
	}

	async function detectLanguageForPart(partAudio: RawAudio) {
		const { language } = await recognize(
			partAudio,
			'detect-language',
			undefined,
			modelName,
			modelPath,
			{},
		)

		const partResults = [{
			language: language!,
			languageName: formatLanguageCodeWithName(language!),
			probability: 1.0,
		}]

		return partResults
	}

	const results = await detectSpeechLanguageByParts(sourceRawAudio, detectLanguageForPart)

	results.sort((entry1, entry2) => entry2.probability - entry1.probability)

	return results
}

async function parseResultObject(resultObject: WhisperCppVerboseResult, modelName: WhisperModelName, totalDuration: number, enableDTW: boolean): Promise<RecognitionResult> {
	const { Whisper } = await import('../recognition/WhisperSTT.js')

	const whisper = new Whisper(modelName, '', [], [])
	await whisper.initializeTokenizerIfNeeded()

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

export async function loadModelPackage(modelId: WhisperCppModelId | undefined, languageCode: string | undefined) {
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
	const modelPath = joinPath(modelDir, `ggml-${modelId}.bin`)
	const modelName = getModelNameFromModelId(modelId)

	return { modelName, modelPath }
}

export type WhisperCppBuild = 'cpu' | 'cublas-12.4.0' | 'custom'

export async function loadExecutablePackage(buildKind: WhisperCppBuild) {
	if (buildKind === 'custom') {
		throw new Error(`A 'custom' build kind requires providing a custom path to the whisper.cpp binary in the 'executablePath' option.`)
	}

	const platform = process.platform
	const arch = process.arch

	let packageName: string

	if (buildKind.startsWith('cublas-')) {
		if (platform === 'win32' && arch === 'x64') {
			packageName = `whisper.cpp-binaries-windows-x64-${buildKind}-latest`
		} else {
			throw new Error(`whisper.cpp GPU builds (NVIDIA CUDA only) are currently only available as packages for Windows x64. Please specify a custom path to a whisper.cpp 'main' binary in the 'executablePath' option.`)
		}
	} else if (buildKind === 'cpu') {
		if (platform === 'win32' && arch === 'x64') {
			packageName = `whisper.cpp-binaries-windows-x64-cpu-latest`
		} else if (platform === 'linux' && arch === 'x64') {
			packageName = `whisper.cpp-binaries-linux-x64-cpu-latest`
		} else {
			throw new Error(`Couldn't find a matching whisper.cpp binary package. Please specify a custom path to a whisper.cpp 'main' binary in the 'executablePath' option.`)
		}
	} else {
		throw new Error(`Unsupported build kind '${buildKind}'`)
	}

	const packagePath = await loadPackage(packageName)

	let filename = 'main'

	if (platform === 'win32') {
		filename += '.exe'
	}

	return joinPath(packagePath, filename)
}

function getModelNameFromModelId(modelId: WhisperCppModelId): WhisperModelName {
	if (modelId.startsWith('large-v1')) {
		return 'large-v1'
	}

	if (modelId.startsWith('large-v2')) {
		return 'large-v2'
	}

	if (modelId.startsWith('large-v3-turbo')) {
		return 'large-v3-turbo'
	}

	if (modelId.startsWith('large-v3')) {
		return 'large-v3'
	}

	const lastDashIndex = modelId.lastIndexOf('-')

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
	build?: WhisperCppBuild
	executablePath?: string
	enableGPU?: boolean

	model?: WhisperCppModelId

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

export const defaultWhisperCppOptions: WhisperCppOptions = {
	build: undefined,
	executablePath: undefined,

	model: undefined,

	threadCount: 4,
	splitCount: 1,
	enableGPU: undefined,

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
	'large-v3-q5_0' |
	`large-v3-turbo` |
	`large-v3-turbo-q5_0`
