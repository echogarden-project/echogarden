# WebSocket server API reference

This is a guide to the WebSocket server protocol.

**Note**: The protocol is still in early development and may change in future releases. Many features are currently missing, and the server hasn't been thoroughly tested.

## Starting the server

```bash
echogarden serve [options]
```

**Options** (all optional):
* `port`: Port number. Defaults to `45054`
* `secure`: Start a secure server? Defaults to `false`
* `certPath`: Path to a certificate file, required when `secure = true`
* `keyPath`: Path to a private key file, required when `secure = true`
* `deflate`: Use per-message deflate. Defaults to `true`
* `maxPayload`: Maximum raw message payload size (in bytes). Defaults to `1000 * 1000000` (1GB)
* `useWorkerThread`: Run worker in a separate thread. Defaults to `true` (recommended leaving as is)

## Using the client class

For Node.js clients, a simple client class allows to wrap communications with the server in a more convenient interface, without needing to know the details of the protocol.

Currently, the client is embedded in the main codebase. This means you have to import the `echogarden` package to use it:

```ts
import { WebSocket } from 'ws'
import { Client } from 'echogarden'

const ws = new WebSocket('ws://localhost:45054')

ws.on("open", async () => {
	const client = new Client(ws)

	const { audio } = await client.synthesize("Hello World", { engine: 'espeak' })
})
```

**TODO**:
* Separate the client to an independent, lightweight, Node.js package, with browser compatibility
* Add support for cancellation signals
* Document how to use with a background worker

## Protocol details

The protocol is based on binary WebSocket messages, for both request and response objects. Messages are encoded using the [MessagePack](https://msgpack.org) encoding scheme.

All messages are objects and have the basic structure:

```ts
{
	messageType: string
	requestId: string

	// ... other data specific for the target message type
}
```

The `messageType` property is a string representing the operation to perform. These operations are parallel to the methods provided by the Node.js API. They can be one of:

* `SynthesisRequest`
* `VoiceListRequest`
* `RecognitionRequest`
* `AlignmentRequest`
* `SpeechTranslationRequest`
* `SpeechLanguageDetectionRequest`
* `TextLanguageDetectionRequest`

When sending a message, `requestId` should contain a long random string that uniquely identifies your request, like `cb7e0f3ec835a213b005c4424c8d5775`.

For example, this message requests synthesis:
```ts
{
	messageType: 'SynthesisRequest',
	requestId: 'cb7e0f3ec835a213b005c4424c8d5775',

	input: 'Hello World!',

	options: {
		engine: 'espeak',
		language: 'en-GB'
	}
}
```

After a message is sent, the server may send one or more response messages. Each response message includes the `requestId` identifier that was given on the request it replies to. The response message `messageType` can be:

* `SynthesisResponse`, `SynthesisSegmentEvent`, `SynthesisSentenceEvent`
* `VoiceListResponse`
* `RecognitionResponse`
* `AlignmentResponse`
* `SpeechTranslationResponse`
* `SpeechLanguageDetectionResponse`
* `TextLanguageDetectionResponse`

The properties included in the response objects, are similar to the ones returned by the API.

Example response, for the above synthesis request:

```ts
{
	messageType: 'SynthesisResponse',
	requestId: 'cb7e0f3ec835a213b005c4424c8d5775',

	audio: {
		sampleRate: 22050,
		channels: [ ... ] // An array of `Float32Array` channel data
	}

	// ... other result object properties
}
```

### Cancellation messages

To cancel an existing request, the client can send a `CancellationRequest` message, with the same `requestId` of an ongoing request, like:

```ts
{
	messageType: 'CancellationRequest',
	requestId: 'cb7e0f3ec835a213b005c4424c8d5775'
}
```

**TODO**: Cancellation requests are currently only supported for synthesis operations. Extend support for other operations.

## Starting the server programmatically

You can use the `startServer` method to start a new server.
```ts
async function startServer(serverOptions: ServerOptions, onStarted: (options: ServerOptions) => void)
```

Example:
```ts
import { startServer } from 'echogarden'

await startServer({ port: 1234 }, () => {
	console.log("Server is started!")
})
```

The method would return when the server is closed.

**TODO**: accept a signal to stop the server.

## Web-based user interface (future)

When an HTTP web-based user interface is developed, it would be integrated with the WebSocket server and share the same port.

Currently, if you start a non-secure server and try to open `http://localhost:45054` (or another port you specified), you should see a placeholder message saying:

```
This is the Echogarden HTTP server!
```

If you can't see this message, there may be a configuration issue, or some other problem.

## TODO

Expose more operations to the server.
