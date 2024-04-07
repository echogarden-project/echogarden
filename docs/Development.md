# How to help

So far, this project has been the solo work of a single person.

However, there are many areas where contributions can be made.

## Report any issue or bug you encounter

First, check the issue tracker, as well as the [task list](Tasklist.md) to see if the problem is already known to me. The task list allows me to efficiently document and organize a large quantity of small issues, enhancements or ideas that would otherwise flood an issue tracker with lots of unimportant entries, be ignored, or forgotten entirely.

If you find the issue you're encountering in the task list, you can still open an issue to discuss it. This allows me to know that someone cares about a particular issue, and I may give it higher priority.

There might be some obvious errors that have gone unreported. Especially if:
* You're using the macOS architecture: I don't have access to a macOS machine, so personally I did not and cannot perform testing on that platform.
* You're using cloud services: There may be changes in the service that will require updating the code. I don't often test they work correctly, since my trial periods in Google, Microsoft and Amazon have all expired, thus testing requires me to use paid requests.

In any case, please let me know if you get any unexpected error message or surprising behavior that you care about, and I'll try to prioritize it, if possible.

## Report or help fix odd TTS pronunciations and other fail cases

When you encounter an odd pronunciation in a VITS voice, there are several possible causes:

1. An incorrect phonemization produced by the eSpeak engine. Fortunately, it can be overridden by adding a corrected pronunciation to an Echogarden lexicon. You can pass one or more custom lexicons files to the VITS engine via `vits.customLexiconPaths` and see if it solves the problem. The lexicon format is the same as in [this file](https://github.com/echogarden-project/echogarden/blob/main/data/lexicons/heteronyms.en.json) - you can use it as a reference.
1. This word has multiple different pronunciations based on context (a heteronym). In that case, it may be possible resolve the pronunciations based on context, by using the preceding and succeeding words as indicators. This is supported by the lexicon in the `precededBy`, `notPrecededBy`, `succeededBy`, `notSucceededBy` properties.
1. An issue with model training, which may need to be forwarded to the original authors.

If the problem is serious, you can report it and we'll see what we can do.

## Notes about licensing

The code is currently licensed under GPL-3, mainly due to one of its core dependencies, `eSpeak-NG`, having this license.

In the future, I may want to re-license parts (or all) of the code to a more permissive license like MIT, if that turns out to be possible. If you make an external contribution, I would appreciate if you also agree to license it under the MIT license, so a future transition would be easier.

# Setting up a development environment

* Clone or fork the repository
* Ensure you have [Node.js](https://nodejs.org/en/download) installed
* Ensure you have TypeScript installed (`npm install typescript -g`)
* Compile using `tsc .` at the project base directory

## Auto-compiling in VSCode

Create the `.vscode` subdirectory at the project base directory

Add a `.vscode/tasks.json` file to run the TypeScript compiler in watch mode:
```json
{
	// See http://go.microsoft.com/fwlink/?LinkId=733558
	// for the documentation about the tasks.json format
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

Adding `npx` would run the local repository code directly.

## Step-debugging in VSCode

Ensure the project is compiled (using the task above is highly recommended)

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
			"runtimeArgs": ["--no-warnings", "--no-experimental-fetch", "--experimental-wasi-unstable-preview1", "--trace-uncaught"],

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

To update the JSON schema used when parsing command line options in the CLI. Otherwise, the CLI may not recognize the modified option names.
