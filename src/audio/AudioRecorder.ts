import { spawn } from 'child_process'

import { RawAudio, concatAudioSegments } from './AudioUtilities.js'
import * as AudioBufferConversion from './AudioBufferConversion.js'

import { Timer } from '../utilities/Timer.js'
import { logToStderr } from '../utilities/Utilities.js'
import { OpenPromise } from '../utilities/OpenPromise.js'
import { SampleFormat } from '../codecs/WaveCodec.js'
import { tryResolvingSoxPath } from './SoxPath.js'

const log = logToStderr

export async function recordAudioInput(channelCount = 1, sampleRate = 48000, maxTime = 10) {
	const audioSegments: Float32Array[][] = []

	await captureAudioInput(channelCount, sampleRate, maxTime, (rawAudio) => {
		audioSegments.push(rawAudio)
	})

	const mergedAudio = concatAudioSegments(audioSegments)

	const rawAudio: RawAudio = {
		audioChannels: mergedAudio,
		sampleRate
	}

	return rawAudio
}

export function captureAudioInput(channelCount = 1, sampleRate = 48000, maxTime = -1, onAudioSamples?: (rawAudio: Float32Array[]) => void) {
	return new Promise<void>(async (resolve, reject) => {
		const timer = new Timer()

		const recorderSpawnedOpenPromise = new OpenPromise<null>()

		const soxPath = await tryResolvingSoxPath()

		if (!soxPath) {
			throw new Error('Could not resolve a SoX executable')
		}

		let args: string[]

		if (process.platform == 'win32') {
			args = ['-b', `${16}`, '--endian', 'little',
				'-c', `${channelCount}`, '-r', `${sampleRate}`, '-e', 'signed',
				'-t', 'waveaudio', 'default', '-t', 'raw', '-']
		} else if (process.platform == 'darwin') {
			args = ['-b', `${16}`, '--endian', 'little',
				'-c', `${channelCount}`, '-r', `${sampleRate}`, '-e', 'signed',
				'-t', 'raw', '-']
		} else {
			throw new Error('')
		}

		const recorder = spawn(
			soxPath,
			args,
			{}
		)

		recorder.once('spawn', () => {
			recorderSpawnedOpenPromise.resolve(null)
			timer.restart()
		})

		recorder.once('close', () => {
			resolve()
		})

		recorder.stderr.on('data', (chunk) => {
			//log(chunk.toString('utf8'))
		})

		recorder.stdout.on('data', (chunk) => {
			//log(chunk)

			const audioChannels = AudioBufferConversion.decodeToChannels(chunk, channelCount, 16, SampleFormat.PCM)

			if (onAudioSamples) {
				onAudioSamples(audioChannels)
			}

			if (maxTime >= 0 && timer.elapsedTimeSeconds >= maxTime) {
				recorder.kill()
				resolve()
			}
		})
	})
}
