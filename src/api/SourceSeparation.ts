import { AudioSourceParam, RawAudio, ensureRawAudio, subtractAudio } from '../audio/AudioUtilities.js';
import { Logger } from '../utilities/Logger.js';
import { extendDeep } from '../utilities/ObjectUtilities.js';
import { loadPackage } from '../utilities/PackageManager.js';
import { EngineMetadata } from './Common.js';
import chalk from 'chalk';
import { readdir } from '../utilities/FileSystem.js';
import path from 'node:path';
import { OnnxExecutionProvider } from '../utilities/OnnxUtilities.js';
import { getProfileForMDXNetModelName, MDXNetModelName } from '../source-separation/MDXNetSourceSeparation.js';

export async function isolate(input: AudioSourceParam, options: SourceSeparationOptions): Promise<SourceSeparationResult> {
	const logger = new Logger()
	const startTimestamp = logger.getTimestamp()

	await logger.startAsync('Prepare for source separation')

	const inputRawAudio = await ensureRawAudio(input)

	let isolatedRawAudio: RawAudio
	let backgroundRawAudio: RawAudio

	options = extendDeep(defaultSourceSeparationOptions, options)

	switch (options.engine) {
		case 'mdx-net': {
			const MDXNetSourceSeparation = await import('../source-separation/MDXNetSourceSeparation.js')

			const mdxNetOptions = options.mdxNet!

			const executionProviders: OnnxExecutionProvider[] =
				mdxNetOptions.provider ? [mdxNetOptions.provider] : MDXNetSourceSeparation.getDefaultMDXNetProviders()

			const packageDir = await loadPackage(`mdxnet-${mdxNetOptions.model!}`)
			const modelFilename = (await readdir(packageDir)).filter(name => name.endsWith('onnx'))[0]

			if (!modelFilename) {
				throw new Error(`Couldn't find an ONNX model file in package directory`)
			}

			const modelPath = path.join(packageDir, modelFilename)

			await logger.startAsync(`Convert audio to 44.1 kHz stereo`)

			const inputRawAudio44100Stereo = await ensureRawAudio(inputRawAudio, 44100, 2)

			logger.end()

			const modelProfile = getProfileForMDXNetModelName(mdxNetOptions.model!)

			isolatedRawAudio = await MDXNetSourceSeparation.isolate(inputRawAudio44100Stereo, modelPath, modelProfile, executionProviders)

			logger.end()

			await logger.startAsync(`Subtract from original waveform to extract background audio`)
			backgroundRawAudio = subtractAudio(inputRawAudio44100Stereo, isolatedRawAudio)

			break
		}

		default: {
			throw new Error(`Engine '${options.engine}' is not supported`)
		}
	}

	logger.end()
	logger.logDuration(`Total source separation time`, startTimestamp, chalk.magentaBright)

	return {
		inputRawAudio,
		isolatedRawAudio,
		backgroundRawAudio
	}
}

export type SourceSeparationEngine = 'mdx-net'

export interface SourceSeparationOptions {
	engine?: SourceSeparationEngine

	mdxNet?: {
		model?: MDXNetModelName
		provider?: OnnxExecutionProvider
	}
}

export const defaultSourceSeparationOptions: SourceSeparationOptions = {
	engine: 'mdx-net',

	mdxNet: {
		model: 'UVR_MDXNET_1_9703',
		provider: undefined,
	}
}

export interface SourceSeparationResult {
	inputRawAudio: RawAudio
	isolatedRawAudio: RawAudio
	backgroundRawAudio: RawAudio
}

export const sourceSeparationEngines: EngineMetadata[] = [
	{
		id: 'mdx-net',
		name: 'MDX-NET',
		description: 'Deep learning source separation architecture by KUIELAB (Korea University).',
		type: 'local'
	},
]
