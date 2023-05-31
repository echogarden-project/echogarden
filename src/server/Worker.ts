import { RequestVoiceListResult, SynthesisOptions, SynthesisSegmentEventData, SynthesizeSegmentsResult, VoiceListRequestOptions, requestVoiceList, synthesizeSegments } from "../api/Synthesis.js"
import { Queue } from "../utilities/Queue.js"
import { logToStderr } from "../utilities/Utilities.js"
import { RawAudio } from "../audio/AudioUtilities.js"
import { RecognitionOptions, RecognitionResult, recognize } from "../api/Recognition.js"
import { AlignmentOptions, AlignmentResult, align } from "../api/Alignment.js"
import { SpeechTranslationOptions, SpeechTranslationResult, translateSpeech } from "../api/Translation.js"
import { resetActiveLogger } from "../utilities/Logger.js"

const log = logToStderr

const messageChannel = new MessageChannel()
messageChannel.port1.start()
messageChannel.port2.start()

addListenerToClientMessages((message) => {
	enqueueAndProcessIfIdle(message)
})

const messageQueue = new Queue<any>()
let isProcessing = false

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

		try {
			await processMessage(incomingMessage, sendMessage)
		} catch (e) {
			log(`${e}`)

			sendMessageToClient({
				requestId,
				messageType: "Error",
				error: e
			})
		} finally {
			resetActiveLogger()
		}
	}

	isProcessing = false
}

