import { WebSocketServer } from 'ws'
import { encode as encodeMsgPack, decode as decodeMsgPack } from 'msgpack-lite'
import { getRandomHexString } from '../utilities/Utilities.js'

async function start() {
	const wss = new WebSocketServer({ port: 8080 })

	wss.on('connection', async (ws) => {
		const connectionId = getRandomHexString(32)

		ws.on('message', async (data) => {
			const message = {
				someData: 'something'
			}

			ws.send(encodeMsgPack(message))
		})

		ws.on('error', console.error)
	})
}

start()
