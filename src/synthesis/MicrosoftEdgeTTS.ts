import { request } from 'gaxios'
import WebSocket from 'ws'

import { escape } from 'html-escaper'

import splitBuffer from 'buffer-split'

import * as AzureCognitiveServicesTTS from './AzureCognitiveServicesTTS.js'
import * as FFMpegTranscoder from '../codecs/FFMpegTranscoder.js'
import { Logger } from '../utilities/Logger.js'
import { OpenPromise } from '../utilities/OpenPromise.js'
import { getRandomHexString, logToStderr } from '../utilities/Utilities.js'
import { RawAudio, getEmptyRawAudio, getRawAudioDuration } from '../audio/AudioUtilities.js'
import { Timer } from '../utilities/Timer.js'

const traceEnabled = false

const log: typeof logToStderr = traceEnabled ? logToStderr : () => { }

export async function synthesize(
	text: string,
	trustedClientToken: string,
	voice = 'Microsoft Server Speech Text to Speech Voice (en-US, AvaNeural)',
	ssmlPitchString = '+0Hz',
	ssmlRateString = '+0%',
	ssmlVolumeString = '+0%') {

	const logger = new Logger()
	logger.start('Request synthesis from Microsoft Edge cloud API')

	const { audioData, events } = await requestSynthesis(text, trustedClientToken, voice, ssmlPitchString, ssmlRateString, ssmlVolumeString)
	logger.end()

	//logToStderr(`Audio length: ${audioData.length}`)

	let rawAudio: RawAudio

	try {
		rawAudio = await FFMpegTranscoder.decodeToChannels(audioData, 24000, 1)
	} catch (e) {
		rawAudio = getEmptyRawAudio(1, 24000)
	}

	//logToStderr(`Raw audio length: ${rawAudio.audioChannels[0].length}`)

	logger.start('Convert boundary events to timeline')
	const timeline = AzureCognitiveServicesTTS.boundaryEventsToTimeline(events, getRawAudioDuration(rawAudio))
	logger.end()

	return { rawAudio, timeline }
}

type SynthesisRequestResult = { audioData: Buffer, events: any[] }

