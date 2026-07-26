declare module 'html-to-text' {
	export function htmlToText(html: string, options: {
		wordwrap: boolean | number
		selectors?: any[]
	})
}

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
