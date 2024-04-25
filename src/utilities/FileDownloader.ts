import { GaxiosOptions, request } from 'gaxios'
import { Readable } from 'stream'
import { getRandomHexString, writeToStderr } from './Utilities.js'
import { OpenPromise } from './OpenPromise.js'

import { Timer } from './Timer.js'
import { Logger } from './Logger.js'
import path from 'node:path'
import { extractTarball } from './Compression.js'
import { createWriteStream, move, remove, readdir, ensureDir } from './FileSystem.js'
import chalk from 'chalk'
import { logLevelGreaterOrEqualTo } from '../api/GlobalOptions.js'

export async function downloadAndExtractTarball(options: GaxiosOptions, targetDir: string, baseTempPath: string, displayName = 'archive') {
	const logger = new Logger()

	const randomID = getRandomHexString(16).toLowerCase()
	const tempTarballPath = path.join(baseTempPath, `/${randomID}.tarball`)
	const tempDirPath = path.join(baseTempPath, `/${randomID}`)
	await ensureDir(tempDirPath)

	logger.end()

	await downloadFile(options, tempTarballPath, `${chalk.cyanBright('Downloading')} ${chalk.greenBright(displayName)}`)

	logger.end()

	logger.start(`Extracting ${displayName}`)

	await extractTarball(tempTarballPath, tempDirPath)

	await remove(tempTarballPath)

	for (const filename of await readdir(tempDirPath)) {
		const sourceFilePath = path.join(tempDirPath, filename)
		const targetFilePath = path.join(targetDir, filename)

		await move(sourceFilePath, targetFilePath)
	}

	await remove(tempDirPath)

	logger.end()
}

export async function downloadFile(options: GaxiosOptions, targetFilePath: string, prompt = 'Downloading') {
	const write = logLevelGreaterOrEqualTo('info') ? writeToStderr : () => {}

	const downloadPromise = new OpenPromise<void>()

	const timer = new Timer()

	options.responseType = 'stream'

	const response = await request<Readable>(options)

	const ttyOutput = process.stderr.isTTY === true

	write(`\n${prompt}.. `)

	const rateAveragingWindowSeconds = 5.0

	let downloadStarted = false
	let downloadedBytes = 0
	let totalBytes: number | undefined = undefined

	const statusUpdateInterval = 250

	let lastString = prompt

	const downloadStateHistory: { time: number, downloadedMBytes: number }[] = []

	function updateStatus() {
		if (!downloadStarted) {
			return
		}

		const totalMBytes = (totalBytes || 0) / 1000 / 1000
		const downloadedMBytes = downloadedBytes / 1000 / 1000

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

			if (totalBytes != undefined) {
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
			if (totalBytes == undefined) {
				return
			}

			const percent = downloadedBytes / totalBytes
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

	const partialFilePath = `${targetFilePath}.${getRandomHexString(16)}.partial`
	const fileWriteStream = createWriteStream(partialFilePath, { encoding: 'binary', autoClose: true })

	let statusInterval = setInterval(() => {
		updateStatus()
	}, statusUpdateInterval)

	response.data.on('data', (chunk: Uint8Array) => {
		try {
			const contentLengthString = response.headers['content-length']

			totalBytes = contentLengthString != undefined ? parseInt(contentLengthString) : undefined

			const chunkLength = chunk.length

			fileWriteStream.write(chunk)

			downloadedBytes += chunkLength

			if (downloadStarted == false) {
				downloadStarted = true
			}
		} catch (err) {
			clearInterval(statusInterval)

			downloadPromise.reject(err)
		}
	})

	response.data.on('end', async () => {
		try {
			clearInterval(statusInterval)
			updateStatus()

			fileWriteStream.end()

			write('\n')

			await move(partialFilePath, targetFilePath)

			downloadPromise.resolve()
		} catch (err) {
			clearInterval(statusInterval)
			downloadPromise.reject(err)
		}
	})

	response.data.on('error', async (err: any) => {
		try {
			clearInterval(statusInterval)

			fileWriteStream.end()
			await remove(partialFilePath)
		} finally {
			downloadPromise.reject(err)
		}
	})

	return downloadPromise.promise
}
