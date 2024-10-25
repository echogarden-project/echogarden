import * as fsExtra from 'fs-extra/esm'
import gracefulFS from 'graceful-fs'
import * as os from 'node:os'

import { promisify } from 'node:util'
import { getRandomHexString, parseJson, stringifyAndFormatJson } from './Utilities.js'
import { appName } from '../api/Common.js'
import { getAppTempDir, getDirName, joinPath, normalizePath, parsePath } from './PathUtilities.js'

import { createDynamicUint8Array } from '../data-structures/DynamicTypedArray.js'
import { ChunkedUtf8Decoder } from '../encodings/Utf8.js'
import { FileWriter } from './FileWriter.js'
import { FileReader } from './FileReader.js'

export const open = promisify(gracefulFS.open)
export const close = promisify(gracefulFS.close)

export const read = promisify(gracefulFS.read)
export const write = promisify(gracefulFS.write)

export const existsSync = gracefulFS.existsSync

export const stat = promisify(gracefulFS.stat)
export const chmod = promisify(gracefulFS.chmod)
export const access = promisify(gracefulFS.access)

export const readdir = promisify(gracefulFS.readdir)
export const copyFile = promisify(gracefulFS.copyFile)

export const remove = fsExtra.remove
export const copy = fsExtra.copy

///////////////////////////////////////////////////////////////////////////////////////////
// File read operations
///////////////////////////////////////////////////////////////////////////////////////////
export async function readFileAsBinary(filePath: string) {
	const chunkSize = 2 ** 20

	const fileInfo = await stat(filePath)
	const fileSize = fileInfo.size

	const fileReader = new FileReader(filePath)
	const buffer = new Uint8Array(chunkSize)
	const result = createDynamicUint8Array(fileSize)

	while (!fileReader.isFinished) {
		const chunk = await fileReader.readChunk(buffer)

		result.addArray(chunk)
	}

	return result.toTypedArray()
}

export async function readFileAsUtf8(filePath: string) {
	const chunkSize = 2 ** 20

	const fileReader = new FileReader(filePath)
	const buffer = new Uint8Array(chunkSize)

	const result = new ChunkedUtf8Decoder()

	while (!fileReader.isFinished) {
		const chunk = await fileReader.readChunk(buffer)

		result.writeChunk(chunk)
	}

	return result.toString()
}

export async function readAndParseJsonFile(jsonFilePath: string, useJson5 = false) {
	const textContent = await readFileAsUtf8(jsonFilePath)

	return parseJson(textContent, useJson5)
}

///////////////////////////////////////////////////////////////////////////////////////////
// File write operations
///////////////////////////////////////////////////////////////////////////////////////////
export async function writeFile(filePath: string, content: Uint8Array | string) {
	if (content instanceof Uint8Array) {
		return writeBinaryFile(filePath, content)
	} else if (typeof content === 'string') {
		return writeUtf8File(filePath, content)
	} else {
		throw new Error(`Content can only be a Uint8Array or string`)
	}
}

export async function writeBinaryFile(filePath: string, content: Uint8Array) {
	const maxChunkSize = 2 ** 20

	const fileDir = getDirName(filePath)

	await ensureDir(fileDir)

	const fileWriter = new FileWriter(filePath)

	let readOffset = 0

	while (true) {
		const chunk = content.subarray(readOffset, readOffset + maxChunkSize)

		if (chunk.length === 0) {
			break
		}

		await fileWriter.write(chunk)

		readOffset += chunk.length
	}

	await fileWriter.dispose()
}

export async function writeUtf8File(filePath: string, content: string) {
	const maxChunkSize = 2 ** 20

	const fileDir = getDirName(filePath)

	await ensureDir(fileDir)

	const fileWriter = new FileWriter(filePath)

	const textEncoder = new TextEncoder()

	let readOffset = 0

	while (true) {
		const stringChunk = content.substring(readOffset, readOffset + maxChunkSize)

		if (stringChunk.length === 0) {
			break
		}

		const chunk = textEncoder.encode(stringChunk)

		await fileWriter.write(chunk)

		readOffset += stringChunk.length
	}

	await fileWriter.dispose()
}

export async function writeJsonFile(filePath: string, content: any, useJson5 = false) {
	const textContent = await stringifyAndFormatJson(content, useJson5)

	await writeUtf8File(filePath, textContent)
}

export async function writeFileSafe(filePath: string, content: Uint8Array | string) {
	const tempDir = getAppTempDir(appName)
	const tempFilePath = joinPath(tempDir, `${getRandomHexString(16)}.partial`)

	await writeFile(tempFilePath, content)

	await move(tempFilePath, filePath)
}

