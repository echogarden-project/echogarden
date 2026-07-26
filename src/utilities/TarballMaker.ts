import { createTarball } from './Compression.js'
import { ensureDir, move, readdir, stat } from './FileSystem.js'
import { appName, OperationCallbacks } from '../api/Common.js'
import { getRandomHexString } from './Utilities.js'
import { getAppTempDir, getFileNameWithoutExtension, joinPath } from './PathUtilities.js'

export async function createNamedTarball(inputPath: string, name: string, tarballDir: string, callbacks: OperationCallbacks) {
	const tempDir = getAppTempDir(appName)
	await ensureDir(tempDir)
	const tempFilename = joinPath(tempDir, getRandomHexString(16))

	await createTarball(inputPath, tempFilename, name, callbacks)

	const targetFilname = joinPath(tarballDir, `${name}.tar.gz`)

	await move(tempFilename, targetFilname)
}

export async function createTarballForEachDirIn(baseDir: string, namePrefix: string, tarballDir: string, callbacks: OperationCallbacks) {
	for (const dirName of await readdir(baseDir)) {
		const dirPath = joinPath(baseDir, dirName)

		const fileStat = await stat(dirPath)

		if (!fileStat.isDirectory()) {
			continue
		}

		const archiveName = `${namePrefix}-${dirName}`

		await createNamedTarball(dirPath, archiveName, tarballDir, callbacks)
	}
}

export async function createTarballForEachFileIn(baseDir: string, namePrefix: string, tarballDir: string, callbacks: OperationCallbacks) {
	for (const filename of await readdir(baseDir)) {
		const filenameWithoutExtension = getFileNameWithoutExtension(filename)

		const filePath = joinPath(baseDir, filename)

		const fileStat = await stat(filePath)

		if (!fileStat.isFile()) {
			continue
		}

		const archiveName = `${namePrefix}-${filenameWithoutExtension}`

		await createNamedTarball(filePath, archiveName, tarballDir, callbacks)
	}
}
