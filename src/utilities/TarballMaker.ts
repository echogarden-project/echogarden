import path from 'path'
import { createTarball } from './Compression.js'
import { ensureDir, existsSync, move, readdir, stat } from './FileSystem.js'
import { ensureAndGetPackagesDir } from './PackageManager.js'
import { appName } from '../api/Common.js'
import { getRandomHexString } from './Utilities.js'
import { getAppTempDir } from './PathUtilities.js'

const tarballDir = '../resources/tarballs'

export async function makeTarballsForInstalledPackages(skipIfExists = false) {
	const packagesDir = await ensureAndGetPackagesDir()
	const packageList = await readdir(packagesDir)

	for (const packageName of packageList) {
		if (skipIfExists && existsSync(path.join(tarballDir, `${packageName}.tar.gz`))) {
			continue
		}

		const packagePath = path.join(packagesDir, packageName)
		await createNamedTarball(packagePath, packageName)
	}
}

export async function createNamedTarball(inputPath: string, name: string) {
	const tempDir = getAppTempDir(appName)
	await ensureDir(tempDir)
	const tempFilename = path.join(tempDir, getRandomHexString(16))

	await createTarball(inputPath, tempFilename, name)

	const targetFilname = path.join(tarballDir, `${name}.tar.gz`)

	await move(tempFilename, targetFilname)
}

export async function createTarballForEachDirIn(baseDir: string, namePrefix: String) {
	for (const dirName of await readdir(baseDir)) {
		const dirPath = path.join(baseDir, dirName)

		const fileStat = await stat(dirPath)

		if (!fileStat.isDirectory()) {
			continue
		}

		const archiveName = `${namePrefix}-${dirName}`

		await createNamedTarball(dirPath, archiveName)
	}
}

export async function createTarballForEachFileIn(baseDir: string, namePrefix: String) {
	for (const filename of await readdir(baseDir)) {
		const filenameWithoutExtension = path.parse(filename).name

		const filePath = path.join(baseDir, filename)

		const fileStat = await stat(filePath)

		if (!fileStat.isFile()) {
			continue
		}

		const archiveName = `${namePrefix}-${filenameWithoutExtension}`

		await createNamedTarball(filePath, archiveName)
	}
}
