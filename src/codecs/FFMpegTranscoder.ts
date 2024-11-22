import { spawn } from 'child_process'

import { encodeRawAudioToWave, decodeWaveToRawAudio, RawAudio } from '../audio/AudioUtilities.js'

import { Logger } from '../utilities/Logger.js'
import { commandExists, concatUint8Arrays, isUint8Array, logToStderr } from '../utilities/Utilities.js'
import { loadPackage } from '../utilities/PackageManager.js'
import { getGlobalOption } from '../api/GlobalOptions.js'
import { existsSync } from '../utilities/FileSystem.js'
import { joinPath } from '../utilities/PathUtilities.js'

const log = logToStderr

export type FFMpegOutputOptions = {
	filename?: string
	codec?: string
	format?: string
	sampleRate?: number
	sampleFormat?: 'u8' | 's16' | 's32' | 's64' | 'flt' | 'dbl'
	channelCount?: number
	bitrate?: number
	audioOnly?: boolean
	customOptions?: string[]
}

export async function encodeFromChannels(rawAudio: RawAudio, outputOptions: FFMpegOutputOptions) {
	return transcode(encodeRawAudioToWave(rawAudio), outputOptions)
}

export async function decodeToChannels(input: string | Uint8Array, outSampleRate?: number, outChannelCount?: number) {
	const outputOptions: FFMpegOutputOptions = {
		codec: 'pcm_f32le',
		format: 'wav',
		sampleRate: outSampleRate,
		channelCount: outChannelCount,
		audioOnly: true
	}

	const waveAudio = await transcode(input, outputOptions)

	const logger = new Logger()

	logger.start(`Convert wave buffer to raw audio`)
	const { rawAudio } = decodeWaveToRawAudio(waveAudio)
	logger.end()

	return rawAudio
}

export async function transcode(input: string | Uint8Array, outputOptions: FFMpegOutputOptions) {
	const executablePath = await getFFMpegExecutablePath()

	if (!executablePath) {
		throw new Error(`The ffmpeg utility wasn't found. Please ensure it is available on the system path.`)
	}

	return transcode_CLI(executablePath, input, outputOptions)
}

async function transcode_CLI(ffmpegCommand: string, input: string | Uint8Array, outputOptions: FFMpegOutputOptions) {
	return new Promise<Uint8Array>((resolve, reject) => {
		const logger = new Logger()
		logger.start('Transcode with command-line ffmpeg')

		const args = buildCommandLineArguments(isUint8Array(input) ? '-' : input, outputOptions)

		const process = spawn(ffmpegCommand, args)

		if (isUint8Array(input)) {
			process.stdin.end(input)
		} else if (typeof input === 'string') {
			if (!existsSync(input)) {
				reject(`Audio file was not found: ${input}`)
				return
			}
		}

		const stdoutChunks: Uint8Array[] = []
		let stderrOutput = ''

		process.stdout.on('data', (data) => {
			stdoutChunks.push(data)
		})

		process.stderr.setEncoding('utf8')
		process.stderr.on('data', (data) => {
			//log(data)
			stderrOutput += data
		})

		process.on('error', (e) => {
			reject(e)
		})

		process.on('close', (exitCode) => {
			if (exitCode == 0) {
				const concatenatedChunks = concatUint8Arrays(stdoutChunks)

				resolve(concatenatedChunks)
			} else {
				reject(`ffmpeg exited with code ${exitCode}`)
				log(stderrOutput)
			}

			logger.end()
		})
	})
}

function buildCommandLineArguments(inputFilename: string, outputOptions: FFMpegOutputOptions) {
	outputOptions = { ...outputOptions }

	if (!outputOptions.filename) {
		outputOptions.filename = '-'
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

async function getFFMpegExecutablePath() {
	// If a global option set for the path, use it
	if (getGlobalOption('ffmpegPath')) {
		return getGlobalOption('ffmpegPath')
	}

	// If an 'ffmpeg' command exist in system path, use it
	if (await commandExists('ffmpeg')) {
		return 'ffmpeg'
	}

	// Otherwise, download and use an internal ffmpeg package
	const platform = process.platform
	const arch = process.arch

	let packageName: string

	if (platform === 'win32' && arch === 'x64') {
		packageName = 'ffmpeg-6.0-win32-x64'
	} else if (platform === 'win32' && arch === 'ia32') {
		packageName = 'ffmpeg-6.0-win32-ia32'
	} else if (platform === 'win32' && arch === 'arm64') {
		packageName = 'ffmpeg-6.1-win32-arm64'
	} else if (platform === 'darwin' && arch === 'x64') {
		packageName = 'ffmpeg-6.0-darwin-x64'
	} else if (platform === 'darwin' && arch === 'arm64') {
		packageName = 'ffmpeg-6.0-darwin-arm64'
	} else if (platform === 'linux' && arch === 'x64') {
		packageName = 'ffmpeg-6.0-linux-x64'
	} else if (platform === 'linux' && arch === 'ia32') {
		packageName = 'ffmpeg-6.0-linux-ia32'
	} else if (platform === 'linux' && arch === 'arm64') {
		packageName = 'ffmpeg-6.0-linux-arm64'
	} else if (platform === 'linux' && arch === 'arm') {
		packageName = 'ffmpeg-6.0-linux-arm'
	} else if (platform === 'freebsd' && arch === 'x64') {
		packageName = 'ffmpeg-6.0-freebsd-x64'
	} else {
		return undefined
	}

	const ffmpegPackagePath = await loadPackage(packageName)

	let filename = packageName

	if (platform === 'win32') {
		filename += '.exe'
	}

	return joinPath(ffmpegPackagePath, filename)
}

export function getDefaultFFMpegOptionsForSpeech(fileExtension: string, customBitrate?: number) {
	let ffmpegOptions: FFMpegOutputOptions

	if (fileExtension == 'mp3') {
		ffmpegOptions = {
			format: 'mp3',
			codec: 'libmp3lame',
			bitrate: 64,
			customOptions: []
		}
	} else if (fileExtension == 'opus') {
		ffmpegOptions = {
			codec: 'libopus',
			bitrate: 48,
			customOptions: []
		}
	} else if (fileExtension == 'm4a') {
		ffmpegOptions = {
			format: 'mp4',
			codec: 'aac',
			bitrate: 48,
			customOptions: ['-profile:a', 'aac_low', '-movflags', 'frag_keyframe+empty_moov']
		}
	} else if (fileExtension == 'ogg') {
		ffmpegOptions = {
			codec: 'libvorbis',
			bitrate: 48,
			customOptions: []
		}
	} else if (fileExtension == 'flac') {
		ffmpegOptions = {
			format: 'flac',
			customOptions: ['-compression_level', '6']
		}
	} else {
		throw new Error(`Unsupported codec extension: '${fileExtension}'`)
	}

	if (customBitrate != null) {
		ffmpegOptions.bitrate = customBitrate
	}

	return ffmpegOptions
}
