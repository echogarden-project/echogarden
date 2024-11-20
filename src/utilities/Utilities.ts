import * as readline from 'node:readline'
import { IncomingMessage } from 'node:http'

import { RandomGenerator } from './RandomGenerator.js'
import { randomUUID, randomBytes } from 'node:crypto'
import { Logger } from './Logger.js'
import { ChildProcessWithoutNullStreams } from 'node:child_process'
import { inspect } from 'node:util'
import { TypedArray, TypedArrayConstructor } from '../typings/TypedArray.js'
import { encodeHex } from '../encodings/Hex.js'

const log = logToStderr

export function concatUint8Arrays(arrays: Uint8Array[]) {
	return concatTypedArrays<Uint8Array>(Uint8Array, arrays)
}

export function concatFloat32Arrays(arrays: Float32Array[]) {
	return concatTypedArrays<Float32Array>(Float32Array, arrays)
}

function concatTypedArrays<T extends TypedArray>(TypedArrayConstructor: TypedArrayConstructor<T>, arrays: T[]) {
	let totalLength = 0

	for (const array of arrays) {
		totalLength += array.length
	}

	const result = new TypedArrayConstructor(totalLength)

	let writeOffset = 0

	for (const array of arrays) {
		result.set(array, writeOffset)

		writeOffset += array.length
	}

	return result as T
}

export function shuffleArray<T>(array: T[], randomGen: RandomGenerator) {
	return shuffleArrayInPlace(array.slice(), randomGen)
}

export function shuffleArrayInPlace<T>(array: T[], randomGen: RandomGenerator) {
	const vectorCount = array.length

	for (let i = 0; i < vectorCount - 1; i++) {
		const value = array[i]
		const targetIndex = randomGen.getIntInRange(i + 1, vectorCount)

		array[i] = array[targetIndex]
		array[targetIndex] = value
	}

	return array
}

export function writeToStderr(message: any) {
	process.stderr.write(message)
}

export function printToStderr(message: any) {
	if (typeof message == 'string') {
		writeToStderr(message)
	} else {
		writeToStderr(formatObjectToString(message))
	}
}

export function logToStderr(message: any) {
	printToStderr(message)
	writeToStderr('\n')
}

export function formatObjectToString(obj: any) {
	const formattedString = inspect(obj, {
		showHidden: false,
		depth: null,
		colors: false,
		maxArrayLength: null,
		maxStringLength: null,
		compact: 5,
	})

	return formattedString
}

export function getRandomHexString(charCount = 32) {
	if (charCount % 2 !== 0) {
		throw new Error(`'charCount' must be an even number`)
	}

	const randomHex = encodeHex(randomBytes(charCount / 2))

	return randomHex
}

export function getRandomUUID(dashes = true) {
	let uuid = randomUUID() as string

	if (dashes == false) {
		uuid = uuid.replaceAll('-', '')
	}

	return uuid
}

export function sumArray<T>(arr: Array<T>, valueGetter: (item: T) => number) {
	let sum = 0

	for (let i = 0; i < arr.length; i++) {
		sum += valueGetter(arr[i])
	}

	return sum
}

export function roundToDigits(val: number, digits = 3) {
	const multiplier = 10 ** digits

	return Math.round(val * multiplier) / multiplier
}

export function delay(timeMs: number) {
	return new Promise((resolve) => {
		setTimeout(resolve, timeMs)
	})
}

export function yieldToEventLoop() {
	return new Promise((resolve) => {
		setImmediate(resolve)
	})
}

export function printMatrix(matrix: Float32Array[]) {
	const rowCount = matrix.length

	for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
		log(matrix[rowIndex].join(', '))
	}
}

export async function parseJson(jsonText: string, useJson5 = false) {
	if (useJson5) {
		const { default: JSON5 } = await import('json5')

		return JSON5.parse(jsonText)
	} else {
		return JSON.parse(jsonText)
	}
}

export async function stringifyAndFormatJson(obj: any, useJson5 = false) {
	let textContent: string

	if (useJson5) {
		const { default: JSON5 } = await import('json5')

		textContent = JSON5.stringify(obj, undefined, 4)
	} else {
		textContent = JSON.stringify(obj, undefined, 4)
	}

	return textContent
}

