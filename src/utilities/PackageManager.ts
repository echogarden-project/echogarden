import path from "node:path"
import { downloadAndExtractTarball } from "./FileDownloader.js"
import { getAppDataDir, getAppTempDir, ensureDir, existsSync, remove } from "./FileSystem.js"
import { appName } from "../api/Common.js"
import { GaxiosOptions } from "gaxios"

export async function loadPackage(packageName: string) {
	packageName = resolveToVersionedPackageNameIfNeeded(packageName)

	const packagesPath = await ensureAndGetPackagesDir()

	const packagePath = path.join(packagesPath, packageName)

	if (existsSync(packagePath)) {
		return packagePath
	}

	const tempPath = getAppTempDir(appName)

	const headers = {
	}

	const options: GaxiosOptions = {
		url: `${basePackageUrl}${packageName}.tar.gz`,
		headers
	}

	await downloadAndExtractTarball(
		options,
		packagesPath,
		tempPath,
		packageName,
	)

	return packagePath
}

export async function removePackage(packageName: string) {
	packageName = resolveToVersionedPackageNameIfNeeded(packageName)

	const packagesPath = await ensureAndGetPackagesDir()

	const packagePath = path.join(packagesPath, packageName)

	await remove(packagePath)
}

export async function ensureAndGetPackagesDir() {
	const dataPath = getAppDataDir(appName)

	const packagesPath = path.join(dataPath, "packages")

	await ensureDir(packagesPath)

	return packagesPath
}

export function resolveToVersionedPackageNameIfNeeded(packageName: string) {
	const versionTag = getVersionTagFromPackageName(packageName)

	if (versionTag) {
		return packageName
	}

	const resolvedVersionTag = resolveVersionTagForUnversionedPackageName(packageName)

	return packageName = `${packageName}-${resolvedVersionTag}`
}

export function getVersionTagFromPackageName(packageName: string) {
	return packageName.match(/.*\-([0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9](_[0-9]+)?)$/)?.[1]
}

export function resolveVersionTagForUnversionedPackageName(unversionedPackageName: string) {
	return packageVersionTagResolutionLookup[unversionedPackageName] || defaultVersionTag
}

const basePackageUrl = "https://huggingface.co/echogarden/echogarden-packages/resolve/main/"

const defaultVersionTag = "20230718"

const packageVersionTagResolutionLookup: { [packageName: string]: string } = {
	"sox-14.4.2-linux-minimal": "20230802",

	"vits-de_DE-thorsten_emotional-medium": "20230808",
	"vits-en_GB-semaine-medium": "20230808",
	"vits-fr_FR-upmc-medium": "20230808",
	"vits-lb_LU-marylux-medium": "20230808",
	"vits-ro_RO-mihai-medium": "20230808",
	"vits-sr_RS-serbski_institut-medium": "20230808",
	"vits-tr_TR-dfki-medium": "20230808",

	"vits-cs_CZ-jirka-medium": "20230824",
	"vits-de_DE-thorsten-high": "20230824",
	"vits-hu_HU-anna-medium": "20230824",
	"vits-pt_PT-tugao-medium": "20230824",
	"vits-sk_SK-lili-medium": "20230824",
	"vits-tr_TR-fahrettin-medium": "20230824",

	"vits-ar_JO-kareem-medium": "20231022",
	"vits-cs_CZ-jirka-low": "20231022",
	"vits-en_US-hfc_male-medium": "20231022",
	"vits-en_US-libritts_r-medium": "20231022",
	"vits-hu_HU-imre-medium": "20231022",
	"vits-pl_PL-mc_speech-medium": "20231022",

	"whisper-tiny": "20231126",
	"whisper-tiny.en": "20231126",
	"whisper-base": "20231126",
	"whisper-base.en": "20231126",
	"whisper-small": "20231126",
	"whisper-small.en": "20231126",
	"whisper-medium": "20231126",
	"whisper-medium.en": "20231126",
	"whisper-large-v3": "20231126",

	"vits-ar_JO-kareem-low": "20231126",
	"vits-en_US-hfc_female-medium": "20231126",
}
