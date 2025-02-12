import { defaultGnuSpeechOptions, GnuSpeechOptions, synthesize as gnuSpeechSynthesize } from '@echogarden/gnuspeech-wasm'
import { SynthesisVoice } from '../api/Synthesis.js'
import { decodeWaveToRawAudio } from '../audio/AudioUtilities.js'
import { extendDeep } from '../utilities/ObjectUtilities.js'

export async function synthesize(text: string, options: GnuSpeechOptions) {
	const gnuSpeechOptions = extendDeep(defaultGnuSpeechOptions, options)

	const { audioData, params } = await gnuSpeechSynthesize(text, gnuSpeechOptions)

	return decodeWaveToRawAudio(audioData)
}

export const voiceList: SynthesisVoice[] = [
	{
		name: 'male',
		languages: ['en-US', 'en'],
		gender: 'male',
	},
	{
		name: 'female',
		languages: ['en-US', 'en'],
		gender: 'female',
	},
	{
		name: 'large_child',
		languages: ['en-US', 'en'],
		gender: 'unknown',
	},
	{
		name: 'small_child',
		languages: ['en-US', 'en'],
		gender: 'unknown',
	},
	{
		name: 'baby',
		languages: ['en-US', 'en'],
		gender: 'unknown',
	},
]
