import * as API from './API.js'
import type { ServerOptions } from '../server/Server.js'
import { CLIOptions } from '../cli/CLIOptions.js'

export interface APIOptions {
	VoiceListRequestOptions: API.VoiceListRequestOptions
	SynthesisOptions: API.SynthesisOptions
	RecognitionOptions: API.RecognitionOptions
	AlignmentOptions: API.AlignmentOptions
	TranslationAlignmentOptions: API.TranslationAlignmentOptions
	SpeechTranslationOptions: API.SpeechTranslationOptions
	SpeechLanguageDetectionOptions: API.SpeechLanguageDetectionOptions
	TextLanguageDetectionOptions: API.TextLanguageDetectionOptions
	VADOptions: API.VADOptions
	DenoisingOptions: API.DenoisingOptions
	SourceSeparationOptions: API.SourceSeparationOptions
	ServerOptions: ServerOptions
	GlobalOptions: API.GlobalOptions
	CLIOptions: CLIOptions
}
