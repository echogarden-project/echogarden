export class SignalChannel {
	channel: MessageChannel
	handlers = new Map<string, SignalChannelHandler>()

	constructor() {
		this.channel = new MessageChannel()

		this.channel.port2.onmessage = (event: MessageEvent) => {
			const signalName = event.data.signalName
			const signalData = event.data.data

			const handler = this.handlers.get(signalName)

			if (handler) {
				handler(signalData)
			}
		}
	}

	on(signalName: string, handler: SignalChannelHandler) {
		this.handlers.set(signalName, handler)
	}

	send(signalName: string, data?: any) {
		this.channel.port1.postMessage({ signalName, data })
	}
}

export type SignalChannelHandler = (data?: any) => void
