import path from 'node:path'
import { downloadAndExtractTarball } from './FileDownloader.js'
import { getAppDataDir, ensureDir, existsSync, remove } from './FileSystem.js'
import { appName } from '../api/Common.js'
import { GaxiosOptions } from 'gaxios'
import { getAppTempDir } from './PathUtilities.js'
import { getGlobalOption } from '../api/GlobalOptions.js'

export async function loadPackage(packageName: string) {
	packageName = resolveToVersionedPackageNameIfNeeded(packageName)

	const packagesPath = await ensureAndGetPackagesDir()

	const packagePath = path.join(packagesPath, packageName)

	if (existsSync(packagePath)) {
		return packagePath
	}

	const packageBaseURL = getGlobalOption('packageBaseURL')

	const tempPath = getAppTempDir(appName)

	const headers = {
	}

	const options: GaxiosOptions = {
		url: `${packageBaseURL}${packageName}.tar.gz`,
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

	const packagesPath = path.join(dataPath, 'packages')

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

const defaultVersionTag = '20230718'

const packageVersionTagResolutionLookup: { [packageName: string]: string } = {
	'sox-14.4.2-linux-minimal': '20230802',

	'vits-de_DE-thorsten_emotional-medium': '20230808',
	'vits-en_GB-semaine-medium': '20230808',
	'vits-fr_FR-upmc-medium': '20230808',
	'vits-lb_LU-marylux-medium': '20230808',
	'vits-ro_RO-mihai-medium': '20230808',
	'vits-sr_RS-serbski_institut-medium': '20230808',
	'vits-tr_TR-dfki-medium': '20230808',

	'vits-cs_CZ-jirka-medium': '20230824',
	'vits-de_DE-thorsten-high': '20230824',
	'vits-hu_HU-anna-medium': '20230824',
	'vits-pt_PT-tugao-medium': '20230824',
	'vits-sk_SK-lili-medium': '20230824',
	'vits-tr_TR-fahrettin-medium': '20230824',

	'vits-ar_JO-kareem-medium': '20231022',
	'vits-cs_CZ-jirka-low': '20231022',
	'vits-en_US-hfc_male-medium': '20231022',
	'vits-en_US-libritts_r-medium': '20231022',
	'vits-hu_HU-imre-medium': '20231022',
	'vits-pl_PL-mc_speech-medium': '20231022',

	'whisper-tiny': '20231126',
	'whisper-tiny.en': '20231126',
	'whisper-base': '20231126',
	'whisper-base.en': '20231126',
	'whisper-small': '20231126',
	'whisper-small.en': '20231126',
	'whisper-medium': '20231126',
	'whisper-medium.en': '20231126',
	'whisper-large-v3': '20231126',

	'vits-ar_JO-kareem-low': '20231126',
	'vits-en_US-hfc_female-medium': '20231126',

	'ffmpeg-6.0-win32-x64': '20240316',
	'ffmpeg-6.0-win32-ia32': '20240316',
	'ffmpeg-6.0-darwin-x64': '20240316',
	'ffmpeg-6.0-darwin-arm64': '20240316',
	'ffmpeg-6.0-linux-x64': '20240316',
	'ffmpeg-6.0-linux-ia32': '20240316',
	'ffmpeg-6.0-linux-arm64': '20240316',
	'ffmpeg-6.0-linux-arm': '20240316',
	'ffmpeg-6.0-freebsd-x64': '20240316',

	'vits-de_DE-mls-medium': '20240316',
	'vits-en_GB-cori-high': '20240316',
	'vits-en_US-kristin-medium': '20240316',
	'vits-en_US-ljspeech-high': '20240316',
	'vits-en_US-ljspeech-medium': '20240316',
	'vits-es_MX-claude-high': '20240316',
	'vits-fa_IR-amir-medium': '20240316',
	'vits-fa_IR-gyro-medium': '20240316',
	'vits-fr_FR-mls-medium': '20240316',
	'vits-fr_FR-tom-medium': '20240316',
	'vits-nl_NL-mls-medium': '20240316',
	'vits-sl_SI-artur-medium': '20240316',
	'vits-tr_TR-fettah-medium': '20240316',

	'mdxnet-UVR_MDXNET_1_9703': '20240330',
	'mdxnet-UVR_MDXNET_2_9682': '20240330',
	'mdxnet-UVR_MDXNET_3_9662': '20240330',
	'mdxnet-UVR_MDXNET_KARA': '20240330',

	'whisper.cpp-tiny': '20240405',
	'whisper.cpp-tiny-q5_1': '20240405',
	'whisper.cpp-tiny.en': '20240405',
	'whisper.cpp-tiny.en-q5_1': '20240405',
	'whisper.cpp-tiny.en-q8_0': '20240405',

	'whisper.cpp-base': '20240405',
	'whisper.cpp-base-q5_1': '20240405',
	'whisper.cpp-base.en': '20240405',
	'whisper.cpp-base.en-q5_1': '20240405',

	'whisper.cpp-small': '20240405',
	'whisper.cpp-small-q5_1': '20240405',
	'whisper.cpp-small.en': '20240405',
	'whisper.cpp-small.en-q5_1': '20240405',

	'whisper.cpp-medium': '20240405',
	'whisper.cpp-medium-q5_0': '20240405',
	'whisper.cpp-medium.en': '20240405',
	'whisper.cpp-medium.en-q5_0': '20240405',

	'whisper.cpp-large-v1': '20240405',
	'whisper.cpp-large-v2': '20240405',
	'whisper.cpp-large-v2-q5_0': '20240405',
	'whisper.cpp-large-v3': '20240405',
	'whisper.cpp-large-v3-q5_0': '20240405',

	'whisper.cpp-binaries-linux-x64-cpu-latest-patched': '20240405',
	'whisper.cpp-binaries-windows-x64-cpu-latest-patched': '20240409',

	'whisper-tiktoken-data': '20240408',

	'whisper.cpp-binaries-windows-x64-cublas-12.4.0-latest-patched': '20240409',
	'whisper.cpp-binaries-windows-x64-cublas-11.8.0-latest-patched': '20240409',

	'xenova-multilingual-e5-small-q8': '20240504',
	'xenova-nllb-200-distilled-600M-q8': '20240505',
	'xenova-multilingual-e5-small-fp16': '20240514',
	'xenova-multilingual-e5-base-fp16': '20240514',
	'xenova-multilingual-e5-base-q8': '20240514',
	'xenova-multilingual-e5-large-q8': '20240514',

	'w2v-bert-2.0-int8': '20240517',
	'w2v-bert-2.0-uint8': '20240517',
}
