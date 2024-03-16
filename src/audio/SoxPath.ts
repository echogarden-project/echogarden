import path from 'path'
import { loadPackage } from '../utilities/PackageManager.js'
import { commandExists } from '../utilities/Utilities.js'
import { getGlobalOption } from '../api/GlobalOptions.js'

export async function tryResolvingSoxPath() {
	if (getGlobalOption('soxPath')) {
		return getGlobalOption('soxPath')
	}

	const platform = process.platform
	const arch = process.arch

	if (platform === 'win32') {
		const soxPackagePath = await loadPackage('sox-14.4.1a-win32')

		return path.join(soxPackagePath, 'sox.exe')
	}

	if (await commandExists('sox')) {
		return 'sox'
	}

	if (platform === 'linux' && arch === 'x64') {
		const soxPackagePath = await loadPackage('sox-14.4.2-linux-minimal')

		return path.join(soxPackagePath, 'sox')
	}

	return undefined
}
