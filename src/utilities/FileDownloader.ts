import { getRandomHexString, writeToStderr } from './Utilities.js'

import { Timer } from './Timer.js'
import { Logger, LogLevel, logLevelGreaterOrEqualTo } from './Logger.js'
import { extractTarball } from './Compression.js'
import { move, remove, readdir, ensureDir } from './FileSystem.js'
import chalk from 'chalk'
import { FileWriter } from './FileWriter.js'
import { joinPath } from './PathUtilities.js'
import { EasierHttpRequestError, EasierHttpRequestConfig, requestHttp } from 'easier-http-request'
import { OperationCallbacks } from '../api/Common.js'

export async function downloadAndExtractTarball(options: EasierHttpRequestConfig, targetDir: string, baseTempPath: string, displayName = 'archive', callbacks: FileDownloaderCallbacks) {
	const logger = new Logger(callbacks.logLevel)

	const randomID = getRandomHexString(16).toLowerCase()
	const tempTarballPath = joinPath(baseTempPath, `/${randomID}.tarball`)
	const tempDirPath = joinPath(baseTempPath, `/${randomID}`)
	await ensureDir(tempDirPath)

	logger.end()

	await downloadFile(
		options,
		tempTarballPath,
		`${chalk.cyanBright('Downloading')} ${chalk.greenBright(displayName)}`,
		callbacks
	)

	logger.end()

	logger.start(`Extracting ${displayName}`)

	await extractTarball(tempTarballPath, tempDirPath)

	await remove(tempTarballPath)

	for (const filename of await readdir(tempDirPath)) {
		const sourceFilePath = joinPath(tempDirPath, filename)
		const targetFilePath = joinPath(targetDir, filename)

		await move(sourceFilePath, targetFilePath)
	}

	await remove(tempDirPath)

	logger.end()
}

export async function downloadFile(requestConfig: EasierHttpRequestConfig, targetFilePath: string, prompt = 'Downloading', callbacks: FileDownloaderCallbacks) {
	const write = logLevelGreaterOrEqualTo(callbacks.logLevel ?? 'warning', 'info') ? writeToStderr : () => { }

	const timer = new Timer()

	const response = await requestHttp(requestConfig)

	const ttyOutput = process.stderr.isTTY === true

	write(`\n${prompt}.. `)

	const rateAveragingWindowSeconds = 5.0

	let downloadStarted = false
	let downloadedByteCount = 0
	let totalByteCount: number | undefined = undefined

	const statusUpdateInterval = 250

	let lastString = prompt

	const downloadStateHistory: { time: number, downloadedMBytes: number }[] = []

	function updateStatus() {
		if (!downloadStarted) {
			return
		}

		const totalMBytes = (totalByteCount ?? 0) / 1000 / 1000
		const downloadedMBytes = downloadedByteCount / 1000 / 1000

		const elapsedTime = timer.elapsedTimeSeconds
		const cumulativeDownloadRate = downloadedMBytes / elapsedTime

		const windowStartRecord = downloadStateHistory.find(r => r.time >= timer.elapsedTimeSeconds - rateAveragingWindowSeconds)

		let windowDownloadRate: number

		if (windowStartRecord) {
			windowDownloadRate = (downloadedMBytes - windowStartRecord.downloadedMBytes) / (elapsedTime - windowStartRecord.time)
		} else {
			windowDownloadRate = cumulativeDownloadRate
		}

		downloadStateHistory.push({ time: elapsedTime, downloadedMBytes })

		const isLastUpdate = downloadedMBytes == totalMBytes

		const downloadedMbytesStr = downloadedMBytes.toFixed(2)
		const totalMbytesStr = totalMBytes.toFixed(2)
		const downloadRateStr = windowDownloadRate.toFixed(2)
		const cumulativeDownloadRateStr = cumulativeDownloadRate.toFixed(2)

		if (ttyOutput) {
			let newString: string

			if (totalByteCount != undefined) {
				const percentage = (downloadedMBytes / totalMBytes) * 100

				newString = `${prompt}.. ${downloadedMbytesStr}MB/${totalMbytesStr}MB (${chalk.blueBright(percentage.toFixed(1) + '%')}, ${timer.elapsedTimeSeconds.toFixed(1)}s, ${downloadRateStr}MB/s)`
			} else {
				newString = `${prompt}.. ${downloadedMbytesStr}MB (${timer.elapsedTimeSeconds.toFixed(1)}s, ${downloadRateStr}MB/s)`
			}

			if (newString != lastString) {
				write('\r')
				write(newString)
			}

			lastString = newString
		} else {
			if (totalByteCount == undefined) {
				return
			}

			const percent = downloadedByteCount / totalByteCount
			const percentDisplay = `${(Math.floor(percent * 10) * 10).toString()}%`

			if (lastString == prompt) {
				write(`(${totalMbytesStr}MB): `)
			}

			if (percentDisplay != lastString) {
				write(percentDisplay)

				if (percent == 1.0) {
					write(` (${timer.elapsedTimeSeconds.toFixed(2)}s, ${cumulativeDownloadRateStr}MB/s)`)
				} else {
					write(` `)
				}

				lastString = percentDisplay
			}
		}
	}

	const contentLengthString = response.headers.get('content-length')
	totalByteCount = contentLengthString != undefined ? parseInt(contentLengthString) : undefined

	const partialFilePath = `${targetFilePath}.${getRandomHexString(16)}.partial`
	const fileWriter = new FileWriter(partialFilePath)

	let statusInterval = setInterval(() => {
		updateStatus()
	}, statusUpdateInterval)

	try {
		const responseBodyReader = response.body!.getReader()

		while (true) {
			const readableStreamResult = await responseBodyReader.read()

			if (downloadStarted === false) {
				downloadStarted = true
			}

			if (readableStreamResult.done) {
				break
			}

			const chunk = readableStreamResult.value

			downloadedByteCount += chunk.length

			await fileWriter.write(chunk)
		}
	} catch (e) {
		clearInterval(statusInterval)

		await fileWriter.dispose()

		throw e
	}

	clearInterval(statusInterval)
	updateStatus()

	await fileWriter.dispose()

	write('\n')

	await move(partialFilePath, targetFilePath)
}

export interface FileDownloaderCallbacks extends OperationCallbacks {
}
