import { readAndParseJsonFile, resolveToModuleRootDir } from "./FileSystem.js"

export function languageCodeToName(languageCode: string) {
	const languageNames = new Intl.DisplayNames(['en'], { type: 'language' })

	let translatedLanguageName: string | undefined

	try {
		translatedLanguageName = languageNames.of(languageCode)
	} catch (e) {
	}

	return translatedLanguageName || "Unknown"
}

export function formatLanguageCodeWithName(languageCode: string) {
	return `${languageCodeToName(languageCode)} (${languageCode})`
}

export function getShortLanguageCode(langCode: string) {
	const dashIndex = langCode.indexOf("-")

	if (dashIndex == -1) {
		return langCode
	}

	return langCode.substring(0, dashIndex).toLowerCase()
}

export function normalizeLanguageCode(langCode: string) {
	langCode = langCode.trim()

	const parts = langCode.split("-")

	const result = [parts[0].toLowerCase()]

	for (let i = 1; i < parts.length; i++) {
		result.push(parts[i].toUpperCase())
	}

	return result.join("-")
}

const isoToLcidLookup = new Map<string, number>()
const lcidToIsoLookup = new Map<number, string[]>()
const lcidEntries: LCIDEntry[] = []

export async function isoToLcidLanguageCode(iso: string) {
	await loadLcidLookupIfNeeded()

	return isoToLcidLookup.get(iso)
}

export async function lcidToIsoLanguageCode(lcid: number) {
	await loadLcidLookupIfNeeded()

	return lcidToIsoLookup.get(lcid)
}

async function loadLcidLookupIfNeeded() {
	if (lcidEntries.length > 0) {
		return lcidEntries
	}

	const lcidLookup: LCIDLookup = await readAndParseJsonFile(resolveToModuleRootDir("data/tables/lcid-table.json"))

	for (const isoName in lcidLookup) {
		const lcidEntry = lcidLookup[isoName]
		lcidEntries.push(lcidEntry)

		const lcidValue = lcidEntry.LCID

		isoToLcidLookup.set(isoName, lcidValue)

		let entry = lcidToIsoLookup.get(lcidValue)

		if (!entry) {
			entry = []
			lcidToIsoLookup.set(lcidValue, entry)
		}

		entry.push(isoName)
	}

	return lcidEntries
}

export const shortLanguageCodeToLong: { [lang: string]: string } = {
	"en": "en-US",
	"zh": "zh-CN",
	"ar": "ar-EG",
	"fr": "fr-FR",
	"de": "de-DE",
	"pt": "pt-BR",
	"es": "es-ES",
	"nl": "nl-NL"
}

type LCIDLookup = { [isoLangCode: string]: LCIDEntry }

export interface LCIDEntry {
	"LCID": number
	"Name": string
	"TwoLetterISOLanguageName": string,
	"ThreeLetterISOLanguageName": string,
	"ThreeLetterWindowsLanguageName": string,
	"EnglishName": string
	"ANSICodePage": string
}
