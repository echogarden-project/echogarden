import { WebSocketServer, WebSocket, ServerOptions as WsServerOptions } from 'ws'
import { encode as encodeMsgPack, decode as decodeMsgPack } from 'msgpack-lite'
import { logToStderr } from '../utilities/Utilities.js'
import { OpenPromise } from '../utilities/OpenPromise.js'
import { resolveToModuleRootDir, readFile, existsSync } from '../utilities/FileSystem.js'
import { extendDeep } from '../utilities/ObjectUtilities.js'
import { sendMessageToWorker, addListenerToWorkerMessages } from './Worker.js'

const log = logToStderr

export async function startWebSocketServer(serverOptions: ServerOptions, onStarted: (options: ServerOptions) => void) {
	serverOptions = extendDeep(defaultServerOptions, serverOptions)

	const wsServerOptions: WsServerOptions = {
		perMessageDeflate: serverOptions.deflate,
		maxPayload: serverOptions.maxPayload
	}

	if (serverOptions.secure) {
		if (!serverOptions.certPath || !existsSync(serverOptions.certPath)) {
			throw new Error(`No valid certificate file path was given`)
		}

		if (!serverOptions.keyPath || !existsSync(serverOptions.keyPath)) {
			throw new Error(`No valid key file path was given`)
		}

		const { createServer } = await import('https')

		const httpsServer = createServer({
			cert: await readFile(serverOptions.certPath!),
			key: await readFile(serverOptions.keyPath!)
		})

		httpsServer.listen(serverOptions.port!)

		wsServerOptions.server = httpsServer
	} else {
		wsServerOptions.port = serverOptions.port!
	}

	const wss = new WebSocketServer(wsServerOptions)

	const requestIdToWebSocket = new Map<string, WebSocket>()

	//const worker = new Worker(resolveToModuleRootDir("dist/server/WorkerStarter.js"))

	addListenerToWorkerMessages((message: any) => {
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

	const serverOpenPromise = new OpenPromise<void>

	wss.on("listening", () => {
		log(`Started Echogarden WebSocket server on port ${serverOptions.port}`)
		onStarted(serverOptions)
	})

	wss.on("close", () => {
		serverOpenPromise.resolve()
	})

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
			} catch (e) {
				log(`Failed to decode binary WebSocket message. Reason: ${e}`)
				return
			}

			const requestId = incomingMessage.requestId

			if (!requestId) {
				log("Received a WebSocket message without a request ID")
				return
			}

			requestIdToWebSocket.set(requestId, ws)

			sendMessageToWorker(incomingMessage)
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

	return serverOpenPromise.promise
}

export interface ServerOptions {
	port?: number
	secure?: boolean
	certPath?: string
	keyPath?: string
	deflate?: boolean
	maxPayload?: number
}

export const defaultServerOptions: ServerOptions = {
	port: 4000,
	secure: false,
	certPath: undefined,
	keyPath: undefined,
	deflate: true,
	maxPayload: 1000 * 1000000 // 1GB
}
