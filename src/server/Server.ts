import { WebSocketServer, RawData, WebSocket } from 'ws'
import { encode as encodeMsgPack, decode as decodeMsgPack } from 'msgpack-lite'
import { getRandomHexString } from '../utilities/Utilities.js'

export async function startServer() {
	const wss = new WebSocketServer({ port: 8080 })

	wss.on('connection', async (ws) => {
		const connectionId = getRandomHexString(32)

		ws.on('message', (data) => {
			handleMessage(connectionId, data, ws)
		})

		ws.on('error', (e) => {
			throw e
		})
	})
}

async function handleMessage(connectionId: string, data: RawData, ws: WebSocket) {
	const incomingMessage = decodeMsgPack(data as Buffer)

	const outgoingMessage = {
		someData: 'something'
	}

	const encodedOutgoingMessage = encodeMsgPack(outgoingMessage)

	ws.send(encodedOutgoingMessage)
}
