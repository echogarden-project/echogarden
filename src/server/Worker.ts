import { RequestVoiceListResult, SynthesisOptions, SynthesisSegmentCallbackData, SynthesisResult, VoiceListRequestOptions, requestVoiceList, synthesize, VoiceListRequestCallbacks, SynthesisCallbacks } from '../api/Synthesis.js'
import { Queue } from '../data-structures/Queue.js'
import { logToStderr, yieldToEventLoop } from '../utilities/Utilities.js'
import { AudioSourceParam } from '../audio/AudioUtilities.js'
import { RecognitionCallbacks, RecognitionOptions, RecognitionResult, recognize } from '../api/Recognition.js'
import { AlignmentCallbacks, AlignmentOptions, AlignmentResult, align } from '../api/Alignment.js'
import { SpeechTranslationCallbacks, SpeechTranslationOptions, SpeechTranslationResult, translateSpeech } from '../api/SpeechTranslation.js'
import { writeToStderr } from '../utilities/Utilities.js'
import { SpeechLanguageDetectionCallbacks, SpeechLanguageDetectionOptions, SpeechLanguageDetectionResult, detectSpeechLanguage } from '../api/SpeechLanguageDetection.js'
import { resolveToModuleRootDir } from '../utilities/PathUtilities.js'
import { TextLanguageDetectionCallbacks, TextLanguageDetectionOptions, TextLanguageDetectionResult, detectTextLanguage } from '../api/TextLanguageDetection.js'
import { OperationCallbacks } from '../api/Common.js'
import { getGlobalLogLevel } from '../api/GlobalOptions.js'
import { Logger } from '../utilities/Logger.js'

const log = logToStderr

let messageChannel: MessageChannel | undefined = undefined

const canceledRequests = new Set<string>()

const messageQueue = new Queue<any>()
let isProcessing = false

export function startMessageChannel() {
	if (messageChannel != null) {
		return
	}

	messageChannel = new MessageChannel()
	messageChannel.port1.start()
	messageChannel.port2.start()

	addListenerToClientMessages((message) => {
		if (message.messageType == 'CancelationRequest' || message.messageType == 'CancellationRequest') {
			//log(`CANCEL REQUESTED FOR ${message.requestId}`)
			canceledRequests.add(message.requestId)
			return
		}

		enqueueAndProcessIfIdle(message)
	})
}

function enqueueAndProcessIfIdle(message: any) {
	messageQueue.enqueue(message)
	processQueueIfIdle()
}

async function processQueueIfIdle() {
	if (isProcessing) {
		return
	}

	isProcessing = true

	while (!messageQueue.isEmpty) {
		const incomingMessage = messageQueue.dequeue()
		const requestId = incomingMessage.requestId

		function sendMessage(outgoingMessage: any) {
			sendMessageToClient({
				requestId,
				...outgoingMessage,
			})
		}

		const abortController = new AbortController()
		const abortSignal = abortController.signal

		const callbacks: OperationCallbacks = {
			logLevel: getGlobalLogLevel(),
			abortSignal: abortController.signal
		}

		function sendAbortSignalIfNeeded() {
			if (canceledRequests.has(requestId)) {
				abortController.abort()
				canceledRequests.delete(requestId)
			}
		}

		await yieldToEventLoop()

		sendAbortSignalIfNeeded()
		const abortSignalSenderInterval = setInterval(sendAbortSignalIfNeeded, 20)

		try {
			abortSignal.throwIfAborted()

			await processMessage(incomingMessage, sendMessage, callbacks)
		} catch (e: any) {
			const logger = new Logger(getGlobalLogLevel())

			logger.logTitledMessage('Error', e.message, 'error')

			sendMessageToClient({
				requestId,
				messageType: 'Error',
				error: e
			})
		} finally {
			clearInterval(abortSignalSenderInterval)
		}
	}

	isProcessing = false
}

export async function processMessage(message: WorkerRequestMessage, sendMessage: MessageFunc, callbacks: OperationCallbacks) {
	switch (message.messageType) {
		case 'SynthesisRequest': {
			await processSynthesisRequest(message, sendMessage, callbacks)
			break
		}

		case 'VoiceListRequest': {
			await processVoiceListRequest(message, sendMessage, callbacks)
			break
		}

		case 'RecognitionRequest': {
			await processRecognitionRequest(message, sendMessage, callbacks)
			break
		}

		case 'AlignmentRequest': {
			await processAlignmentRequest(message, sendMessage, callbacks)
			break
		}

		case 'SpeechTranslationRequest': {
			await processSpeechTranslationRequest(message, sendMessage, callbacks)
			break
		}

		case 'SpeechLanguageDetectionRequest': {
			await processSpeechLanguageDetectionRequest(message, sendMessage, callbacks)
			break
		}

		case 'TextLanguageDetectionRequest': {
			await processTextLanguageDetectionRequest(message, sendMessage, callbacks)
			break
		}

		default: {
			throw new Error(`Invalid message type: ${(message as any).messageType}`)
		}
	}
}

