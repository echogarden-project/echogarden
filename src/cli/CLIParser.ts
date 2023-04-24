export function parseCLIArguments(command: string, args: string[]): CLIArguments {
	const parsedArgs: CLIArguments = {
		command,
		commandArgs: [],
		options: new Map(),
	}

	for (let i = 0; i < args.length; i++) {
		const currentArg = args[i]
		const currentArgIsNewOption = currentArg.startsWith("-")

		if (currentArgIsNewOption) {
			if (!currentArg.startsWith("--")) {
				throw new Error(`'${currentArg}' has a single dash prefix. You should use '-${currentArg}' instead.`)
			}

			const optionText = currentArg.substring(2)

			const indexOfEquals = optionText.indexOf("=")
			if (indexOfEquals == 0) {
				throw new Error("An option cannot have an empty name.")
			} else if (indexOfEquals == -1) {
				parsedArgs.options.set(optionText, "")
			} else {
				const key = optionText.substring(0, indexOfEquals)
				const value = optionText.substring(indexOfEquals + 1)
				parsedArgs.options.set(key, value)
			}
		} else {
			parsedArgs.commandArgs.push(currentArg)
		}
	}

	return parsedArgs
}

export type CLIArguments = {
	command: string
	commandArgs: string[]
	options: Map<string, string>
}
