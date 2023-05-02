import { RequestVoiceListResult, SynthesisOptions, SynthesisSegmentEventData, SynthesizeSegmentsResult, VoiceListRequestOptions, requestVoiceList, synthesizeSegments } from "../api/Synthesis.js"
import { Queue } from "../utilities/Queue.js"
import { isMainThread, parentPort } from 'node:worker_threads'
import { logToStderr } from "../utilities/Utilities.js"
import { RawAudio } from "../audio/AudioUtilities.js"
import { RecognitionOptions, RecognitionResult, recognize } from "../api/Recognition.js"
import { AlignmentOptions, AlignmentResult, align } from "../api/Alignment.js"
import { SpeechTranslationOptions, SpeechTranslationResult, translateSpeech } from "../api/Translation.js"

const log = logToStderr

function startIfInWorkerThread() {
	if (isMainThread || !parentPort) {
		return
	}

	const messageQueue = new Queue<any>()
	let isProcessing = false

	async function processQueueIfIdle() {
		if (isProcessing) {
			return
		}

		isProcessing = true

		while (!messageQueue.isEmpty) {
			const incomingMessage = messageQueue.dequeue()
			const requestId = incomingMessage.requestId

			function postMessage(outgoingMessage: any) {
				parentPort?.postMessage({
					requestId,
					...outgoingMessage,
				})
			}

			try {
				await processMessage(incomingMessage, postMessage)
			} catch (e) {
				log(`${e}`)

				parentPort?.postMessage({
					requestId,
					messageType: "Error",
					error: e
				})
			}
		}

		isProcessing = false
	}

	parentPort.on("message", (message: any) => {
		messageQueue.enqueue(message)
		processQueueIfIdle()
	})
}

export async function processMessage(message: WorkerRequestMessage, postMessage: PostMessageFunc) {
	switch (message.messageType) {
		case "SynthesizeSegmentsRequest": {
			await processSynthesizeSegmentsRequest(message, postMessage)
			break
		}

		case "VoiceListRequest": {
			await processVoiceListRequest(message, postMessage)
			break
		}

		case "RecognitionRequest": {
			await processRecognitionRequest(message, postMessage)
			break
		}

		case "AlignmentRequest": {
			await processAlignmentRequest(message, postMessage)
			break
		}

		case "SpeechTranslationRequest": {
			await processSpeechTranslationRequest(message, postMessage)
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
async function processSynthesizeSegmentsRequest(message: SynthesizeSegmentsRequestMessage, postMessage: PostMessageFunc) {
	async function onSegment(eventData: SynthesisSegmentEventData) {
		const responseMessage: SynthesisSegmentEventMessage = {
			messageType: "SynthesisSegmentEvent",
			...eventData
		}

		postMessage(responseMessage)
	}

	async function onSentence(eventData: SynthesisSegmentEventData) {
		const responseMessage: SynthesisSentenceEventMessage = {
			messageType: "SynthesisSentenceEvent",
			...eventData
		}

		postMessage(responseMessage)
	}

	const result = await synthesizeSegments(message.segments, message.options, onSegment, onSentence)

	const responseMessage: SynthesizeSegmentsResponseMessage = {
		messageType: "SynthesizeSegmentsResponse",
		...result
	}

	postMessage(responseMessage)
}

async function processVoiceListRequest(message: VoiceListRequestMessage, postMessage: PostMessageFunc) {
	const result = await requestVoiceList(message.options)

	const responseMessage: VoiceListResponseMessage = {
		messageType: "VoiceListResponse",
		...result
	}

	postMessage(responseMessage)
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
async function processRecognitionRequest(message: RecognitionRequestMessage, postMessage: PostMessageFunc) {
	const result = await recognize(message.inputRawAudio, message.options)

	const responseMessage: RecognitionResponseMessage = {
		messageType: "RecognitionResponse",
		...result
	}

	postMessage(responseMessage)
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
async function processAlignmentRequest(message: AlignmentRequestMessage, postMessage: PostMessageFunc) {
	const result = await align(message.inputRawAudio, message.transcript, message.options)

	const responseMessage: AlignmentResponseMessage = {
		messageType: "AlignmentResponse",
		...result
	}

	postMessage(responseMessage)
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
async function processSpeechTranslationRequest(message: SpeechTranslationRequestMessage, postMessage: PostMessageFunc) {
	const result = await translateSpeech(message.inputRawAudio, message.options)

	const responseMessage: SpeechTranslationResponseMessage = {
		messageType: "SpeechTranslationResponse",
		...result
	}

	postMessage(responseMessage)
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
// Base message types
///////////////////////////////////////////////////////////////////////////////////////////////
export type WorkerRequestMessage = SynthesizeSegmentsRequestMessage | VoiceListRequestMessage | RecognitionRequestMessage | AlignmentRequestMessage | SpeechTranslationRequestMessage

export interface WorkerMessageBase {
	messageType: string
}

export type PostMessageFunc = (response: any) => void

// Start worker if running in worker thread
startIfInWorkerThread()
