import { resolveToModuleRootDir } from '../utilities/PathUtilities.js'
import { setupProgramTerminationListeners, setupUnhandledExceptionListeners, writeToStderr } from '../utilities/Utilities.js'
import { Worker, SHARE_ENV } from 'node:worker_threads'

setupUnhandledExceptionListeners()

setupProgramTerminationListeners(() => {
	writeToStderr('\n')
	process.kill(process.pid, 'SIGKILL')
})

const worker = new Worker(resolveToModuleRootDir('dist/cli/CLI.js'), {
	argv: process.argv.slice(2),
	env: SHARE_ENV
})

worker.postMessage({
	name: 'init',
	stdErrIsTTY: process.stderr.isTTY,
	stdErrHasColors: process.stderr.hasColors ? process.stderr.hasColors() : false
})

process.stdin.on('keypress', (str, key) => {
	worker.postMessage({
		name: 'keypress',
		str,
		key,
		timestamp: Date.now()
	})
})

worker.on('message', (message) => {
	if (message.name == 'writeToStdErr') {
		writeToStderr(message.text)
	}
})

worker.on('exit', (err) => {
	process.exit(err ? 1 : 0)
})
