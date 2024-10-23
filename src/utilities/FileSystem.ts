import * as fsExtra from 'fs-extra/esm'
import gracefulFS from 'graceful-fs'
import * as os from 'node:os'

import path from 'node:path'
import { promisify } from 'node:util'
import { getRandomHexString } from './Utilities.js'
import { appName } from '../api/Common.js'
import { getAppTempDir } from './PathUtilities.js'

import { createDynamicUint8Array } from '../data-structures/DynamicTypedArray.js'
import { ChunkedUtf8Decoder } from '../encodings/Utf8.js'
import { FileWriter } from './FileWriter.js'

export const readdir = promisify(gracefulFS.readdir)
export const stat = promisify(gracefulFS.stat)
export const open = promisify(gracefulFS.open)
export const close = promisify(gracefulFS.close)
export const chmod = promisify(gracefulFS.chmod)
export const copyFile = promisify(gracefulFS.copyFile)
export const access = promisify(gracefulFS.access)
export const read = promisify(gracefulFS.read)
export const write = promisify(gracefulFS.write)

export const existsSync = gracefulFS.existsSync

export const remove = fsExtra.remove
export const copy = fsExtra.copy

export async function readDirRecursive(dir: string, fileFilter?: (filePath: string) => boolean) {
	if (!(await stat(dir)).isDirectory()) {
		throw new Error(`'${dir}' is not a directory`)
	}

	const filenamesInDir = await readdir(dir)
	const filesInDir = filenamesInDir.map(filename => path.join(dir, filename))

	const result: string[] = []
	const subDirectories: string[] = []

	for (const filePath of filesInDir) {
		if ((await stat(filePath)).isDirectory()) {
			subDirectories.push(filePath)
		} else {
			if (fileFilter && !fileFilter(filePath)) {
				continue
			}

			result.push(filePath)
		}
	}

	for (const subDirectory of subDirectories) {
		const filesInSubdirectory = await readDirRecursive(subDirectory, fileFilter)
		result.push(...filesInSubdirectory)
	}

	return result
}

export async function isFileIsUpToDate(filePath: string, timeRangeSeconds: number) {
	const fileUpdateTime = (await stat(filePath)).mtime.valueOf()

	const currentTime = (new Date()).valueOf()

	const differenceInMilliseconds = currentTime - fileUpdateTime

	const differenceInSeconds = differenceInMilliseconds / 1000

	return differenceInSeconds <= timeRangeSeconds
}

export async function computeFileSha256Hex(filePath: string) {
	const crypto = await import('crypto')
	const hash = crypto.createHash('sha256')

	async function processChunk(chunk: Uint8Array) {
		hash.update(chunk)
	}

	await readFileInChunks(filePath, 2 ** 64, processChunk)

	const result = hash.digest('hex')

	return result
}

export async function readAndParseJsonFile(jsonFilePath: string, useJson5 = false) {
	const fileTextContent = await readFileAsUtf8(jsonFilePath)

	if (useJson5) {
		const { default: JSON5 } = await import('json5')

		return JSON5.parse(fileTextContent)
	} else {
		return JSON.parse(fileTextContent)
	}
}

export async function readFileAsBinary(filePath: string) {
	const chunkSize = 2 ** 20

	const fileInfo = await stat(filePath)
	const fileSize = fileInfo.size

	const result = createDynamicUint8Array(fileSize)

	async function processChunk(chunk: Uint8Array) {
		result.addArray(chunk)
	}

	await readFileInChunks(filePath, chunkSize, processChunk)

	return result.toTypedArray()
}

export async function readFileAsUtf8(filePath: string) {
	const chunkSize = 2 ** 20

	const result = new ChunkedUtf8Decoder()

	async function processChunk(chunk: Uint8Array) {
		result.writeChunk(chunk)
	}

	await readFileInChunks(filePath, chunkSize, processChunk)

	return result.toString()
}

export async function readFileInChunks(filePath: string, maxChunkSize: number, processChunk: (chunk: Uint8Array) => Promise<void>) {
	const fileHandle = await open(filePath, 'r')

	const buffer = new Uint8Array(maxChunkSize)

	let readOffset = 0

	while (true) {
		let bytesRead: number

		try {
			({ bytesRead } = await read(fileHandle, buffer, 0, maxChunkSize, readOffset))
		} catch (e) {
			await close(fileHandle)

			throw e
		}

		if (bytesRead === 0) {
			await close(fileHandle)

			return
		}

		const chunk = buffer.subarray(0, bytesRead)

		try {
			await processChunk(chunk)
		} catch (e) {
			await close(fileHandle)

			throw e
		}

		readOffset += bytesRead
	}
}