export async function processMessage(message: WorkerRequestMessage, sendMessage: MessageFunc) {
	switch (message.messageType) {
		case "SynthesizeSegmentsRequest": {
			await processSynthesizeSegmentsRequest(message, sendMessage)
			break
		}

		case "VoiceListRequest": {
			await processVoiceListRequest(message, sendMessage)
			break
		}

		case "RecognitionRequest": {
			await processRecognitionRequest(message, sendMessage)
			break
		}

		case "AlignmentRequest": {
			await processAlignmentRequest(message, sendMessage)
			break
		}

		case "SpeechTranslationRequest": {
			await processSpeechTranslationRequest(message, sendMessage)
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
async function processSynthesizeSegmentsRequest(message: SynthesizeSegmentsRequestMessage, sendMessage: MessageFunc) {
	async function onSegment(eventData: SynthesisSegmentEventData) {
		const responseMessage: SynthesisSegmentEventMessage = {
			messageType: "SynthesisSegmentEvent",
			...eventData
		}

		sendMessage(responseMessage)
	}

	async function onSentence(eventData: SynthesisSegmentEventData) {
		const responseMessage: SynthesisSentenceEventMessage = {
			messageType: "SynthesisSentenceEvent",
			...eventData
		}

		sendMessage(responseMessage)
	}

	const result = await synthesizeSegments(message.segments, message.options, onSegment, onSentence)

	const responseMessage: SynthesizeSegmentsResponseMessage = {
		messageType: "SynthesizeSegmentsResponse",
		...result
	}

	sendMessage(responseMessage)
}

// Synthesis message types
export interface SynthesizeSegmentsRequestMessage extends WorkerMessageBase {
	messageType: "SynthesizeSegmentsRequest"
	segments: string[]
	options: SynthesisOptions
}

export interface SynthesizeSegmentsResponseMessage extends WorkerMessageBase, SynthesizeSegmentsResult {
	messageType: "SynthesizeSegmentsResponse"
}

export interface SynthesisSegmentEventMessage extends WorkerMessageBase, SynthesisSegmentEventData {
	messageType: "SynthesisSegmentEvent"
}

export interface SynthesisSentenceEventMessage extends WorkerMessageBase, SynthesisSegmentEventData {
	messageType: "SynthesisSentenceEvent"
}

async function processVoiceListRequest(message: VoiceListRequestMessage, sendMessage: MessageFunc) {
	const result = await requestVoiceList(message.options)

	const responseMessage: VoiceListResponseMessage = {
		messageType: "VoiceListResponse",
		...result
	}

	sendMessage(responseMessage)
}

// Voice list message types
export interface VoiceListRequestMessage extends WorkerMessageBase {
	messageType: "VoiceListRequest"
	options: VoiceListRequestOptions
}

export interface VoiceListResponseMessage extends WorkerMessageBase, RequestVoiceListResult {
	messageType: "VoiceListResponse"
}

///////////////////////////////////////////////////////////////////////////////////////////////
// Recognition operations
///////////////////////////////////////////////////////////////////////////////////////////////
async function processRecognitionRequest(message: RecognitionRequestMessage, sendMessage: MessageFunc) {
	const result = await recognize(message.inputRawAudio, message.options)

	const responseMessage: RecognitionResponseMessage = {
		messageType: "RecognitionResponse",
		...result
	}

	sendMessage(responseMessage)
}

// Recognition message types
export interface RecognitionRequestMessage extends WorkerMessageBase {
	messageType: "RecognitionRequest"
	inputRawAudio: RawAudio
	options: RecognitionOptions
}

export interface RecognitionResponseMessage extends WorkerMessageBase, RecognitionResult {
	messageType: "RecognitionResponse"
}

///////////////////////////////////////////////////////////////////////////////////////////////
// Alignment operations
///////////////////////////////////////////////////////////////////////////////////////////////
async function processAlignmentRequest(message: AlignmentRequestMessage, sendMessage: MessageFunc) {
	const result = await align(message.inputRawAudio, message.transcript, message.options)

	const responseMessage: AlignmentResponseMessage = {
		messageType: "AlignmentResponse",
		...result
	}

	sendMessage(responseMessage)
}

// Alignment message types
export interface AlignmentRequestMessage extends WorkerMessageBase {
	messageType: "AlignmentRequest"
	inputRawAudio: RawAudio
	transcript: string
	options: AlignmentOptions
}

export interface AlignmentResponseMessage extends WorkerMessageBase, AlignmentResult {
	messageType: "AlignmentResponse"
}

///////////////////////////////////////////////////////////////////////////////////////////////
// Speech translation operations
///////////////////////////////////////////////////////////////////////////////////////////////
async function processSpeechTranslationRequest(message: SpeechTranslationRequestMessage, sendMessage: MessageFunc) {
	const result = await translateSpeech(message.inputRawAudio, message.options)

	const responseMessage: SpeechTranslationResponseMessage = {
		messageType: "SpeechTranslationResponse",
		...result
	}

	sendMessage(responseMessage)
}

// Speech translation message types
export interface SpeechTranslationRequestMessage extends WorkerMessageBase {
	messageType: "SpeechTranslationRequest"
	inputRawAudio: RawAudio
	options: SpeechTranslationOptions
}

export interface SpeechTranslationResponseMessage extends WorkerMessageBase, SpeechTranslationResult {
	messageType: "SpeechTranslationResponse"
}

///////////////////////////////////////////////////////////////////////////////////////////////
// Messaging methods
///////////////////////////////////////////////////////////////////////////////////////////////
export function sendMessageToWorker(message: any) {
	messageChannel.port1.postMessage(message)
}

export function addListenerToWorkerMessages(handler: MessageFunc) {
	messageChannel.port1.addEventListener('message', (event) => {
		handler(event.data)
	})
}

function sendMessageToClient(message: any) {
	messageChannel.port2.postMessage(message)
}

function addListenerToClientMessages(handler: MessageFunc) {
	messageChannel.port2.addEventListener('message', (event) => {
		handler(event.data)
	})
}

///////////////////////////////////////////////////////////////////////////////////////////////
// Base message types
///////////////////////////////////////////////////////////////////////////////////////////////
export type WorkerRequestMessage = SynthesizeSegmentsRequestMessage | VoiceListRequestMessage | RecognitionRequestMessage | AlignmentRequestMessage | SpeechTranslationRequestMessage

export interface WorkerMessageBase {
	messageType: string
}

export type MessageFunc = (message: any) => void

