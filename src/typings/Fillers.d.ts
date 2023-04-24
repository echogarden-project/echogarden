declare module 'moving-median'
declare module 'html-to-text'
declare module 'cldr-segmentation'

declare module 'html-escaper' {
	export function escape(str: string): string
	export function unescape(str: string): string
}

declare module 'sam-js'
declare module 'winax'

declare module 'tinyld' {
	export declare function detect(text: string, opts?: any): string

	export declare function detectAll(text: string, opts?: any): {
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
declare module '@echogarden/kissfft-wasm'
declare module '@echogarden/speex-resampler-wasm'
declare module '@echogarden/vosk'
