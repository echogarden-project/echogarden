import path from "node:path"
import { downloadAndExtractTarball } from "./FileDownloader.js"
import { getAppDataDir, getAppTempDir, ensureDir, existsSync, remove } from "./FileSystem.js"
import { appName } from "../api/Globals.js"
import { GaxiosOptions } from "gaxios"

export async function getPackagePathIfExists(packageName: string) {
	const packagesPath = await ensureAndGetPackagesDir()

	const packagePath = path.join(packagesPath, packageName)

	if (existsSync(packagePath)) {
		return packagePath
	}

	return undefined
}

export async function loadPackage(packageName: string) {
	const packagesPath = await ensureAndGetPackagesDir()

	const packagePath = path.join(packagesPath, packageName)

	if (existsSync(packagePath)) {
		return packagePath
	}

	const tempPath = getAppTempDir(appName)

	let baseUrl: string

	if (packageName.startsWith("whisper-")) {
		baseUrl = "https://github.com/echogarden-project/whisper-onnx-models/releases/download/v0.0.1/"
	} else {
		baseUrl = "https://github.com/echogarden-project/echogarden-packages/releases/download/v0.0.1/"
	}

	const headers = {
	}

	const options: GaxiosOptions = {
		url: `${baseUrl}${packageName}.tar.gz`,
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
