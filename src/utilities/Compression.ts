import path from 'node:path'
import { Logger } from './Logger.js'
import { readdir, stat } from './FileSystem.js'

export async function createTarball(filePath: string, outputFile: string, prefixPath = "") {
	const pathStat = await stat(filePath)

	if (pathStat.isDirectory()) {
		await createTarballForDir(filePath, outputFile, prefixPath)
	} else {
		await createTarballForFile(filePath, outputFile, prefixPath)
	}
}

export async function createTarballForFile(filePath: string, outputFile: string, prefixPath = "") {
	const logger = new Logger()

	logger.start(`Creating ${prefixPath || path.basename(outputFile)}`)

	const { default: tar } = await import('tar')

	const inputFileStat = await stat(filePath)

	if (!inputFileStat.isFile()) {
		throw new Error(`${filePath} is not a file`)
	}

	const filename = path.basename(filePath)
	const dirname = path.dirname(filePath)

	await tar.create({
		gzip: { level: 9, memLevel: 9 },
		file: outputFile,
		cwd: dirname,
		prefix: prefixPath,
		mode: 0o775,

		filter: (path, stat) => {
			stat.mode |= 0o775

			return true
		}

	}, [filename])

	logger.end()
}

export async function createTarballForDir(inputDir: string, outputFile: string, prefixPath = "") {
	const logger = new Logger()

	logger.start(`Creating ${prefixPath || path.basename(outputFile)}`)

	const { default: tar } = await import('tar')

	const inputDirStat = await stat(inputDir)

	if (!inputDirStat.isDirectory()) {
		throw new Error(`${inputDir} is not a directory`)
	}

	const filesInBaseDir = await readdir(inputDir)

	await tar.create({
		gzip: { level: 9, memLevel: 9 },
		file: outputFile,
		cwd: inputDir,
		prefix: prefixPath,
		mode: 0o775,

		filter: (path, stat) => {
			stat.mode |= 0o775

			return true
		}

	}, filesInBaseDir)

	logger.end()
}

export async function extractTarball(filepath: string, outputDir: string) {
	const { default: tar } = await import('tar')

	await tar.extract({
		file: filepath,
		cwd: outputDir,
		preserveOwner: false,
		//noChmod: true
	})
}
