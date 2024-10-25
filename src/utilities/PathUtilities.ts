import * as NodePath from 'node:path'
import { fileURLToPath } from 'node:url'
import * as os from 'node:os'

export function getModuleRootDir() {
	const currentScriptDir = getDirName(fileURLToPath(import.meta.url))

	return resolvePath(currentScriptDir, '..', '..')
}

export function resolveToModuleRootDir(relativePath: string) {
	return resolvePath(getModuleRootDir(), relativePath)
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
		tempDir = joinPath(homeDir, 'AppData', 'Local', 'Temp', appName)
	} else if (platform == 'darwin') {
		tempDir = joinPath(homeDir, 'Library', 'Caches', appName)
	} else if (platform == 'linux') {
		tempDir = joinPath(homeDir, '.cache', appName)
	} else {
		throw new Error(`Unsupport platform ${platform}`)
	}

	return tempDir
}

export function joinPath(...paths: string[]) {
	return NodePath.join(...paths)
}

export function resolvePath(...paths: string[]) {
	return NodePath.resolve(...paths)
}

export function normalizePath(path: string) {
	return NodePath.normalize(path)
}

export function getBaseName(path: string) {
	return NodePath.basename(path)
}

export function getDirName(path: string) {
	return NodePath.dirname(path)
}

export function getFileNameWithoutExtension(filePath: string) {
	return NodePath.parse(filePath).name
}

export function parsePath(path: string) {
	return NodePath.parse(path)
}
