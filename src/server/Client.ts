import { WebSocket } from 'ws'
import { encode as encodeMsgPack, decode as decodeMsgPack } from 'msgpack-lite'
import { RequestVoiceListResult, SynthesisOptions, SynthesisSegmentEvent, SynthesisResult, VoiceListRequestOptions } from '../api/Synthesis.js'
import { SynthesisResponseMessage, SynthesisSegmentEventMessage, SynthesisSentenceEventMessage, VoiceListRequestMessage, WorkerRequestMessage, VoiceListResponseMessage, AlignmentRequestMessage, AlignmentResponseMessage, RecognitionRequestMessage, RecognitionResponseMessage, SpeechTranslationRequestMessage, SpeechTranslationResponseMessage, SpeechLanguageDetectionRequestMessage, SpeechLanguageDetectionResponseMessage, TextLanguageDetectionResponseMessage, TextLanguageDetectionRequestMessage, SynthesisRequestMessage } from './Worker.js'
import { getRandomHexString, logToStderr } from '../utilities/Utilities.js'
import { OpenPromise } from '../utilities/OpenPromise.js'
import { AudioSourceParam, RawAudio } from '../audio/AudioUtilities.js'
import { AlignmentOptions, AlignmentResult } from '../api/Alignment.js'
import { RecognitionOptions, RecognitionResult } from '../api/Recognition.js'
import { SpeechTranslationOptions, SpeechTranslationResult } from '../api/SpeechTranslation.js'
import { Worker as WorkerThread } from 'node:worker_threads'
import { SpeechLanguageDetectionOptions, SpeechLanguageDetectionResult } from '../api/SpeechLanguageDetection.js'
import { TextLanguageDetectionOptions, TextLanguageDetectionResult } from '../api/TextLanguageDetection.js'
import { decodeUtf8 } from '../encodings/Utf8.js'

const log = logToStderr

export class Client {
	sendMessage: (message: any) => void

	responseListeners = new Map<string, (message: string) => void>()

	constructor(sourceChannel: WebSocket | WorkerThread) {
		if (sourceChannel instanceof WebSocket) {
			sourceChannel.on('message', (messageData, isBinary) => {
				if (!isBinary) {
					log(`Received an unexpected string WebSocket message: '${decodeUtf8(messageData as Uint8Array)}'`)
					return
				}

				let incomingMessage: any

				try {
					incomingMessage = decodeMsgPack(messageData as Uint8Array)
				} catch (e) {
					log(`Failed to decode incoming message. Reason: ${e}`)
					return
				}

				this.onMessage(incomingMessage)
			})

			this.sendMessage = (outgoingMessage) => {
				const encodedMessage = encodeMsgPack(outgoingMessage)

				sourceChannel.send(encodedMessage)
			}
		} else if (sourceChannel instanceof WorkerThread) {
			sourceChannel.on('message', (message) => {
				this.onMessage(message)
			})

			sourceChannel.on('error', (e) => {
				throw e
			})

			this.sendMessage = (outgoingMessage) => {
				sourceChannel.postMessage(outgoingMessage)
			}
		} else {
			throw new Error(`Invalid source: not a WebSocket or WorkerThread object`)
		}
	}

	async synthesize(input: string | string[], options: SynthesisOptions, onSegment?: SynthesisSegmentEvent, onSentence?: SynthesisSegmentEvent): Promise<SynthesisResult> {
		const requestOpenPromise = new OpenPromise<SynthesisResult>()

		const requestMessage: SynthesisRequestMessage = {
			messageType: 'SynthesisRequest',
			input,
			options
		}

		function onResponse(responseMessage: SynthesisResponseMessage | SynthesisSegmentEventMessage | SynthesisSentenceEventMessage) {
			if (responseMessage.messageType == 'SynthesisResponse') {
				requestOpenPromise.resolve(responseMessage)
			} else if (responseMessage.messageType == 'SynthesisSegmentEvent' && onSegment) {
				onSegment(responseMessage)
			} else if (responseMessage.messageType == 'SynthesisSentenceEvent' && onSentence) {
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
			messageType: 'VoiceListRequest',
			options
		}

		function onResponse(responseMessage: VoiceListResponseMessage) {
			if (responseMessage.messageType == 'VoiceListResponse') {
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

	async recognize(input: AudioSourceParam, options: RecognitionOptions): Promise<RecognitionResult> {
		const requestOpenPromise = new OpenPromise<RecognitionResult>()

		const requestMessage: RecognitionRequestMessage = {
			messageType: 'RecognitionRequest',
			input,
			options
		}

		function onResponse(responseMessage: RecognitionResponseMessage) {
			if (responseMessage.messageType == 'RecognitionResponse') {
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

	async align(input: AudioSourceParam, transcript: string, options: AlignmentOptions): Promise<AlignmentResult> {
		const requestOpenPromise = new OpenPromise<AlignmentResult>()

		const requestMessage: AlignmentRequestMessage = {
			messageType: 'AlignmentRequest',
			input,
			transcript,
			options
		}

		function onResponse(responseMessage: AlignmentResponseMessage) {
			if (responseMessage.messageType == 'AlignmentResponse') {
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

	async translateSpeech(input: string | Uint8Array | RawAudio, options: SpeechTranslationOptions): Promise<SpeechTranslationResult> {
		const requestOpenPromise = new OpenPromise<SpeechTranslationResult>()

		const requestMessage: SpeechTranslationRequestMessage = {
			messageType: 'SpeechTranslationRequest',
			input,
			options
		}

		function onResponse(responseMessage: SpeechTranslationResponseMessage) {
			if (responseMessage.messageType == 'SpeechTranslationResponse') {
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

	async detectSpeechLanguage(input: AudioSourceParam, options: SpeechLanguageDetectionOptions): Promise<SpeechLanguageDetectionResult> {
		const requestOpenPromise = new OpenPromise<SpeechLanguageDetectionResult>()

		const requestMessage: SpeechLanguageDetectionRequestMessage = {
			messageType: 'SpeechLanguageDetectionRequest',
			input,
			options
		}

		function onResponse(responseMessage: SpeechLanguageDetectionResponseMessage) {
			if (responseMessage.messageType == 'SpeechLanguageDetectionResponse') {
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

	async detectTextLanguage(input: string, options: TextLanguageDetectionOptions): Promise<TextLanguageDetectionResult> {
		const requestOpenPromise = new OpenPromise<TextLanguageDetectionResult>()

		const requestMessage: TextLanguageDetectionRequestMessage = {
			messageType: 'TextLanguageDetectionRequest',
			input,
			options
		}

		function onResponse(responseMessage: TextLanguageDetectionResponseMessage) {
			if (responseMessage.messageType == 'TextLanguageDetectionResponse') {
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
		const requestId = getRandomHexString()

		request = {
			requestId,
			...request
		}

		this.sendMessage(request)

		function onResponseMessage(message: any) {
			if (message.messageType == 'Error') {
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
			log('Received a WebSocket message without a request ID')
			return
		}

		const listener = this.responseListeners.get(requestId)

		if (listener) {
			listener(incomingMessage)
		}
	}
}
