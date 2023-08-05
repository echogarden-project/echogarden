import * as fsExtra from 'fs-extra/esm'
import gracefulFS from 'graceful-fs'
import * as os from 'node:os'

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { OpenPromise } from './OpenPromise.js'
import { getRandomHexString, sha256AsHex } from './Utilities.js'
import { appName } from '../api/Common.js'

export const readFile = promisify(gracefulFS.readFile)
//export const writeFile = promisify(gracefulFS.writeFile)
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
export const outputFile = fsExtra.outputFile

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

export function getModuleRootDir() {
	const currentScriptDir = path.dirname(fileURLToPath(import.meta.url))
	return path.resolve(currentScriptDir, '..', '..')
}

export function resolveToModuleRootDir(relativePath: string) {
	return path.resolve(getModuleRootDir(), relativePath)
}

export function getLowercaseFileExtension(filename: string) {
	const fileExtensionIndex = filename.lastIndexOf(".")

	if (fileExtensionIndex == -1) {
		return ""
	}

	return filename.substring(fileExtensionIndex + 1).toLowerCase()
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
	const fileContent = await readFile(jsonFilePath, { encoding: "utf-8" })

	if (useJson5) {
		const { default: JSON5 } = await import('json5')

		return JSON5.parse(fileContent)
	} else {
		return JSON.parse(fileContent)
	}
}

export async function writeFile(filePath: string, data: string | NodeJS.ArrayBufferView, options?: fsExtra.WriteFileOptions) {
	return outputFile(filePath, data, options)
}

export async function writeFileSafe(filePath: string, data: string | NodeJS.ArrayBufferView, options?: fsExtra.WriteFileOptions) {
	const tempDir = getAppTempDir(appName)
	const tempFilePath = path.join(tempDir, `${getRandomHexString(16)}.partial`)

	await writeFile(tempFilePath, data, options)

	await move(tempFilePath, filePath, { overwrite: true })
}

export function getAppTempDir(appName: string) {
	let tempDir: string

	const platform = process.platform
	const homeDir = os.homedir()

	if (platform == "win32") {
		tempDir = path.join(homeDir, "AppData", "Local", "Temp", appName)
	} else if (platform == "darwin") {
		tempDir = path.join(homeDir, "Library", "Caches", appName)
	} else if (platform == "linux") {
		tempDir = path.join(homeDir, ".cache", appName)
	} else {
		throw new Error(`Unsupport platform ${platform}`)
	}

	return tempDir
}

export function getAppDataDir(appName: string) {
	let dataDir: string

	const platform = process.platform
	const homeDir = os.homedir()

	if (platform == "win32") {
		dataDir = path.join(homeDir, "AppData", "Local", appName)
	} else if (platform == "darwin") {
		dataDir = path.join(homeDir, "Library", "Application Support", appName)
	} else if (platform == "linux") {
		dataDir = path.join(homeDir, ".local", "share", appName)
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
			throw new Error( `${dirPath} exists but is not a directory.`)
		}
	} else {
		return fsExtra.ensureDir(dirPath)
	}
}

export async function move(source: string, dest: string, options?: fsExtra.MoveOptions) {
	source = path.normalize(source)
	dest = path.normalize(dest)

	if (existsSync(dest)) {
		const destPathExistsAndIsWritable = await existsAndIsWritable(dest)

		if (!destPathExistsAndIsWritable) {
			throw new Error(`The destination path '${dest}' exists but is not writable.`)
		}
	} else {
		const destPathIsCreatable = await tryCreatePath(dest)

		if (!destPathIsCreatable) {
			throw new Error(`Couldn't create '${dest}'. Its parent directory may not be writable.`)
		}
	}

	return fsExtra.move(source, dest, options)
}

export async function existsAndIsWritable(targetPath: string) {
	try {
		await access(targetPath, gracefulFS.constants.W_OK);
	} catch {
		return false
	}

	return true
}

export async function tryCreatePath(targetPath: string) {
	try {
		await fsExtra.createFile(targetPath)
	} catch {
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
