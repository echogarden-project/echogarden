import { spawn } from "child_process"

import { encodeWaveBuffer, decodeWaveBuffer, RawAudio } from "../audio/AudioUtilities.js"

import type { FFmpeg } from "@ffmpeg/ffmpeg"

import { Logger } from "../utilities/Logger.js"
import { commandExists, logToStderr } from "../utilities/Utilities.js"
import path from "node:path"
import { readFile, writeFileSafe } from "../utilities/FileSystem.js"
import { loadPackage } from "../utilities/PackageManager.js"

let ffmpeg: FFmpeg

const log = logToStderr

export type FFMpegOutputOptions = {
	filename?: string
	codec?: string
	format?: string
	sampleRate?: number
	sampleFormat?: "u8" | "s16" | "s32" | "s64" | "flt" | "dbl"
	channelCount?: number
	bitrate?: number
	audioOnly?: boolean
	customOptions?: string[]
}

export async function encodeFromChannels(rawAudio: RawAudio, outputOptions: FFMpegOutputOptions) {
	return transcode(encodeWaveBuffer(rawAudio), outputOptions)
}

export async function decodeToChannels(input: string | Buffer, outSampleRate?: number, outChannelCount?: number) {
	const outputOptions: FFMpegOutputOptions = {
		codec: "pcm_f32le",
		format: "wav",
		sampleRate: outSampleRate,
		channelCount: outChannelCount,
		audioOnly: true
	}

	const waveAudio = await transcode(input, outputOptions)

	const { rawAudio } = decodeWaveBuffer(waveAudio, true)

	return rawAudio
}

export async function transcode(input: string | Buffer, outputOptions: FFMpegOutputOptions) {
	const executablePath = await getExecutablePath()

	if (executablePath) {
		return transcode_CLI(input, outputOptions)
	} else {
		if (Buffer.isBuffer(input)) {
			return transcode_Wasm(input, outputOptions)
		} else {
			return transcode_Wasm(await readFile(input), outputOptions)
		}
	}
}

async function transcode_CLI(input: string | Buffer, outputOptions: FFMpegOutputOptions) {
	const ffmpegCommand = await getExecutablePath()

	if (!ffmpegCommand) {
		throw new Error("No ffmpeg executable was found")
	}

	return new Promise<Buffer>((resolve, reject) => {
		const logger = new Logger()
		logger.start("Transcode with command-line ffmpeg")

		const args = buildCommandLineArguments(Buffer.isBuffer(input) ? "-" : input, outputOptions)

		const process = spawn(ffmpegCommand, args)

		if (Buffer.isBuffer(input)) {
			process.stdin.end(input)
		}

		const stdOutChunks: Buffer[] = []
		let stdErrOutput = ""

		process.stdout.on('data', (data) => {
			stdOutChunks.push(data)
		})

		process.stderr.setEncoding("utf8")
		process.stderr.on('data', (data) => {
			//log(data)
			stdErrOutput += data
		})

		process.on("error", (e) => {
			reject(e)
		})

		process.on('close', (exitCode) => {
			if (exitCode == 0) {
				resolve(Buffer.concat(stdOutChunks))
			} else {
				reject(`ffmpeg exited with code ${exitCode}`)
				log(stdErrOutput)
			}

			logger.end()
		})
	})
}


async function transcode_Wasm(inputData: Buffer, outputOptions: FFMpegOutputOptions) {
	await initializeWasmIfNeeded(false)

	const logger = new Logger()
	logger.start("Transcode with WASM ffmpeg")


	let outputFileExtension = ""

	if (outputOptions.filename) {
		outputFileExtension = path.parse(outputOptions.filename).ext
	}

	const inputFilename = "inputFile"
	const outputFilename = "outputFile" + outputFileExtension

	const args = buildCommandLineArguments(inputFilename, { ...outputOptions, filename: outputFilename })

	ffmpeg.FS('writeFile', inputFilename, inputData)

	await ffmpeg.run(...args)

	const outFileData = ffmpeg.FS('readFile', outputFilename)

	let result: Buffer

	if (outputOptions.filename) {
		await writeFileSafe(outputOptions.filename, outFileData)
		result = Buffer.from([])
	} else {
		result = Buffer.from(outFileData)
	}

	logger.end()
	return result
}

export async function listWasmCodecs() {
	await initializeWasmIfNeeded(true)
	await ffmpeg.run("-codecs")
}

async function initializeWasmIfNeeded(verbose = false) {
	if (!ffmpeg) {
		const logger = new Logger()
		logger.start("Initialize WASM ffmpeg instance")

		const { createFFmpeg } = await import("@ffmpeg/ffmpeg")

		ffmpeg = createFFmpeg({ log: verbose })
		await ffmpeg.load()

		logger.end()
	}
}

function buildCommandLineArguments(inputFilename: string, outputOptions: FFMpegOutputOptions) {
	outputOptions = { ...outputOptions }

	if (!outputOptions.filename) {
		outputOptions.filename = "-"
	}

	const args: string[] = []

	args.push(
		`-i`, `${inputFilename}`,
	)

	if (outputOptions.audioOnly) {
		args.push(`-map`, `a`)
	}

	if (outputOptions.codec) {
		args.push(`-c:a`, `${outputOptions.codec}`)
	}

	if (outputOptions.format) {
		args.push(`-f:a`, `${outputOptions.format}`)
	}

	if (outputOptions.sampleRate) {
		args.push(`-ar`, `${outputOptions.sampleRate}`)
	}

	if (outputOptions.sampleFormat) {
		args.push(`-sample_fmt`, `${outputOptions.sampleFormat}`)
	}

	if (outputOptions.channelCount) {
		args.push(`-ac`, `${outputOptions.channelCount}`)
	}

	if (outputOptions.bitrate) {
		args.push(`-ab`, `${outputOptions.bitrate}k`)
	}

	args.push(`-y`)

	if (outputOptions.customOptions) {
		args.push(...outputOptions.customOptions)
	}

	args.push(outputOptions.filename)

	return args
}

async function getExecutablePath() {
	if (process.platform == "win32") {
		const ffmpegPackagePath = await loadPackage("ffmpeg-6.0-essentials-win64")

		return path.join(ffmpegPackagePath, "ffmpeg.exe")
	} else if (process.platform == "darwin" && process.arch == "x64") {
		const ffmpegPackagePath = await loadPackage("ffmpeg-6.0-macos64")

		return path.join(ffmpegPackagePath, "ffmpeg")
	} else if (process.platform == "linux" && process.arch == "x64") {
		const ffmpegPackagePath = await loadPackage("ffmpeg-6.0-linux-amd64")

		return path.join(ffmpegPackagePath, "ffmpeg")
	} else if (await commandExists("ffmpeg")) {
		return "ffmpeg"
	}

	return undefined
}
