import * as API from './API.js'
import type { ServerOptions } from '../server/Server.js'
import { CLIOptions } from '../cli/CLIOptions.js'

export interface APIOptions {
	SynthesisOptions: API.SynthesisOptions
	VoiceListRequestOptions: API.VoiceListRequestOptions

	RecognitionOptions: API.RecognitionOptions

	AlignmentOptions: API.AlignmentOptions

	TranslationAlignmentOptions: API.TranslationAlignmentOptions
	TranscriptAndTranslationAlignmentOptions: API.TranscriptAndTranslationAlignmentOptions
	TimelineTranslationAlignmentOptions: API.TimelineTranslationAlignmentOptions

	SpeechTranslationOptions: API.SpeechTranslationOptions
	TextTranslationOptions: API.TextTranslationOptions

	SpeechLanguageDetectionOptions: API.SpeechLanguageDetectionOptions
	TextLanguageDetectionOptions: API.TextLanguageDetectionOptions

	VADOptions: API.VADOptions

	DenoisingOptions: API.DenoisingOptions

	SourceSeparationOptions: API.SourceSeparationOptions

	ServerOptions: ServerOptions

	GlobalOptions: API.GlobalOptions
	CLIOptions: CLIOptions
}
