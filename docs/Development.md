# Setting up a development environment

Here's a quick guide on how to set up a development environment for making and testing changes to the Echogarden codebase.

**Related pages**:
* [How to help](Contributing.md)
* [Technical overview](Techincal.md)
* [Node.js API reference](API.md)

## Quick start

* Fork or clone the repository (`git clone https://github.com/echogarden-project/echogarden`)
* Ensure you have [Node.js](https://nodejs.org/en/download) installed
* Ensure you have TypeScript installed (`npm install typescript -g`)
* Run `npm install` at the project base directory
* Compile using `tsc .` at the project base directory

## Auto-compiling in Visual Studio Code

Create the `.vscode` subdirectory at the project base directory

Add a `.vscode/tasks.json` file to run the TypeScript compiler in watch mode:
```json
{
	"version": "2.0.0",
	"command": "tsc.cmd",
	"args": [
		"-w",
		"-p",
		"."
	],
	"problemMatcher": "$tsc-watch",
	"isBackground": true,
	"tasks": [
		{
			"label": "node",
			"type": "shell",
			"command": "tsc",
			"args": [
				"-w",
				"-p",
				"."
			],
			"isBackground": true,
			"problemMatcher": "$tsc-watch",
			"group": {
				"kind": "build",
				"isDefault": true
			},
		}
	]
}
```

## Running the local code

In the project directory, type:

```
npx echogarden speak "Hello World!"
```

Adding `npx` would start the CLI directly from the local code.

## Step-debugging in VS Code

Ensure the project is compiled (using the watch task above is highly recommended).

Add a `.vscode/launch.json` file to launch the CLI in debug mode:

```json
{
	"version": "0.2.0",
	"configurations": [
		{
			"type": "node",
			"request": "launch",
			"name": "Launch Program",
			"skipFiles": [
				"<node_internals>/**"
			],
			"program": "${workspaceFolder}/dist/cli/CLIStarter.js",
			"outputCapture": "std",
			"console": "integratedTerminal",
			"runtimeArgs": ["--experimental-wasi-unstable-preview1", "--no-warnings", "--trace-uncaught"],

			"args": ["speak", "Hello World!", "--debug"]
		}
	]
}
```

Press F5 to start debugging.

You can change `"args": ["speak", "Hello World!", "--debug"]` to any command line arguments you want to test. Adding the `--debug` CLI option ensures that errors are shown with full stack traces.

## Updating the options schema

If you add, modify or remove options from the API, that are exposed to the CLI, you should run:

```
npm run generate-options-schema
```

To update the JSON schema used when parsing command line options in the CLI. Otherwise, the CLI may not recognize the modified option names or types.
