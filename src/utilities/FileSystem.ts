import * as fsExtra from 'fs-extra/esm'
import gracefulFS from 'graceful-fs'

import { promisify } from 'node:util'
import { getRandomHexString, parseJson, stringifyAndFormatJson } from './Utilities.js'
import { appName } from '../api/Common.js'
import { getAppTempDir, getDirName, joinPath, normalizePath, parsePath } from './PathUtilities.js'

import { createDynamicUint8Array } from '../data-structures/DynamicTypedArray.js'
import { ChunkedUtf8Decoder, ChunkedUtf8Encoder } from '../encodings/Utf8.js'
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
export const rename = promisify(gracefulFS.rename)
export const fsync = promisify(gracefulFS.fsync)

export const remove = fsExtra.remove

///////////////////////////////////////////////////////////////////////////////////////////
// File read operations
///////////////////////////////////////////////////////////////////////////////////////////
export async function readFileAsBinary(filePath: string) {
	const chunkSize = 2 ** 20

	const fileInfo = await stat(filePath)
	const fileSize = fileInfo.size

	const fileReader = new FileReader(filePath)
	const buffer = new Uint8Array(chunkSize)
	const fileContent = createDynamicUint8Array(fileSize)

	while (!fileReader.isFinished) {
		const chunk = await fileReader.readChunk(buffer)

		fileContent.addArray(chunk)
	}

	return fileContent.toTypedArray()
}

export async function readFileAsUtf8(filePath: string) {
	const maxChunkSize = 2 ** 20

	const fileReader = new FileReader(filePath)
	const buffer = new Uint8Array(maxChunkSize)

	const chunkedUtf8Decoder = new ChunkedUtf8Decoder()

	let fileContent = ''

	while (!fileReader.isFinished) {
		const utf8Chunk = await fileReader.readChunk(buffer)

		const stringChunk = chunkedUtf8Decoder.writeChunk(utf8Chunk)
		fileContent += stringChunk
	}

	return fileContent
}

export async function readAndParseJsonFile(jsonFilePath: string, useJson5 = false) {
	const textContent = await readFileAsUtf8(jsonFilePath)

	return parseJson(textContent, useJson5)
}

///////////////////////////////////////////////////////////////////////////////////////////
// File write operations
///////////////////////////////////////////////////////////////////////////////////////////
export async function writeFile(filePath: string, content: Uint8Array | string, options?: WriteFileOptions) {
	if (content instanceof Uint8Array) {
		return writeBinaryFile(filePath, content, options)
	} else if (typeof content === 'string') {
		return writeUtf8File(filePath, content, options)
	} else {
		throw new Error(`Content can only be a Uint8Array or string.`)
	}
}

export async function writeBinaryFile(filePath: string, content: Uint8Array, options?: WriteFileOptions) {
	const maxChunkSize = 2 ** 20

	const fileDir = getDirName(filePath)

	await ensureDir(fileDir)

	const fileWriter = new FileWriter(filePath)

	try {
		// The do-while body runs at least once, even for empty content, so the
		// file is always created (or truncated) via FileWriter's first write.
		let readOffset = 0

		do {
			const chunk = content.subarray(readOffset, readOffset + maxChunkSize)

			readOffset += chunk.length

			await fileWriter.write(chunk)
		} while (readOffset < content.length)

		if (options?.fsync === true) {
			await fileWriter.fsync()
		}
	} finally {
		await fileWriter.dispose()
	}
}

export async function writeUtf8File(filePath: string, content: string, options?: WriteFileOptions) {
	const maxChunkSize = 2 ** 20

	const fileDir = getDirName(filePath)

	await ensureDir(fileDir)

	const fileWriter = new FileWriter(filePath)

	const chunkedUtf8Encoder = new ChunkedUtf8Encoder()

	try {
		// The do-while body runs at least once, even for empty content, so the
		// file is always created (or truncated) via FileWriter's first write.
		let readOffset = 0

		do {
			const stringChunk = content.substring(readOffset, readOffset + maxChunkSize)

			readOffset += stringChunk.length

			const utf8Chunk = chunkedUtf8Encoder.writeChunk(stringChunk)

			await fileWriter.write(utf8Chunk)
		} while (readOffset < content.length)

		const finalChunk = chunkedUtf8Encoder.finalize()

		if (finalChunk.length > 0) {
			await fileWriter.write(finalChunk)
		}

		if (options?.fsync === true) {
			await fileWriter.fsync()
		}
	} finally {
		// Always release the file handle, even if an error interrupted the write.
		await fileWriter.dispose()
	}
}

export async function writeJsonFile(filePath: string, content: any, useJson5 = false) {
	const textContent = stringifyAndFormatJson(content, useJson5)

	await writeUtf8File(filePath, textContent)
}

