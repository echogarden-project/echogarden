export class SignalChannel {
	channel: MessageChannel

	constructor() {
		this.channel = new MessageChannel()

	}

	on(signalName: string, handler: (data?: any) => void) {
		this.channel.port2.onmessage = (event: MessageEvent) => {
			if (event.data.signalName != signalName) {
				return
			}

			handler(event.data.data)
		}
	}

	send(signalName: string, data?: any) {
		this.channel.port1.postMessage({ signalName, data })
	}
}