async function requestSynthesis(
	text: string,
	trustedClientToken: string,
	voice = 'Microsoft Server Speech Text to Speech Voice (en-US, AriaNeural)',
	ssmlPitchString = '+0Hz',
	ssmlRateString = '+0%',
	ssmlVolumeString = '+0%') {

	const synthesisOpenPromise = new OpenPromise<SynthesisRequestResult>()

	let connectionFailed = false
	let responseComplete = false

	let lastReceievedMessageTime = Timer.currentTime

	function checkForRequestTimeout() {
		if (responseComplete || connectionFailed) {
			clearInterval(timeoutCheckInterval)

			return
		}

		if (!webSocket) {
			return
		}

		if (Timer.currentTime - lastReceievedMessageTime > 10000) {
			clearInterval(timeoutCheckInterval)

			removeWebSocketHandlers()
			webSocket.close()

			synthesisOpenPromise.reject(new Error(`WebSocket request timed out after 10 seconds without a message from the server`))

			return
		}
	}

	let webSocket: WebSocket = undefined as any

	const timeoutCheckInterval = setInterval(checkForRequestTimeout, 1000)

	const requestId = getRandomHexString()

	try {
		webSocket = await initializeWebsocketConnection(trustedClientToken)
	} catch(e) {
		connectionFailed = true

		throw e
	}

	const receivedBinaryMessages: Buffer[] = []
	const receivedEventMessages: any[] = []
	const audioChunks: Buffer[] = []

	const onMessage = (messageData: Buffer, isBinary: boolean) => {
		lastReceievedMessageTime = Timer.currentTime

		if (isBinary) {
			const [header, audioChunk] = parseBinaryMessage(messageData)

			if (header['X-RequestId'] != requestId) {
				log(`Ignoring binary message to different request Id: ${requestId}`)

				return
			}

			log('\nReceived binary message:')
			log(header)

			receivedBinaryMessages.push(messageData)
			receivedBinaryMessages.push(Buffer.from('\n\n'))

			audioChunks.push(audioChunk)
		} else {
			const message = messageData.toString('utf8')
			const [header, content] = parseTextMessage(message)

			if (header['X-RequestId'] != requestId) {
				log(`Ignoring text message to different request Id: ${requestId}`)
				return
			}

			log('\nReceived text message:')
			log(header)
			log(content)

			if (header['Path'] == 'turn.start') {

			}
			else if (header['Path'] == 'audio.metadata') {
				receivedEventMessages.push(content['Metadata'][0])
			}
			else if (header['Path'] == 'turn.end') {
				const result: SynthesisRequestResult = { audioData: Buffer.concat(audioChunks), events: receivedEventMessages }

				removeWebSocketHandlers()

				synthesisOpenPromise.resolve(result)
				responseComplete = true
			}
		}
	}

	const onError = (err: Error) => {
		synthesisOpenPromise.reject(err)

		removeWebSocketHandlers()

		if (webSocket) {
			webSocket.close()
		}
	}

	const onClose = async (code: number, reason: Buffer) => {
		log('WebSocket closed.')
		log(code)
		log(reason.toString())

		if (reason.length > 0) {
			synthesisOpenPromise.reject(new Error(`Websocket closed with code ${code}, reason: ${reason}`))
		}
	}

	function removeWebSocketHandlers() {
		if (webSocket) {
			webSocket.off('message', onMessage)
			webSocket.off('error', onError)
			webSocket.off('close', onClose)
		}
	}

	webSocket.on('message', onMessage)
	webSocket.on('error', onError)
	webSocket.on('close', onClose)

	const requestContentSSML =
		`<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
		`<voice  name='${voice}'>` +
		`<prosody pitch='${ssmlPitchString}' rate='${ssmlRateString}' volume='${ssmlVolumeString}'>` +
		escape(text) +
		`</prosody>` +
		`</voice>` +
		`</speak>`

	const bodyRequestString =
		`X-RequestId:${requestId}\r\n` +
		`Content-Type:application/ssml+xml\r\n` +
		`X-Timestamp:${getTimestampString()}Z\r\n` + // The added 'Z' recreates a Microsoft Edge bug.
		`Path:ssml\r\n\r\n` +
		requestContentSSML

	log(bodyRequestString)

	webSocket.send(bodyRequestString)

	return synthesisOpenPromise.promise
}

let existingWebSocketConnection: WebSocket | undefined = undefined

export async function initializeWebsocketConnection(trustedClientToken: string) {
	const requestOpenPromise = new OpenPromise<WebSocket>()

	if (existingWebSocketConnection && existingWebSocketConnection.readyState == WebSocket.OPEN) {
		log(`Existing websocket connection is still open. Reusing it.`)

		requestOpenPromise.resolve(existingWebSocketConnection)

		return requestOpenPromise.promise
	} else {
		existingWebSocketConnection = undefined
	}

	const connectionId = getRandomHexString()

	const requestURL = 'wss://speech.platform.bing.com/' +
		'consumer/speech/synthesize/readaloud/edge/v1' +
		`?TrustedClientToken=${trustedClientToken}` +
		'&ConnectionId=' + connectionId

	log(requestURL)
	log('')

	const webSocket = new WebSocket(requestURL, {
		headers: {
			'Pragma': 'no-cache',
			'Cache-Control': 'no-cache',
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.5060.66 Safari/537.36 Edg/103.0.1264.44',
			'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
			'Accept-Encoding': 'gzip, deflate, br',
			'Accept-Language': 'en-US,en;q=0.9',
		}
	})

	const requestMetadata = {
		'context': {
			'synthesis': {
				'audio': {
					'metadataoptions': {
						'sentenceBoundaryEnabled': 'false',
						'wordBoundaryEnabled': 'true'
					},
					'outputFormat': 'webm-24khz-16bit-mono-opus'
				}
			}
		}
	}

	const onOpen = () => {
		const configRequestString =
			`X-Timestamp:${getTimestampString()}\r\n` +
			`Content-Type:application/json; charset=utf-8\r\n` +
			`Path:speech.config\r\n\r\n` +
			`${JSON.stringify(requestMetadata, null, 0)}\r\n`

		log(configRequestString)

		webSocket.send(configRequestString)

		existingWebSocketConnection = webSocket

		webSocket.off('open', onOpen)
		webSocket.off('close', onClose)
		webSocket.off('error', onError)

		requestOpenPromise.resolve(webSocket)
	}

	const onClose = (code: number, reason: Buffer) => {
		log('WebSocket closed.')
		log(code)
		log(reason.toString())

		if (reason.length > 0) {
			requestOpenPromise.reject(new Error(`Websocket closed with code ${code}, reason: ${reason}`))
		}
	}

	const onError = (err: Error) => {
		requestOpenPromise.reject(err)
	}

	webSocket.on('open', onOpen)
	webSocket.on('close', onClose)
	webSocket.on('error', onError)

	return requestOpenPromise.promise
}

export async function getVoiceList(trustedClientToken: string) {
	const response = await request<any>({
		method: 'GET',

		url: 'https://speech.platform.bing.com/consumer/speech/synthesize/' +
			`readaloud/voices/list?trustedclienttoken=${trustedClientToken}`,

		headers: {
			'sec-ch-ua': `" Not;A Brand";v="99", "Microsoft Edge";v="103", "Chromium";v="103"`,
			'dnt': '1',
			'sec-ch-ua-mobile': '?0',
			'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.5060.66 Safari/537.36 Edg/103.0.1264.44',
			'sec-ch-ua-platform': 'Windows',
			'accept': '*/*',
			'sec-fetch-site': 'none',
			'sec-fetch-mode': 'cors',
			'sec-fetch-dest': 'empty',
			'accept-encoding': 'gzip, deflate, br',
			'accept-language': 'en-US,en;q=0.9',
		},

		responseType: 'json'
	})

	return response.data as any[]
}

function getTimestampString() {
	const timestampString = new Date(new Date().toLocaleString('en-US', { timeZone: 'UTC' })).toString().replace(/GMT.*/, 'GMT+0000 (Coordinated Universal Time)')
	return timestampString
}

function parseHeaderString(headerString: string) {
	const headers: any = {}

	for (const headerLine of headerString.split('\r\n')) {
		const [key, value] = headerLine.split(':')
		headers[key] = value
	}

	return headers
}

function parseTextMessage(message: string) {
	const [headerString, content] = message.split('\r\n\r\n')

	return [parseHeaderString(headerString), JSON.parse(content)]
}

function parseBinaryMessage(message: Buffer) {
	const audioChunk = splitBuffer(message, Buffer.from('Path:audio\r\n'))[1]
	const headerBuffer = message.subarray(2, message.length - audioChunk.length)
	const headerString = headerBuffer.toString('utf8').trim()

	return [parseHeaderString(headerString), audioChunk]
}

