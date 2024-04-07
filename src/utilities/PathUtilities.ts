import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as os from 'node:os'

export function getModuleRootDir() {
	const currentScriptDir = path.dirname(fileURLToPath(import.meta.url))
	return path.resolve(currentScriptDir, '..', '..')
}

export function resolveToModuleRootDir(relativePath: string) {
	return path.resolve(getModuleRootDir(), relativePath)
}

export function getLowercaseFileExtension(filename: string) {
	const fileExtensionIndex = filename.lastIndexOf('.')

	if (fileExtensionIndex == -1) {
		return ''
	}

	return filename.substring(fileExtensionIndex + 1).toLowerCase()
}

export function getAppTempDir(appName: string) {
	let tempDir: string

	const platform = process.platform
	const homeDir = os.homedir()

	if (platform == 'win32') {
		tempDir = path.join(homeDir, 'AppData', 'Local', 'Temp', appName)
	} else if (platform == 'darwin') {
		tempDir = path.join(homeDir, 'Library', 'Caches', appName)
	} else if (platform == 'linux') {
		tempDir = path.join(homeDir, '.cache', appName)
	} else {
		throw new Error(`Unsupport platform ${platform}`)
	}

	return tempDir
}