///////////////////////////////////////////////////////////////////////////////////////////////
// Synthesis operations
///////////////////////////////////////////////////////////////////////////////////////////////
async function processSynthesisRequest(message: SynthesisRequestMessage, sendMessage: MessageFunc, callbacks: SynthesisCallbacks) {
	async function onSegment(eventData: SynthesisSegmentCallbackData) {
		const responseMessage: SynthesisSegmentCallbackMessage = {
			messageType: 'SynthesisSegmentEvent',
			...eventData
		}

		sendMessage(responseMessage)
	}

	async function onSentence(eventData: SynthesisSegmentCallbackData) {
		const responseMessage: SynthesisSentenceCallbackMessage = {
			messageType: 'SynthesisSentenceEvent',
			...eventData
		}

		sendMessage(responseMessage)
	}

	const result = await synthesize(message.input, message.options, { ...callbacks, onSegment, onSentence })

	const responseMessage: SynthesisResponseMessage = {
		messageType: 'SynthesisResponse',
		...result
	}

	sendMessage(responseMessage)
}

// Synthesis message types
export interface SynthesisRequestMessage extends WorkerMessageBase {
	messageType: 'SynthesisRequest'
	input: string | string[]
	options: SynthesisOptions
}

export interface SynthesisResponseMessage extends WorkerMessageBase, SynthesisResult {
	messageType: 'SynthesisResponse'
}

export interface SynthesisSegmentCallbackMessage extends WorkerMessageBase, SynthesisSegmentCallbackData {
	messageType: 'SynthesisSegmentEvent'
}

export interface SynthesisSentenceCallbackMessage extends WorkerMessageBase, SynthesisSegmentCallbackData {
	messageType: 'SynthesisSentenceEvent'
}

async function processVoiceListRequest(message: VoiceListRequestMessage, sendMessage: MessageFunc, callbacks: VoiceListRequestCallbacks) {
	const result = await requestVoiceList(message.options, callbacks)

	const responseMessage: VoiceListResponseMessage = {
		messageType: 'VoiceListResponse',
		...result
	}

	sendMessage(responseMessage)
}

// Voice list message types
export interface VoiceListRequestMessage extends WorkerMessageBase {
	messageType: 'VoiceListRequest'
	options: VoiceListRequestOptions
}

export interface VoiceListResponseMessage extends WorkerMessageBase, RequestVoiceListResult {
	messageType: 'VoiceListResponse'
}

///////////////////////////////////////////////////////////////////////////////////////////////
// Recognition operations
///////////////////////////////////////////////////////////////////////////////////////////////
async function processRecognitionRequest(message: RecognitionRequestMessage, sendMessage: MessageFunc, callbacks: RecognitionCallbacks) {
	const result = await recognize(message.input, message.options, callbacks)

	const responseMessage: RecognitionResponseMessage = {
		messageType: 'RecognitionResponse',
		...result
	}

	sendMessage(responseMessage)
}

// Recognition message types
export interface RecognitionRequestMessage extends WorkerMessageBase {
	messageType: 'RecognitionRequest'
	input: AudioSourceParam
	options: RecognitionOptions
}

export interface RecognitionResponseMessage extends WorkerMessageBase, RecognitionResult {
	messageType: 'RecognitionResponse'
}

///////////////////////////////////////////////////////////////////////////////////////////////
// Alignment operations
///////////////////////////////////////////////////////////////////////////////////////////////
async function processAlignmentRequest(message: AlignmentRequestMessage, sendMessage: MessageFunc, callbacks: AlignmentCallbacks) {
	const result = await align(message.input, message.transcript, message.options, callbacks)

	const responseMessage: AlignmentResponseMessage = {
		messageType: 'AlignmentResponse',
		...result
	}

	sendMessage(responseMessage)
}

// Alignment message types
export interface AlignmentRequestMessage extends WorkerMessageBase {
	messageType: 'AlignmentRequest'
	input: AudioSourceParam
	transcript: string
	options: AlignmentOptions
}

export interface AlignmentResponseMessage extends WorkerMessageBase, AlignmentResult {
	messageType: 'AlignmentResponse'
}

///////////////////////////////////////////////////////////////////////////////////////////////
// Speech translation operations
///////////////////////////////////////////////////////////////////////////////////////////////
async function processSpeechTranslationRequest(message: SpeechTranslationRequestMessage, sendMessage: MessageFunc, callbacks: SpeechTranslationCallbacks) {
	const result = await translateSpeech(message.input, message.options, callbacks)

	const responseMessage: SpeechTranslationResponseMessage = {
		messageType: 'SpeechTranslationResponse',
		...result
	}

	sendMessage(responseMessage)
}