///////////////////////////////////////////////////////////////////////////////////////////
// Directory operations
///////////////////////////////////////////////////////////////////////////////////////////
export async function ensureDir(dirPath: string) {
	dirPath = normalizePath(dirPath)

	if (existsSync(dirPath)) {
		const dirStats = await stat(dirPath)

		if (!dirStats.isDirectory()) {
			throw new Error(`The path '${dirPath}' exists but is not a directory.`)
		}
	} else {
		return fsExtra.ensureDir(dirPath)
	}
}

export async function testDirectoryIsWritable(dir: string) {
	const testFileName = joinPath(dir, getRandomHexString(16))

	try {
		await fsExtra.createFile(testFileName)
		await remove(testFileName)
	} catch (e) {
		return false
	}

	return true
}

export async function readDirRecursive(dir: string, pathFilter?: (filePath: string) => boolean) {
	if (!(await stat(dir)).isDirectory()) {
		throw new Error(`'${dir}' is not a directory`)
	}

	const filenamesInDir = await readdir(dir)
	const filesInDir = filenamesInDir.map(filename => joinPath(dir, filename))

	const result: string[] = []
	const subDirectories: string[] = []

	for (const filePath of filesInDir) {
		if ((await stat(filePath)).isDirectory()) {
			subDirectories.push(filePath)
		} else {
			if (pathFilter && !pathFilter(filePath)) {
				continue
			}

			result.push(filePath)
		}
	}

	for (const subDirectory of subDirectories) {
		const filesInSubdirectory = await readDirRecursive(subDirectory, pathFilter)
		result.push(...filesInSubdirectory)
	}

	return result
}

export function getAppDataDir(appName: string) {
	let dataDir: string

	const platform = process.platform
	const homeDir = os.homedir()

	if (platform == 'win32') {
		dataDir = joinPath(homeDir, 'AppData', 'Local', appName)
	} else if (platform == 'darwin') {
		dataDir = joinPath(homeDir, 'Library', 'Application Support', appName)
	} else if (platform == 'linux') {
		dataDir = joinPath(homeDir, '.local', 'share', appName)
	} else {
		throw new Error(`Unsupport platform ${platform}`)
	}

	return dataDir
}

///////////////////////////////////////////////////////////////////////////////////////////
// Copy operations
///////////////////////////////////////////////////////////////////////////////////////////
export async function move(source: string, dest: string) {
	source = normalizePath(source)
	dest = normalizePath(dest)

	if (existsSync(dest)) {
		const destPathExistsAndIsWritable = await existsAndIsWritable(dest)

		if (!destPathExistsAndIsWritable) {
			throw new Error(`The destination path '${dest}' exists but is not writable. There may be a permissions or locking issue.`)
		}
	} else {
		const destDir = parsePath(dest).dir
		const destDirIsWritable = await testDirectoryIsWritable(destDir)

		if (!destDirIsWritable) {
			throw new Error(`The directory ${destDir} is not writable. There may be a permissions issue.`)
		}
	}

	return fsExtra.move(source, dest, { overwrite: true })
}

///////////////////////////////////////////////////////////////////////////////////////////
// Misc operations
///////////////////////////////////////////////////////////////////////////////////////////
export async function existsAndIsWritable(targetPath: string) {
	try {
		await access(targetPath, gracefulFS.constants.W_OK);
	} catch {
		return false
	}

	return true
}

export async function chmodRecursive(rootPath: string, newMode: number) {
	const rootPathStat = await stat(rootPath)

	await chmod(rootPath, newMode)

	if (rootPathStat.isDirectory()) {
		const fileList = await readdir(rootPath)

		for (const filename of fileList) {
			const filePath = joinPath(rootPath, filename)

			await chmodRecursive(filePath, newMode)
		}
	}
}

export async function isFileIsUpToDate(filePath: string, maxTimeDifferenceSeconds: number) {
	const fileUpdateTime = (await stat(filePath)).mtime.valueOf()

	const currentTime = (new Date()).valueOf()

	const differenceInMilliseconds = currentTime - fileUpdateTime

	const differenceInSeconds = differenceInMilliseconds / 1000

	return differenceInSeconds <= maxTimeDifferenceSeconds
}

export async function computeFileSha256Hex(filePath: string) {
	const crypto = await import('crypto')

	const hash = crypto.createHash('sha256')

	const fileReader = new FileReader(filePath)
	const buffer = new Uint8Array(2 ** 16)

	while (!fileReader.isFinished) {
		const chunk = await fileReader.readChunk(buffer)

		hash.update(chunk)
	}

	const result = hash.digest('hex')

	return result
}