export async function writeFile(filePath: string, content: Uint8Array | string) {
	if (typeof content === 'string') {
		return writeUtf8File(filePath, content)
	} else if (content instanceof Uint8Array) {
		return writeBinaryFile(filePath, content)
	} else {
		throw new Error(`Content can only be a Uint8Array or string`)
	}
}

export async function writeBinaryFile(filePath: string, content: Uint8Array) {
	const chunkSize = 2 ** 20

	const fileDir = path.dirname(filePath)

	await ensureDir(fileDir)

	const fileWriter = new FileWriter(filePath)

	let readOffset = 0

	while (true) {
		const chunk = content.subarray(readOffset, readOffset + chunkSize)

		if (chunk.length === 0) {
			break
		}

		await fileWriter.write(chunk)

		readOffset += chunkSize
	}

	await fileWriter.dispose()
}

export async function writeUtf8File(filePath: string, content: string) {
	const chunkSize = 2 ** 20

	const fileDir = path.dirname(filePath)

	await ensureDir(fileDir)

	const fileWriter = new FileWriter(filePath)

	let readOffset = 0

	const textEncoder = new TextEncoder()

	while (true) {
		const stringChunk = content.substring(readOffset, readOffset + chunkSize)

		if (stringChunk.length === 0) {
			break
		}

		const chunk = textEncoder.encode(stringChunk)

		fileWriter.write(chunk)

		readOffset += chunkSize
	}

	await fileWriter.dispose()
}

export async function writeFileSafe(filePath: string, content: Uint8Array | string) {
	const tempDir = getAppTempDir(appName)
	const tempFilePath = path.join(tempDir, `${getRandomHexString(16)}.partial`)

	await writeFile(tempFilePath, content)

	await move(tempFilePath, filePath)
}

export function getAppDataDir(appName: string) {
	let dataDir: string

	const platform = process.platform
	const homeDir = os.homedir()

	if (platform == 'win32') {
		dataDir = path.join(homeDir, 'AppData', 'Local', appName)
	} else if (platform == 'darwin') {
		dataDir = path.join(homeDir, 'Library', 'Application Support', appName)
	} else if (platform == 'linux') {
		dataDir = path.join(homeDir, '.local', 'share', appName)
	} else {
		throw new Error(`Unsupport platform ${platform}`)
	}

	return dataDir
}

export async function chmodRecursive(rootPath: string, newMode: number) {
	const rootPathStat = await stat(rootPath)

	await chmod(rootPath, newMode)

	if (rootPathStat.isDirectory()) {
		const fileList = await readdir(rootPath)

		for (const filename of fileList) {
			const filePath = path.join(rootPath, filename)

			await chmodRecursive(filePath, newMode)
		}
	}
}

export async function ensureDir(dirPath: string) {
	dirPath = path.normalize(dirPath)

	if (existsSync(dirPath)) {
		const dirStats = await stat(dirPath)

		if (!dirStats.isDirectory()) {
			throw new Error(`The path '${dirPath}' exists but is not a directory.`)
		}
	} else {
		return fsExtra.ensureDir(dirPath)
	}
}

export async function move(source: string, dest: string) {
	source = path.normalize(source)
	dest = path.normalize(dest)

	if (existsSync(dest)) {
		const destPathExistsAndIsWritable = await existsAndIsWritable(dest)

		if (!destPathExistsAndIsWritable) {
			throw new Error(`The destination path '${dest}' exists but is not writable. There may be a permissions or locking issue.`)
		}
	} else {
		const destDir = path.parse(dest).dir
		const destDirIsWritable = await testDirectoryIsWritable(destDir)

		if (!destDirIsWritable) {
			throw new Error(`The directory ${destDir} is not writable. There may be a permissions issue.`)
		}
	}

	return fsExtra.move(source, dest, { overwrite: true })
}

export async function existsAndIsWritable(targetPath: string) {
	try {
		await access(targetPath, gracefulFS.constants.W_OK);
	} catch {
		return false
	}

	return true
}

export async function testDirectoryIsWritable(dir: string) {
	const testFileName = path.join(dir, getRandomHexString(16))

	try {
		await fsExtra.createFile(testFileName)
		await remove(testFileName)
	} catch (e) {
		return false
	}

	return true
}
