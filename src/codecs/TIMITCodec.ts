import { decodeToChannels } from '../audio/AudioBufferConversion.js'
import { decodeAscii } from '../encodings/Ascii.js'
import { readFileAsBinary } from '../utilities/FileSystem.js'
import { SampleFormat } from './WaveCodec.js'

export async function decodeTimitAudioFile(filename: string) {
	return decodeTimitAudio(await readFileAsBinary(filename))
}

export function decodeTimitAudio(data: Uint8Array) {
	if (decodeAscii(data.subarray(0, 16)) != 'NIST_1A\n   1024\n') {
		throw new Error('Data is not a valid TIMIT audio file')
	}

	const pcm = data.subarray(1024)

	return { audioChannels: decodeToChannels(pcm, 1, 16, SampleFormat.PCM), sampleRate: 16000 }
}
