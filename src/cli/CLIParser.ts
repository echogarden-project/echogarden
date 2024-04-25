export function parseCLIArguments(args: string[]): ParsedCLIArguments {
	const parsedArgs: ParsedCLIArguments = {
		operationArgs: [],
		parsedArgumentsLookup: new Map(),
	}

	for (let i = 0; i < args.length; i++) {
		const currentArg = args[i]
		const currentArgIsNewOption = currentArg.startsWith('-')

		if (currentArgIsNewOption) {
			if (!currentArg.startsWith('--')) {
				throw new Error(`'${currentArg}' has a single dash prefix. You should use '-${currentArg}' instead.`)
			}

			const optionText = currentArg.substring(2)

			const indexOfEqualSign = optionText.indexOf('=')
			if (indexOfEqualSign == 0) {
				throw new Error('An option cannot have an empty name.')
			} else if (indexOfEqualSign == -1) {
				if (optionText.startsWith('no-')) {
					parsedArgs.parsedArgumentsLookup.set(optionText.substring(3), 'false')
				} else {
					parsedArgs.parsedArgumentsLookup.set(optionText, '')
				}
			} else {
				const key = optionText.substring(0, indexOfEqualSign)
				const value = optionText.substring(indexOfEqualSign + 1)

				parsedArgs.parsedArgumentsLookup.set(key, value)
			}
		} else {
			parsedArgs.operationArgs.push(currentArg)
		}
	}

	return parsedArgs
}

export interface ParsedCLIArguments {
	operationArgs: string[]
	parsedArgumentsLookup: Map<string, string>
}
