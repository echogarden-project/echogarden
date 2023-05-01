import * as API from "./API.js"
import type { ServerOptions } from "../server/Server.js"

export type APIOptions = {
	VoiceListRequestOptions: API.VoiceListRequestOptions,
	SynthesisOptions: API.SynthesisOptions,
	RecognitionOptions: API.RecognitionOptions,
	AlignmentOptions: API.AlignmentOptions,
	SpeechTranslationOptions: API.SpeechTranslationOptions
	SpeechLanguageDetectionOptions: API.SpeechLanguageDetectionOptions,
	TextLanguageDetectionOptions: API.TextLanguageDetectionOptions,
	VADOptions: API.VADOptions,
	DenoisingOptions: API.DenoisingOptions,
	ServerOptions: ServerOptions
}
