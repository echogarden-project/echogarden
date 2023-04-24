#!/usr/bin/env node

import { spawn } from 'child_process'
import { setupProgramTerminationListeners, setupUnhandledExceptionListeners } from '../utilities/Utilities.js'
import { resolveToModuleRootDir } from '../utilities/FileSystem.js'

setupUnhandledExceptionListeners()

const cmd = process.argv[0]
const scriptArgs = process.argv.slice(2)

const cliScriptPath = resolveToModuleRootDir("dist/cli/CLIStarter.js")

const args = [
	"--no-warnings",
	"--no-experimental-fetch",
	"--experimental-wasm-threads",
	"--experimental-wasi-unstable-preview1",
	cliScriptPath,
	...scriptArgs
]

const child = spawn(cmd, args, { stdio: "inherit" })

child.on("close", code => {
	process.exit(code as number)
})

setupProgramTerminationListeners(() => {
	child.kill('SIGKILL')
})
