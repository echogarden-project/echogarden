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

export const createReadStream = gracefulFS.createReadStream
export const createWriteStream = gracefulFS.createWriteStream
export const existsSync = gracefulFS.existsSync

export const ensureDir = fsExtra.ensureDir
export const move = fsExtra.move
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

export async function readAndParseJsonFile(jsonFilePath: string) {
	const fileContent = await readFile(jsonFilePath, { encoding: "utf-8" })

	return JSON.parse(fileContent)
}

export async function writeFile(filePath: string, data: string | NodeJS.ArrayBufferView, options?: fsExtra.WriteFileOptions) {
	return outputFile(filePath, data, options)
}

export async function writeFileSafe(filePath: string, data: string | NodeJS.ArrayBufferView, options?: fsExtra.WriteFileOptions) {
	const tempDir = getAppTempDir(appName)
	const tempFilePath = `${tempDir}${getRandomHexString(16)}.partial`

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
