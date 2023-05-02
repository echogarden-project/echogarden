import { WebSocket } from 'ws'
import { encode as encodeMsgPack, decode as decodeMsgPack } from 'msgpack-lite'
import { RequestVoiceListResult, SynthesisOptions, SynthesisSegmentEvent, SynthesizeSegmentsResult, VoiceListRequestOptions } from "../api/Synthesis.js"
import { SynthesizeSegmentsRequestMessage as SynthesiseSegmentsRequestMessage, SynthesizeSegmentsResponseMessage, SynthesisSegmentEventMessage, SynthesisSentenceEventMessage, VoiceListRequestMessage, WorkerRequestMessage, VoiceListResponseMessage, AlignmentRequestMessage, AlignmentResponseMessage, RecognitionRequestMessage, RecognitionResponseMessage, SpeechTranslationRequestMessage, SpeechTranslationResponseMessage } from './Worker.js'
import { getRandomHexString, logToStderr } from '../utilities/Utilities.js'
import { OpenPromise } from '../utilities/OpenPromise.js'
import { RawAudio } from '../audio/AudioUtilities.js'
import { AlignmentOptions, AlignmentResult } from '../api/Alignment.js'
import { RecognitionOptions, RecognitionResult } from '../api/Recognition.js'
import { SpeechTranslationOptions, SpeechTranslationResult } from '../api/Translation.js'

const log = logToStderr

export class Client {
	ws: WebSocket
	responseListeners = new Map<string, (message: string) => void>()

	constructor(ws: WebSocket) {
		this.ws = ws

		this.ws.on("message", (messageData, isBinary) => {
			if (!isBinary) {
				log(`Received an unexpected string WebSocket message: '${(messageData as Buffer).toString("utf-8")}'`)
				return
			}

			let incomingMessage: any

			try {
				incomingMessage = decodeMsgPack(messageData as Buffer)
			} catch (e) {
				log(`Failed to decode incoming message. Reason: ${e}`)
				return
			}

			this.onMessage(incomingMessage)
		})
	}

	async synthesizeSegments(segments: string[], options: SynthesisOptions, onSegment?: SynthesisSegmentEvent, onSentence?: SynthesisSegmentEvent): Promise<SynthesizeSegmentsResult> {
		const requestOpenPromise = new OpenPromise<SynthesizeSegmentsResult>()

		const requestMessage: SynthesiseSegmentsRequestMessage = {
			messageType: "SynthesizeSegmentsRequest",
			segments,
			options
		}

		function onResponse(responseMessage: SynthesizeSegmentsResponseMessage | SynthesisSegmentEventMessage | SynthesisSentenceEventMessage) {
			if (responseMessage.messageType == "SynthesizeSegmentsResponse") {
				requestOpenPromise.resolve(responseMessage)
			} else if (responseMessage.messageType == "SynthesisSegmentEvent" && onSegment) {
				onSegment(responseMessage)
			} else if (responseMessage.messageType == "SynthesisSentenceEvent" && onSentence) {
				onSentence(responseMessage)
			}
		}

		function onError(e: any) {
			requestOpenPromise.reject(e)
		}

		try {
			this.sendRequest(requestMessage, onResponse, onError)
		} catch (e) {
			onError(e)
		}

		return requestOpenPromise.promise
	}

	async requestVoiceList(options: VoiceListRequestOptions): Promise<RequestVoiceListResult> {
		const requestOpenPromise = new OpenPromise<RequestVoiceListResult>()

		const requestMessage: VoiceListRequestMessage = {
			messageType: "VoiceListRequest",
			options
		}

		function onResponse(responseMessage: VoiceListResponseMessage) {
			if (responseMessage.messageType == "VoiceListResponse") {
				requestOpenPromise.resolve(responseMessage)
			}
		}

		function onError(e: any) {
			requestOpenPromise.reject(e)
		}

		try {
			this.sendRequest(requestMessage, onResponse, onError)
		} catch (e) {
			onError(e)
		}

		return requestOpenPromise.promise
	}

