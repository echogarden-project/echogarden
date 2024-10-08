import path from 'path'
import { existsSync, readdir } from '../utilities/FileSystem.js'
import { ensureAndGetPackagesDir } from '../utilities/PackageManager.js'
import { createNamedTarball } from '../utilities/TarballMaker.js'
import { setupProgramTerminationListeners } from '../utilities/Utilities.js'

async function makeTarballsForInstalledPackages(tarballDir: string, skipIfExists = false) {
	const packagesDir = await ensureAndGetPackagesDir()
	const packageList = await readdir(packagesDir)

	for (const packageName of packageList) {
		if (skipIfExists && existsSync(path.join(tarballDir, `${packageName}.tar.gz`))) {
			continue
		}

		const packagePath = path.join(packagesDir, packageName)
		await createNamedTarball(packagePath, packageName, tarballDir)
	}
}

setupProgramTerminationListeners()

await makeTarballsForInstalledPackages('../resources/tarballs', true)

process.exit(0)
