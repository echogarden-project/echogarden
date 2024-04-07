import { isMainThread, parentPort } from 'node:worker_threads'
import { sendMessageToWorker, addListenerToWorkerMessages, startMessageChannel } from './Worker.js'
import { OpenPromise } from '../utilities/OpenPromise.js'

async function startIfInWorkerThread() {
	if (isMainThread || !parentPort) {
		return
	}

	startMessageChannel()

	addListenerToWorkerMessages((message) => {
		parentPort?.postMessage(message)
	})

	const initOpenPromise = new OpenPromise<void>()

	parentPort.once('message', (message) => {
		if (message.name == 'init') {
			process.stderr.isTTY = message.stdErrIsTTY
			process.stderr.hasColors = () => message.hasColors

			process.stderr.write = (text) => {
				parentPort!.postMessage({ name: 'writeToStdErr', text })
				return true
			}

			initOpenPromise.resolve()
		}
	})

	await initOpenPromise.promise

	parentPort.on('message', (message: any) => {
		sendMessageToWorker(message)
	})
}

// Start worker if running in worker thread
startIfInWorkerThread()
