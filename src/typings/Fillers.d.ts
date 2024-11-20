declare module 'moving-median'

declare module 'html-to-text' {
	export function htmlToText(html: string, options: {
		wordwrap: boolean | number
		selectors?: any[]
	})
}

declare module 'cldr-segmentation' {
	export function sentenceSplit(text: string, suppressions: any)
	export function wordSplit(text: string, suppressions: any)
	export const suppressions: Record<string, Suppressions>

	export class Suppressions {
		constructor(forwardTrie: any, backwardTrie: any, list: string)

		merge(other: Suppressions)

		static create(list: string[]): Suppressions
	}
}

declare module 'sam-js'
declare module 'winax'

declare module 'tinyld' {
	export function detect(text: string, opts?: any): string

	export function detectAll(text: string, opts?: any): {
		lang: string
		accuracy: number
	}[]
}

declare module 'command-exists' {
	function commandExists(commandName: string): Promise<string>

	export default commandExists
}

declare module 'wtf_wikipedia'

declare module 'kuromoji'

declare module '@echogarden/espeak-ng-emscripten'
declare module '@echogarden/svoxpico-wasm'
declare module '@echogarden/fasttext-wasm'
declare module '@echogarden/rubberband-wasm'
declare module '@echogarden/rnnoise-wasm'
declare module '@echogarden/fvad-wasm'
declare module '@echogarden/sonic-wasm'
declare module '@echogarden/pffft-wasm'
declare module '@echogarden/pffft-wasm/simd'
declare module '@echogarden/speex-resampler-wasm'
declare module '@echogarden/speex-resampler-wasm/simd'
declare module '@echogarden/vosk'

declare module 'onnxruntime-node' {
	// From index.d.ts
	export * from 'onnxruntime-common'

	// From backend.d.ts
	import { Backend, InferenceSession, SessionHandler, OnnxValue } from 'onnxruntime-common'

	class OnnxruntimeBackend implements Backend {
		init(): Promise<void>
		createSessionHandler(pathOrBuffer: string | Uint8Array, options?: InferenceSession.SessionOptions): Promise<SessionHandler>
	}

	export const onnxruntimeBackend: OnnxruntimeBackend

	// From binding.d.ts
	type SessionOptions = InferenceSession.SessionOptions

	type FeedsType = {
		[name: string]: OnnxValue
	}

	type FetchesType = {
		[name: string]: OnnxValue | null
	}

	type ReturnType = {
		[name: string]: OnnxValue
	}

	type RunOptions = InferenceSession.RunOptions

	// Binding exports a simple synchronized inference session object wrap.
	export namespace Binding {
		interface InferenceSession {
			loadModel(modelPath: string, options: SessionOptions): void
			loadModel(buffer: ArrayBuffer, byteOffset: number, byteLength: number, options: SessionOptions): void

			readonly inputNames: string[]
			readonly outputNames: string[]

			run(feeds: FeedsType, fetches: FetchesType, options: RunOptions): ReturnType
		}
		interface InferenceSessionConstructor {
			new(): InferenceSession
		}
	}

	export const binding: {
		InferenceSession: Binding.InferenceSessionConstructor
	}

	// From version.d.ts
	export const version = '1.20.0'
}