export async function writeFileSafe(filePath: string, content: Uint8Array | string) {
	const destDir = getDirName(filePath)

	const tempDir = await getTemporaryDirectory(destDir)
	const tempFilePath = joinPath(tempDir, `${getRandomHexString(16)}.partial`)

	try {
		await writeFile(tempFilePath, content, { fsync: true })

		await move(tempFilePath, filePath)
	} catch (e) {
		// Best-effort cleanup so failed writes don't leave orphaned .partial files behind.
		try {
			await remove(tempFilePath)
		} catch {
			// Ignore cleanup errors so the original error is not masked.
		}

		throw e
	}
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

///////////////////////////////////////////////////////////////////////////////////////////
// Copy and move operations
///////////////////////////////////////////////////////////////////////////////////////////
export async function move(source: string, dest: string) {
	source = normalizePath(source)
	dest = normalizePath(dest)

	const destStats = existsSync(dest) ? await stat(dest) : undefined

	if (destStats?.isDirectory()) {
		throw new Error(`The destination path '${dest}' exists and is a directory. A file cannot be moved over a directory.`)
	}

	if (destStats) {
		const destPathExistsAndIsWritable = await existsAndIsWritable(dest)

		if (!destPathExistsAndIsWritable) {
			throw new Error(`The destination path '${dest}' exists but is not writable. There may be a permissions or locking issue.`)
		}
	} else {
		const destDir = parsePath(dest).dir

		await ensureDir(destDir)
	}

	try {
		// fs.rename() replaces an existing destination file in a single step on
		// POSIX and on Windows (where libuv uses MoveFileExW with
		// MOVEFILE_REPLACE_EXISTING, the atomic replace flag available to Node).
		await rename(source, dest)
	} catch (e) {
		const error = e as NodeJS.ErrnoException

		if (error.code === 'EXDEV') {
			// The source and destination are on different volumes, where an
			// atomic rename is impossible; fall back to a copy and delete.
			await copyFile(source, dest)
			await tryFsyncFile(dest)
			await remove(source)
		} else {
			throw error
		}
	}

	// The rename is now durable: flush the destination directory so the name
	// change survives a crash (best effort, see the helper).
	await tryFsyncDirectory(parsePath(dest).dir)
}

///////////////////////////////////////////////////////////////////////////////////////////
// Synchronization operations
///////////////////////////////////////////////////////////////////////////////////////////
export async function tryFsyncFile(filePath: string) {
	let fileHandle: number | undefined

	let succeeded = false

	try {
		fileHandle = await open(filePath, 'r+')

		await fsync(fileHandle)

		succeeded = true
	} catch {
	} finally {
		if (fileHandle !== undefined) {
			try {
				await close(fileHandle)
			} catch {
			}
		}
	}

	return succeeded
}

export async function tryFsyncDirectory(dirPath: string) {
	let dirHandle: number | undefined

	let succeeded = false

	try {
		dirHandle = await open(dirPath, 'r')

		await fsync(dirHandle)

		succeeded = true
	} catch {
	} finally {
		if (dirHandle !== undefined) {
			try {
				await close(dirHandle)
			} catch {
			}
		}
	}

	return succeeded
}

///////////////////////////////////////////////////////////////////////////////////////////
// Misc operations
///////////////////////////////////////////////////////////////////////////////////////////
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

export async function existsAndIsWritable(targetPath: string) {
	try {
		await access(targetPath, gracefulFS.constants.W_OK);
	} catch {
		return false
	}

	return true
}

// The OS temporary directory keeps temporary files away from the caller's
// directories, and the OS itself eventually cleans it up. It is used when it is
// on the same volume as the destination, since then the final rename is atomic.
//
// When it is on a different volume, the temporary file is written next to the
// destination instead: an atomic rename across volumes is impossible and would
// have to fall back to a copy and delete.
async function getTemporaryDirectory(destDir: string) {
	const osTempDir = getAppTempDir(appName)

	await ensureDir(osTempDir)

	if (await areOnSameDevice(osTempDir, destDir)) {
		return osTempDir
	} else {
		return destDir
	}
}

async function areOnSameDevice(firstPath: string, secondPath: string) {
	const firstDevice = await getDeviceOfExistingPath(firstPath)
	const secondDevice = await getDeviceOfExistingPath(secondPath)

	return firstDevice !== undefined && firstDevice === secondDevice
}

// Resolves the device of the closest existing ancestor directory of a target
// path, since the path itself may not exist yet. The device identifies the
// volume a path lives on (on Windows it is the drive number).
async function getDeviceOfExistingPath(targetPath: string) {
	let currentPath = normalizePath(targetPath)

	while (true) {
		try {
			const targetStats = await stat(currentPath)

			return targetStats.dev
		} catch (e) {
			const error = e as NodeJS.ErrnoException

			if (error.code !== 'ENOENT') {
				// If the path cannot be inspected, treat the volumes as different;
				// falling back to the destination directory always remains safe.
				return undefined
			}

			const parentPath = getDirName(currentPath)

			if (parentPath === currentPath) {
				return undefined
			}

			currentPath = parentPath
		}
	}
}

///////////////////////////////////////////////////////////////////////////////////////////
// Types
///////////////////////////////////////////////////////////////////////////////////////////

interface WriteFileOptions {
	fsync?: boolean
}
