#!/usr/bin/env node

import { spawn } from 'child_process'
import { setupUnhandledExceptionListeners } from '../utilities/Utilities.js'
import { resolveToModuleRootDir } from '../utilities/PathUtilities.js'

setupUnhandledExceptionListeners()

const cmd = process.argv[0]
const scriptArgs = process.argv.slice(2)

const cliScriptPath = resolveToModuleRootDir('dist/cli/CLIStarter.js')

const args = [
	'--experimental-wasi-unstable-preview1',
	'--no-warnings',
	cliScriptPath,
	...scriptArgs
]

const child = spawn(cmd, args, { stdio: 'inherit' })

child.on('close', code => {
	process.exit(code as number)
})