export async function parseJSONAndGetType(str: string, useJson5 = false) {
	let parsedValue: any = undefined

	try {
		parsedValue = await parseJson(str, useJson5)
	} catch (e) {
	}

	let jsonType: 'null' | 'string' | 'number' | 'boolean' | 'array' | 'object' | undefined = undefined

	if (parsedValue === null) {
		jsonType = 'null'
	} else if (typeof parsedValue === 'string') {
		jsonType = 'string'
	} else if (typeof parsedValue === 'number') {
		jsonType = 'number'
	} else if (typeof parsedValue === 'boolean') {
		jsonType = 'boolean'
	} else if (Array.isArray(parsedValue)) {
		jsonType = 'array'
	} else if (typeof parsedValue === 'object') {
		jsonType = 'object'
	}

	return {
		parsedValue,
		jsonType
	}
}


export function secondsToHMS(totalSeconds: number) {
	let remainingSeconds = totalSeconds

	const hours = Math.floor(remainingSeconds / 60 / 60)
	remainingSeconds -= hours * 60 * 60

	const minutes = Math.floor(remainingSeconds / 60)
	remainingSeconds -= minutes * 60

	const seconds = Math.floor(remainingSeconds)
	remainingSeconds -= seconds

	const milliseconds = Math.floor(remainingSeconds * 1000)

	return { hours, minutes, seconds, milliseconds }
}

export function secondsToMS(totalSeconds: number) {
	const { hours, minutes, seconds, milliseconds } = secondsToHMS(totalSeconds)

	return { minutes: (hours * 60) + minutes, seconds, milliseconds }
}

export function intsInRange(start: number, end: number) {
	const result: number[] = []

	for (let i = start; i < end; i++) {
		result.push(i)
	}

	return result
}

export function serializeMapToObject<V>(map: Map<string, V>) {
	const obj: { [key: string]: V } = {}

	for (const [key, value] of map) {
		obj[key] = value
	}

	return obj
}

export function deserializeObjectToMap<V>(obj: { [key: string]: V }) {
	const map = new Map<string, V>()

	for (const key in obj) {
		map.set(key, obj[key])
	}

	return map
}

export function waitTimeout(timeout = 0) {
	return new Promise<void>((resolve) => setTimeout(() => {
		resolve()
	}, timeout))
}

export function waitImmediate() {
	return new Promise<void>((resolve) => setImmediate(() => {
		resolve()
	}))
}

export function waitNextTick() {
	return new Promise<void>((resolve) => process.nextTick(() => resolve()))
}

export function setupUnhandledExceptionListeners() {
	process.on('unhandledRejection', (e: any) => {
		log(`Unhandled promise rejection:\n ${e}`)
		process.exit(1)
	})

	process.on('uncaughtException', function (e) {
		log(`Uncaught exception:\n ${e}`)
		process.exit(1)
	})
}

export function setupProgramTerminationListeners(cleanupFunc?: () => void) {
	function exitProcess(exitCode = 0) {
		if (cleanupFunc) {
			cleanupFunc()
		}

		process.exit(exitCode)
	}

	process.on('SIGINT', () => exitProcess(0))
	process.on('SIGQUIT', () => exitProcess(0))
	process.on('SIGTERM', () => exitProcess(0))

	if (process.stdin.isTTY) {
		readline.emitKeypressEvents(process.stdin)

		process.stdin.setRawMode(true)

		process.stdin.on('keypress', (str, key) => {
			if (key.name == 'escape') {
				exitProcess(0)
			}

			if (key.ctrl == true && key.name == 'c') {
				exitProcess(0)
			}
		})
	}
}

export function clip(num: number, min: number, max: number) {
	if (num < min) {
		return min
	}

	if (num > max) {
		return max
	}

	return num
}

export function readBinaryIncomingMessage(incomingMessage: IncomingMessage) {
	return new Promise<Uint8Array>((resolve, reject) => {
		const chunks: Uint8Array[] = []

		incomingMessage.on('data', (chunk) => {
			chunks.push(Uint8Array.from(chunk))
		})

		incomingMessage.on('end', () => {
			resolve(concatUint8Arrays(chunks))
		})

		incomingMessage.on('error', (e) => {
			reject(e)
		})
	})
}

