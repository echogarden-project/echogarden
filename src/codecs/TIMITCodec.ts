import { decodeToChannels } from '../audio/AudioBufferConversion.js'
import { readFile } from '../utilities/FileSystem.js'
import { SampleFormat } from './WaveCodec.js'

export async function decodeTimitAudioFile(filename: string) {
	return decodeTimitAudio(await readFile(filename))
}

export function decodeTimitAudio(data: Buffer) {
	if (data.subarray(0, 16).toString('ascii') != 'NIST_1A\n   1024\n') {
		throw new Error('Data is not a valid TIMIT audio file')
	}

	const pcm = data.subarray(1024)

	return { audioChannels: decodeToChannels(pcm, 1, 16, SampleFormat.PCM), sampleRate: 16000 }
}