	async recognize(inputRawAudio: RawAudio, options: RecognitionOptions): Promise<RecognitionResult> {
		const requestOpenPromise = new OpenPromise<RecognitionResult>()

		const requestMessage: RecognitionRequestMessage = {
			messageType: "RecognitionRequest",
			inputRawAudio,
			options
		}

		function onResponse(responseMessage: RecognitionResponseMessage) {
			if (responseMessage.messageType == "RecognitionResponse") {
				requestOpenPromise.resolve(responseMessage)
			}
		}

		function onError(e: any) {
			requestOpenPromise.reject(e)
		}

		try {
			this.sendRequest(requestMessage, onResponse, onError)
		} catch (e) {
			onError(e)
		}
		return requestOpenPromise.promise
	}

	async align(inputRawAudio: RawAudio, transcript: string, options: AlignmentOptions): Promise<AlignmentResult> {
		const requestOpenPromise = new OpenPromise<AlignmentResult>()

		const requestMessage: AlignmentRequestMessage = {
			messageType: "AlignmentRequest",
			inputRawAudio,
			transcript,
			options
		}

		function onResponse(responseMessage: AlignmentResponseMessage) {
			if (responseMessage.messageType == "AlignmentResponse") {
				requestOpenPromise.resolve(responseMessage)
			}
		}

		function onError(e: any) {
			requestOpenPromise.reject(e)
		}

		try {
			this.sendRequest(requestMessage, onResponse, onError)
		} catch (e) {
			onError(e)
		}

		return requestOpenPromise.promise
	}

	async translateSpeech(inputRawAudio: RawAudio, options: SpeechTranslationOptions): Promise<SpeechTranslationResult> {
		const requestOpenPromise = new OpenPromise<SpeechTranslationResult>()

		const requestMessage: SpeechTranslationRequestMessage = {
			messageType: "SpeechTranslationRequest",
			inputRawAudio,
			options
		}

		function onResponse(responseMessage: SpeechTranslationResponseMessage) {
			if (responseMessage.messageType == "SpeechTranslationResponse") {
				requestOpenPromise.resolve(responseMessage)
			}
		}

		function onError(e: any) {
			requestOpenPromise.reject(e)
		}

		try {
			this.sendRequest(requestMessage, onResponse, onError)
		} catch (e) {
			onError(e)
		}

		return requestOpenPromise.promise
	}

	sendRequest(request: any, onResponse: (message: any) => void, onErrorResponse: (error: any) => void) {
		const requestId = getRandomHexString(16)
		request = { requestId, ...request }

		const encodedRequest = encodeMsgPack(request)

		this.ws.send(encodedRequest)

		function onResponseMessage(message: any) {
			if (message.messageType == "Error") {
				onErrorResponse(message.error)
			} else {
				onResponse(message)
			}
		}

		this.responseListeners.set(requestId, onResponseMessage)
	}

	onMessage(incomingMessage: any) {
		const requestId = incomingMessage.requestId

		if (!requestId) {
			log("Received a WebSocket message without a request ID")
			return
		}

		const listener = this.responseListeners.get(requestId)

		if (listener) {
			listener(incomingMessage)
		}
	}
}

export async function runClientTest(serverPort: number, secure: boolean) {
	const ws = new WebSocket(`${secure ? "wss" : "ws" }://localhost:${serverPort}`, {
		rejectUnauthorized: false
	})

	ws.on("open", async () => {
		const client = new Client(ws)

		const voiceListResult = await client.requestVoiceList({
			engine: "pico"
		})

		log(voiceListResult)

		client.synthesizeSegments(
			["Hello world! How are you?", "Want to play a game?"],
			{},
			async (eventData) => {
				log("onSegment (call 1)")
			},
			async (eventData) => {
				log("onSentence (call 1)")
			})

		//log(synthesisResult1)

		client.synthesizeSegments(
			["Hey! What's up?", "See ya."],
			{},
			async (eventData) => {
				log("onSegment (call 2)")
			},
			async (eventData) => {
				log("onSentence (call 2)")
			})

		//log(synthesisResult2)

		//ws.close()
	})
}
