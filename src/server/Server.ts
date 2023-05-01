import { WebSocketServer, WebSocket } from 'ws'
import { encode as encodeMsgPack, decode as decodeMsgPack } from 'msgpack-lite'
import { Worker } from 'node:worker_threads'
import { logToStderr } from '../utilities/Utilities.js'
import { OpenPromise } from '../utilities/OpenPromise.js'
import { resolveToModuleRootDir } from '../utilities/FileSystem.js'

const log = logToStderr

export async function startWebSocketServer(serverPort = 4000) {
	const serverPromise = new OpenPromise<void>()

	const requestIdToWebSocket = new Map<string, WebSocket>()

	const worker = new Worker(resolveToModuleRootDir("dist/server/Worker.js"))

	worker.on("message", (message: any) => {
		if (!message.requestId) {
			throw new Error("Worker message doesn't have a request ID")
		}

		const ws = requestIdToWebSocket.get(message.requestId)

		if (!ws || ws.readyState != WebSocket.OPEN) {
			return
		}

		const encodedWorkerMessage = encodeMsgPack(message)

		ws.send(encodedWorkerMessage)
	})

	const wss = new WebSocketServer({ port: serverPort })

	log(`Started Echogarden WebSocket server on port ${serverPort}`)

	wss.on('connection', async (ws, req) => {
		log(`Accepted incoming connection from ${req.socket.remoteAddress}`)

		ws.on('message', (messageData, isBinary) => {
			if (!isBinary) {
				log(`Received an unexpected string WebSocket message: '${(messageData as Buffer).toString("utf-8")}'`)
				return
			}

			let incomingMessage: any

			try {
				incomingMessage = decodeMsgPack(messageData as Buffer)
			} catch(e) {
				log(`Failed to decode binary WebSocket message. Reason: ${e}`)
				return
			}

			const requestId = incomingMessage.requestId

			if (!requestId) {
				log("Received a WebSocket message without a request ID")
				return
			}

			requestIdToWebSocket.set(requestId, ws)

			worker.postMessage(incomingMessage)
		})

		ws.on('error', (e) => {
			log(e)
		})

		ws.on("close", () => {
			const keysToDelete: string[] = []

			requestIdToWebSocket.forEach((value, key) => {
				if (value == ws) {
					keysToDelete.push(key)
				}
			})

			keysToDelete.forEach(key => requestIdToWebSocket.delete(key))

			log(`Incoming connection from ${req.socket.remoteAddress} was closed`)
		})
	})

	return serverPromise.promise
}