export function splitFloat32Array(nums: Float32Array, partSize: number): Float32Array[] {
	const result: Float32Array[] = []

	for (let offset = 0; offset < nums.length; offset += partSize) {
		result.push(nums.subarray(offset, offset + partSize))
	}

	return result
}

export async function sha256AsHex(input: string) {
	const crypto = await import('crypto')
	const hash = crypto.createHash('sha256').update(input).digest('hex')

	return hash
}

export async function commandExists(command: string) {
	const { default: commandExists } = await import('command-exists')

	try {
		await commandExists(command)
		return true
	} catch {
		return false
	}
}

export async function resolveModuleMainPath(moduleName: string) {
	const { resolve } = await import('import-meta-resolve')
	const { fileURLToPath } = await import('url')

	return fileURLToPath(resolve(moduleName, import.meta.url))
}

export function getWithDefault<T>(value: T | undefined, defaultValue: T) {
	if (value === undefined) {
		return defaultValue
	} else {
		return value
	}
}

export function splitFilenameOnExtendedExtension(filenameWithExtension: string) {
	let splitPoint = filenameWithExtension.length

	for (let i = filenameWithExtension.length - 1; i >= 0; i--) {
		if (filenameWithExtension[i] == '.') {
			if (/^[a-zA-Z0-9\.]+$/.test(filenameWithExtension.slice(i + 1))) {
				splitPoint = i

				continue
			} else {
				break
			}
		}
	}

	const name = filenameWithExtension.slice(0, splitPoint)
	const ext = filenameWithExtension.slice(splitPoint + 1)

	return [name, ext]
}

export async function resolveModuleScriptPath(moduleName: string) {
	const { resolve } = await import('import-meta-resolve')

	const scriptPath = resolve(moduleName, import.meta.url)

	const { fileURLToPath } = await import('url')

	return fileURLToPath(scriptPath)
}

export async function runOperationWithRetries<R>(
	operationFunc: () => Promise<R>,
	logger: Logger,
	operationName = 'Operation',
	delayBetweenRetries = 2000,
	maxRetries = 200) {

	const { default: chalk } = await import('chalk')

	for (let retryIndex = 1; retryIndex <= maxRetries; retryIndex++) {
		try {
			const result = await operationFunc()

			return result
		} catch (e: any) {
			const { shouldCancelCurrentTask } = await import('../server/Worker.js')

			if (shouldCancelCurrentTask()) {
				throw new Error('Canceled')
			}

			logger.setAsActiveLogger()

			logger.logTitledMessage(`Error`, e.message, chalk.redBright, 'error')
			logger.log('', 'error')
			logger.logTitledMessage(`${operationName} failed`, `Trying again in ${delayBetweenRetries}ms..`, chalk.redBright, 'error')

			await delay(delayBetweenRetries)

			logger.log(``, 'warning')
			logger.logTitledMessage(`Starting retry attempt`, `${retryIndex} / ${maxRetries}`, chalk.yellowBright, 'warning')
			logger.log(``, 'warning')

			logger.unsetAsActiveLogger()
		}
	}

	throw new Error(`${operationName} failed after ${maxRetries} retry attempts`)
}

export function writeToStdinInChunks(process: ChildProcessWithoutNullStreams, buffer: Uint8Array, chunkSize: number) {
	const writeChunk = (chunkOffset: number) => {
		if (chunkOffset >= buffer.length) {
			process.stdin.end() // End the stream after writing all chunks

			return
		}

		const startOffset = chunkOffset
		const endOffset = Math.min(chunkOffset + chunkSize, buffer.length)

		const chunk = buffer.subarray(startOffset, endOffset)

		if (!process.stdin.writable) {
			return
		}

		process.stdin.write(chunk, () => writeChunk(endOffset))
	}

	writeChunk(0)
}

export function getIntegerRange(start: number, end: number) {
	const result: number[] = []

	for (let i = start; i < end; i++) {
		result.push(i)
	}

	return result
}

export function isUint8Array(value: any): value is Uint8Array {
	return value instanceof Uint8Array
}

export async function isWasmSimdSupported() {
	const wasmFeatureDetect = await import('wasm-feature-detect')

	return wasmFeatureDetect.simd()
}
