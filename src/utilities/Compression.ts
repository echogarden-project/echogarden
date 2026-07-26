import { Logger } from './Logger.js'
import { readdir, stat } from './FileSystem.js'
import { encodeUtf8 } from '../encodings/Utf8.js'
import { getBaseName, getDirName } from './PathUtilities.js'
import { OperationCallbacks } from '../api/Common.js'

export async function createTarball(filePath: string, outputFile: string, prefixPath = '', callbacks: OperationCallbacks) {
	const pathStat = await stat(filePath)

	if (pathStat.isDirectory()) {
		await createTarballForDir(filePath, outputFile, prefixPath, callbacks)
	} else {
		await createTarballForFile(filePath, outputFile, prefixPath, callbacks)
	}
}

export async function createTarballForFile(filePath: string, outputFile: string, prefixPath = '', callbacks: OperationCallbacks) {
	const logger = new Logger(callbacks.logLevel)

	logger.start(`Create ${prefixPath || getBaseName(outputFile)}`)

	const { create } = await import('tar')

	const inputFileStat = await stat(filePath)

	if (!inputFileStat.isFile()) {
		throw new Error(`${filePath} is not a file`)
	}

	const filename = getBaseName(filePath)
	const dirname = getDirName(filePath)

	await create({
		gzip: { level: 9 },
		file: outputFile,
		cwd: dirname,
		prefix: prefixPath,
		mode: 0o775,

		filter: (path, stat) => {
			if (stat.mode) {
				stat.mode |= 0o775
			}

			return true
		}

	}, [filename])

	logger.end()
}

export async function createTarballForDir(inputDir: string, outputFile: string, prefixPath = '', callbacks: OperationCallbacks) {
	const logger = new Logger(callbacks.logLevel)

	logger.start(`Create ${prefixPath || getBaseName(outputFile)}`)

	const { create } = await import('tar')

	const inputDirStat = await stat(inputDir)

	if (!inputDirStat.isDirectory()) {
		throw new Error(`${inputDir} is not a directory`)
	}

	const filesInBaseDir = await readdir(inputDir)

	await create({
		gzip: { level: 9 },
		file: outputFile,
		cwd: inputDir,
		prefix: prefixPath,
		mode: 0o775,

		filter: (path, stat) => {
			if (stat.mode) {
				stat.mode |= 0o775
			}

			return true
		}

	}, filesInBaseDir)

	logger.end()
}

export async function extractTarball(filepath: string, outputDir: string) {
	const { extract } = await import('tar')

	await extract({
		file: filepath,
		cwd: outputDir,
		preserveOwner: false,
		//noChmod: true
	})
}

export async function getDeflateCompressionMetricsForString(str: string) {
	const zlib = await import('node:zlib')
	const { promisify } = await import('node:util')

	const originalStringBytes = encodeUtf8(str)

	const deflateRaw = promisify(zlib.deflateRaw)

	const compressedStringBytes = await deflateRaw(originalStringBytes)

	return {
		originalSize: originalStringBytes.length,
		compressedSize: compressedStringBytes.length,
		ratio: originalStringBytes.length / compressedStringBytes.length
	}
}

export function computeDeltas(data: Float32Array) {
	const deltas = new Float32Array(data.length)

	let val = 0

	for (let i = 0; i < data.length; i++) {
		const delta = Math.floor(data[i] - val)
		deltas[i] = delta

		val += delta
	}

	return deltas
}
