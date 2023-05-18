import { isMainThread, parentPort } from 'node:worker_threads'
import { sendMessageToWorker, addListenerToWorkerMessages } from './Worker.js'

function startIfInWorkerThread() {
	if (isMainThread || !parentPort) {
		return
	}

	addListenerToWorkerMessages((message) => {
		parentPort?.postMessage(message)
	})

	parentPort.on("message", (message: any) => {
		sendMessageToWorker(message)
	})
}

// Start worker if running in worker thread
startIfInWorkerThread()
