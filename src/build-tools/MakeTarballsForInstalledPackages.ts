import { OperationCallbacks } from '../api/Common.js'
import { existsSync, readdir } from '../utilities/FileSystem.js'
import { ensureAndGetPackagesDir } from '../utilities/PackageManager.js'
import { joinPath } from '../utilities/PathUtilities.js'
import { createNamedTarball } from '../utilities/TarballMaker.js'
import { setupProgramTerminationListeners } from '../utilities/Utilities.js'

async function makeTarballsForInstalledPackages(tarballDir: string, skipIfExists = false, callbacks: OperationCallbacks) {
	const packagesDir = await ensureAndGetPackagesDir()
	const packageList = await readdir(packagesDir)

	for (const packageName of packageList) {
		if (skipIfExists && existsSync(joinPath(tarballDir, `${packageName}.tar.gz`))) {
			continue
		}

		const packagePath = joinPath(packagesDir, packageName)
		await createNamedTarball(packagePath, packageName, tarballDir, callbacks)
	}
}

setupProgramTerminationListeners()

await makeTarballsForInstalledPackages('../resources/tarballs', true, { logLevel: 'info' })

process.exit(0)
