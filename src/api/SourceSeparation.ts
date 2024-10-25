import { AudioSourceParam, RawAudio, attenuateIfClippingInPlace, ensureRawAudio, subtractAudio } from '../audio/AudioUtilities.js';
import { Logger } from '../utilities/Logger.js';
import { extendDeep } from '../utilities/ObjectUtilities.js';
import { loadPackage } from '../utilities/PackageManager.js';
import { EngineMetadata } from './Common.js';
import chalk from 'chalk';
import { readdir } from '../utilities/FileSystem.js';
import { defaultMDXNetOptions, getProfileForMDXNetModelName, MDXNetOptions } from '../source-separation/MDXNetSourceSeparation.js';
import { joinPath } from '../utilities/PathUtilities.js';

export async function isolate(input: AudioSourceParam, options: SourceSeparationOptions): Promise<SourceSeparationResult> {
	const logger = new Logger()
	const startTimestamp = logger.getTimestamp()

	const inputRawAudio = await ensureRawAudio(input)

	let isolatedRawAudio: RawAudio
	let backgroundRawAudio: RawAudio

	options = extendDeep(defaultSourceSeparationOptions, options)

	switch (options.engine) {
		case 'mdx-net': {
			const MDXNetSourceSeparation = await import('../source-separation/MDXNetSourceSeparation.js')

			const mdxNetOptions = options.mdxNet!

			const packageDir = await loadPackage(`mdxnet-${mdxNetOptions.model!}`)
			const modelFilename = (await readdir(packageDir)).filter(name => name.endsWith('onnx'))[0]

			if (!modelFilename) {
				throw new Error(`Couldn't find an ONNX model file in package directory`)
			}

			const modelPath = joinPath(packageDir, modelFilename)

			await logger.startAsync(`Convert audio to 44.1 kHz stereo`)

			let inputRawAudioAs44100Stereo: RawAudio | undefined = await ensureRawAudio(inputRawAudio, 44100, 2)

			logger.end()

			const modelProfile = getProfileForMDXNetModelName(mdxNetOptions.model!)

			isolatedRawAudio = await MDXNetSourceSeparation.isolate(inputRawAudioAs44100Stereo, modelPath, modelProfile, mdxNetOptions)
			logger.end()

			// Release memory for the converted input audio since it's not needed anymore
			inputRawAudioAs44100Stereo = undefined

			await logger.startAsync(`Convert isolated audio to back original sample rate (${inputRawAudio.sampleRate} Hz) and channel count (${inputRawAudio.audioChannels.length})`)
			isolatedRawAudio = await ensureRawAudio(isolatedRawAudio, inputRawAudio.sampleRate, inputRawAudio.audioChannels.length)

			await logger.startAsync(`Subtract from original waveform to extract background audio`)
			backgroundRawAudio = subtractAudio(inputRawAudio, isolatedRawAudio)

			break
		}

		default: {
			throw new Error(`Engine '${options.engine}' is not supported`)
		}
	}

	await logger.startAsync(`Postprocess audio`)

	attenuateIfClippingInPlace(isolatedRawAudio)
	attenuateIfClippingInPlace(backgroundRawAudio)

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

	mdxNet?: MDXNetOptions
}

export const defaultSourceSeparationOptions: SourceSeparationOptions = {
	engine: 'mdx-net',

	mdxNet: defaultMDXNetOptions,
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
		description: 'Deep learning audio source separation architecture by KUIELAB (Korea University).',
		type: 'local'
	},
]
