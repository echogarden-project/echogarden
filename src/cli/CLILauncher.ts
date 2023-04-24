#!/usr/bin/env node

import { spawn } from 'child_process'
import { resolve } from 'path'
import { setupProgramTerminationListeners, setupUnhandledExceptionListeners } from '../utilities/Utilities.js'

setupUnhandledExceptionListeners()
setupProgramTerminationListeners()

const cmd = process.argv[0]
const scriptArgs = process.argv.slice(2)

const cliScriptPath = resolve(process.cwd(), "dist/cli/CLIStarter.js")

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
