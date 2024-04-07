import * as AudioBufferConversion from '../audio/AudioBufferConversion.js'
import { RawAudio } from '../audio/AudioUtilities.js'
import { WasmMemoryManager } from '../utilities/WasmMemoryManager.js'

export async function detectVoiceActivity(rawAudio: RawAudio, frameDuration: 10 | 20 | 30 = 10, mode: 0 | 1 | 2 | 3 = 0) {
	if (rawAudio.sampleRate != 16000) {
		throw new Error('Audio sample rate must be 16KHz')
	}

	const frameClassifications: (0 | 1)[] = await fvad(AudioBufferConversion.float32ToInt16Pcm(rawAudio.audioChannels[0]), rawAudio.sampleRate, frameDuration, mode)

	return frameClassifications
}

export async function fvad(samples: Int16Array, sampleRate: number, frameDuration: 10 | 20 | 30, mode: 0 | 1 | 2 | 3) {
	const m = await getFvadInstance()

	const wasmMemory = new WasmMemoryManager(m)

	const fvad_new = m._fvad_new
	const fvad_free = m._fvad_free
	const fvad_reset = m._fvad_reset
	const fvad_set_mode = m._fvad_set_mode
	const fvad_set_sample_rate = m._fvad_set_sample_rate
	const fvad_process = m._fvad_process

	const instancePtr = fvad_new()

	const sampleRateValid = fvad_set_sample_rate(instancePtr, sampleRate)

	if (sampleRateValid != 0) {
		throw new Error(`fvad_set_sample_rate failed for value ${sampleRate}`)
	}

	const modeValid = fvad_set_mode(instancePtr, mode)

	if (modeValid != 0) {
		throw new Error(`fvad_set_mode failed for mode ${mode}`)
	}

	const frameSampleCount = Math.floor(sampleRate * (frameDuration / 1000))
	const frameSamplesRef = wasmMemory.allocInt16Array(frameSampleCount)

	const result = []

	for (let sampleOffset = 0; sampleOffset < samples.length; sampleOffset += frameSampleCount) {
		const frame = samples.subarray(sampleOffset, sampleOffset + frameSampleCount)

		frameSamplesRef.clear()
		frameSamplesRef.view.set(frame)

		const fvadResult = fvad_process(instancePtr, frameSamplesRef.address, frameSampleCount)

		if (fvadResult == -1) {
			throw new Error('fvad_process failed')
		}

		result.push(fvadResult)
	}

	fvad_free(instancePtr)
	wasmMemory.freeAll()

	return result
}

let fvadInstance: any
async function getFvadInstance() {
	if (!fvadInstance) {
		const { default: fvadInitializer } = await import('@echogarden/fvad-wasm')

		fvadInstance = await fvadInitializer()
	}

	return fvadInstance
}