// Speech translation message types
export interface SpeechTranslationRequestMessage extends WorkerMessageBase {
	messageType: 'SpeechTranslationRequest'
	input: AudioSourceParam
	options: SpeechTranslationOptions
}

export interface SpeechTranslationResponseMessage extends WorkerMessageBase, SpeechTranslationResult {
	messageType: 'SpeechTranslationResponse'
}

///////////////////////////////////////////////////////////////////////////////////////////////
// Speech Language detection operations
///////////////////////////////////////////////////////////////////////////////////////////////
async function processSpeechLanguageDetectionRequest(message: SpeechLanguageDetectionRequestMessage, sendMessage: MessageFunc, callbacks: SpeechLanguageDetectionCallbacks) {
	const result = await detectSpeechLanguage(message.input, message.options, callbacks)

	const responseMessage: SpeechLanguageDetectionResponseMessage = {
		messageType: 'SpeechLanguageDetectionResponse',
		...result
	}

	sendMessage(responseMessage)
}

// Speech language detection message types
export interface SpeechLanguageDetectionRequestMessage extends WorkerMessageBase {
	messageType: 'SpeechLanguageDetectionRequest'
	input: AudioSourceParam
	options: SpeechLanguageDetectionOptions
}

export interface SpeechLanguageDetectionResponseMessage extends WorkerMessageBase, SpeechLanguageDetectionResult {
	messageType: 'SpeechLanguageDetectionResponse'
}

///////////////////////////////////////////////////////////////////////////////////////////////
// Text Language detection operations
///////////////////////////////////////////////////////////////////////////////////////////////
async function processTextLanguageDetectionRequest(message: TextLanguageDetectionRequestMessage, sendMessage: MessageFunc, callbacks: TextLanguageDetectionCallbacks) {
	const result = await detectTextLanguage(message.input, message.options, callbacks)

	const responseMessage: TextLanguageDetectionResponseMessage = {
		messageType: 'TextLanguageDetectionResponse',
		...result
	}

	sendMessage(responseMessage)
}

// Text language detection message types
export interface TextLanguageDetectionRequestMessage extends WorkerMessageBase {
	messageType: 'TextLanguageDetectionRequest'
	input: string
	options: TextLanguageDetectionOptions
}

export interface TextLanguageDetectionResponseMessage extends WorkerMessageBase, TextLanguageDetectionResult {
	messageType: 'TextLanguageDetectionResponse'
}

///////////////////////////////////////////////////////////////////////////////////////////////
// Messaging methods
///////////////////////////////////////////////////////////////////////////////////////////////
export function sendMessageToWorker(message: any) {
	ensureMessageChannelCreated()

	messageChannel?.port1.postMessage(message)
}

export function addListenerToWorkerMessages(handler: MessageFunc) {
	ensureMessageChannelCreated()

	messageChannel?.port1.addEventListener('message', (event) => {
		handler(event.data)
	})
}

function sendMessageToClient(message: any) {
	ensureMessageChannelCreated()

	messageChannel?.port2.postMessage(message)
}

function addListenerToClientMessages(handler: MessageFunc) {
	ensureMessageChannelCreated()

	messageChannel?.port2.addEventListener('message', (event) => {
		handler(event.data)
	})
}

function ensureMessageChannelCreated() {
	if (messageChannel == null) {
		throw new Error(`Message channel has not been created`)
	}
}

///////////////////////////////////////////////////////////////////////////////////////////////
// Worker thread methods
///////////////////////////////////////////////////////////////////////////////////////////////
export async function startNewWorkerThread() {
	const WorkerThreads = await import('node:worker_threads')

	const workerThread = new WorkerThreads.Worker(resolveToModuleRootDir('dist/server/WorkerStarter.js'), {
		argv: process.argv.slice(2),
		env: WorkerThreads.SHARE_ENV
	})

	workerThread.on('message', (message) => {
		if (message.name == 'writeToStdErr') {
			writeToStderr(message.text)
		}
	})

	workerThread.postMessage({
		name: 'init',
		stdErrIsTTY: process.stderr.isTTY,
		stdErrHasColors: process.stderr.hasColors ? process.stderr.hasColors() : false
	})

	return workerThread
}

///////////////////////////////////////////////////////////////////////////////////////////////
// Base message types
///////////////////////////////////////////////////////////////////////////////////////////////
export type WorkerRequestMessage = SynthesisRequestMessage | VoiceListRequestMessage | RecognitionRequestMessage | AlignmentRequestMessage | SpeechTranslationRequestMessage | SpeechLanguageDetectionRequestMessage | TextLanguageDetectionRequestMessage

export interface WorkerMessageBase {
	messageType: string
}

export type MessageFunc = (message: any) => void

