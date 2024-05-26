export type LanguageDetectionResults = LanguageDetectionResultsEntry[]

export interface LanguageDetectionResultsEntry {
	language: string
	languageName: string
	probability: number
}
