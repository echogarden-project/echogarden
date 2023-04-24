import path from "path"
import { loadPackage } from "../utilities/PackageManager.js"
import { commandExists } from "../utilities/Utilities.js"

export async function tryResolvingSoxPath() {
	let soxPath: string | undefined = undefined

	if (process.platform == "win32") {
		const soxPackagePath = await loadPackage("sox-14.4.1a-win32")
		soxPath = path.join(soxPackagePath, "sox.exe")
	} else if (process.platform == "darwin" && process.arch == "x64") {
		const soxPackagePath = await loadPackage("sox-14.4.1-macosx")
		soxPath = path.join(soxPackagePath, "sox")
	} else if (await commandExists("sox")) {
		soxPath = "sox"
	}

	return soxPath
}
