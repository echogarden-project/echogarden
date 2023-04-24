import * as API from "./API.js"

export type APIOptions = {
	VoiceListRequestOptions: API.VoiceListRequestOptions,
	SynthesisOptions: API.SynthesisOptions,
	RecognitionOptions: API.RecognitionOptions,
	AlignmentOptions: API.AlignmentOptions,
	SpeechTranslationOptions: API.SpeechTranslationOptions
	SpeechLanguageDetectionOptions: API.SpeechLanguageDetectionOptions,
	TextLanguageDetectionOptions: API.TextLanguageDetectionOptions,
	VADOptions: API.VADOptions,
	DenoisingOptions: API.DenoisingOptions
}
