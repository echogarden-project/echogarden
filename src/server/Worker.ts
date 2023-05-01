import { RequestVoiceListResult, SynthesisOptions, SynthesisSegmentEventData, SynthesizeSegmentsResult, VoiceListRequestOptions, requestVoiceList, synthesizeSegments } from "../api/Synthesis.js"
import { Queue } from "../utilities/Queue.js"
import { isMainThread, parentPort } from 'node:worker_threads'
import { logToStderr } from "../utilities/Utilities.js"

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
				log(e)
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

		default: {
			throw new Error(`Invalid message type: ${(message as any).messageType}`)
		}
	}
}

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

export type WorkerRequestMessage = SynthesizeSegmentsRequestMessage | VoiceListRequestMessage

export interface WorkerMessageBase {
	messageType: string
}

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

export interface VoiceListRequestMessage extends WorkerMessageBase {
	messageType: "VoiceListRequest"
	options: VoiceListRequestOptions
}

export interface VoiceListResponseMessage extends WorkerMessageBase, RequestVoiceListResult {
	messageType: "VoiceListResponse"
}

export type PostMessageFunc = (response: any) => void

startIfInWorkerThread()
