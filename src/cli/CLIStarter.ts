import { resolveToModuleRootDir } from '../utilities/FileSystem.js'
import { setupProgramTerminationListeners, setupUnhandledExceptionListeners, writeToStderr } from '../utilities/Utilities.js'
import { Worker } from 'node:worker_threads'

setupUnhandledExceptionListeners()

setupProgramTerminationListeners(() => {
	writeToStderr('\n')
})

const worker = new Worker(resolveToModuleRootDir("dist/cli/cli.js"), {
	argv: process.argv.slice(2)
})

process.stdin.on('keypress', (str, key) => {
	worker.postMessage({
		name: 'keypress',
		str,
		key
	})
})

worker.on("exit", (err) => {
	process.exit(err ? 1 : 0)
})
