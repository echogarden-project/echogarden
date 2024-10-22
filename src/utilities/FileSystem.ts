import * as fsExtra from 'fs-extra/esm'
import gracefulFS from 'graceful-fs'
import * as os from 'node:os'

import path from 'node:path'
import { promisify } from 'node:util'
import { OpenPromise } from './OpenPromise.js'
import { getRandomHexString } from './Utilities.js'
import { appName } from '../api/Common.js'
import { getAppTempDir } from './PathUtilities.js'

import { createDynamicUint8Array } from '../data-structures/DynamicTypedArray.js'
import { ChunkedUtf8Decoder } from '../encodings/Utf8.js'

export const readdir = promisify(gracefulFS.readdir)
export const stat = promisify(gracefulFS.stat)
export const open = promisify(gracefulFS.open)
export const close = promisify(gracefulFS.close)
export const chmod = promisify(gracefulFS.chmod)
export const copyFile = promisify(gracefulFS.copyFile)
export const access = promisify(gracefulFS.access)

export const createReadStream = gracefulFS.createReadStream
export const createWriteStream = gracefulFS.createWriteStream
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
	const resultOpenPromise = new OpenPromise<string>()

	const crypto = await import('crypto')
	const hash = crypto.createHash('sha256')

	const readStream = createReadStream(filePath)

	readStream.on('data', data => hash.update(data))
	readStream.on('error', error => resultOpenPromise.reject(error))
	readStream.on('end', () => resultOpenPromise.resolve(hash.digest('hex')))

	return resultOpenPromise.promise
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

	function processChunk(chunk: Uint8Array) {
		result.addArray(chunk)
	}

	await readFileInChunks(filePath, chunkSize, processChunk)

	return result.toTypedArray()
}

export async function readFileAsUtf8(filePath: string) {
	const chunkSize = 2 ** 20

	const result = new ChunkedUtf8Decoder()

	function processChunk(chunk: Uint8Array) {
		result.writeChunk(chunk)
	}

	await readFileInChunks(filePath, chunkSize, processChunk)

	return result.toString()
}

export async function readFileInChunks(filePath: string, chunkSize: number, processChunk: (chunk: Uint8Array) => void) {
	const openPromise = new OpenPromise<void>()

	const readStream = createReadStream(filePath, { highWaterMark: chunkSize });

	readStream.on('data', (chunk: Uint8Array) => {
		processChunk(chunk)
	})

	readStream.on('end', () => {
		openPromise.resolve()
	})

	readStream.on('error', (err: Error) => {
		openPromise.reject(err)
	})

	return openPromise.promise
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

	let offset = 0

	async function getChunk() {
		const chunk = content.subarray(offset, offset + chunkSize)

		if (chunk.length === 0) {
			return undefined
		}

		offset += chunkSize

		return chunk
	}

	return writeFileInChunks(filePath, getChunk)
}

export async function writeUtf8File(filePath: string, content: string) {
	const chunkSize = 2 ** 20

	const fileDir = path.dirname(filePath)

	await ensureDir(fileDir)

	let offset = 0

	const textEncoder = new TextEncoder()

	async function getChunk() {
		const stringChunk = content.substring(offset, offset + chunkSize)

		if (stringChunk.length === 0) {
			return undefined
		}

		const chunk = textEncoder.encode(stringChunk)

		offset += chunkSize

		return chunk
	}

	return writeFileInChunks(filePath, getChunk)
}

export async function writeFileInChunks(filePath: string, getChunk: () => Promise<Uint8Array | undefined>) {
	const openPromise = new OpenPromise<void>()

	const fileDir = path.dirname(filePath)

	try {
		await ensureDir(fileDir)
	} catch (e) {
		openPromise.reject(e)

		return
	}

	const writeStream = createWriteStream(filePath)

	writeStream.on('error', (err) => {
		openPromise.reject(err)
	})

	writeStream.on('finish', () => {
		openPromise.resolve()
	})

	async function writeNextChunk() {
		let chunkToWrite: Uint8Array | undefined

		try {
			chunkToWrite = await getChunk()
		} catch (e) {
			openPromise.reject(e)

			return
		}

		if (chunkToWrite === undefined) {
			writeStream.end(() => {
				openPromise.resolve()
			})

			return
		}

		writeStream.write(chunkToWrite, () => {
			writeNextChunk()
		})
	}

	writeNextChunk()

	return openPromise.promise
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

export async function copyFileAlternative(source: string, dest: string) {
	return new Promise<void>((resolve, reject) => {
		const readStream = createReadStream(source)
		const writeStream = createWriteStream(dest)

		readStream.on('error', (err: any) => {
			reject(err)
		})

		writeStream.on('error', (err: any) => {
			reject(err)
		})

		readStream.pipe(writeStream)

		readStream.on('end', () => {
			resolve()
		})
	})
}
