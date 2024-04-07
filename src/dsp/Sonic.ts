import { RawAudio } from '../audio/AudioUtilities.js'
import { WasmMemoryManager } from '../utilities/WasmMemoryManager.js'

let sonicInstance: any

export async function stretchTimePitch(rawAudio: RawAudio, speed: number, pitchScale: number) {
	const sampleRate = rawAudio.sampleRate
	const channelCount = rawAudio.audioChannels.length
	const inputSamples = rawAudio.audioChannels[0]
	const inputSampleCount = rawAudio.audioChannels[0].length

	const m = await getSonicInstance()
	const wasmMemory = new WasmMemoryManager(m)

	const streamPtr = m._sonicCreateStream(sampleRate, channelCount)
	m._sonicSetSpeed(streamPtr, speed)
	m._sonicSetPitch(streamPtr, pitchScale)

	const inputSamplesRef = wasmMemory.allocFloat32Array(inputSampleCount)
	inputSamplesRef.view.set(inputSamples)

	const writeSuccess = m._sonicWriteFloatToStream(streamPtr, inputSamplesRef.address, inputSampleCount)

	if (writeSuccess != 1) {
		throw new Error('Sonic error: failed write to stream')
	}

	const flushSuccess = m._sonicFlushStream(streamPtr)

	if (flushSuccess != 1) {
		throw new Error('Sonic error: failed flushing stream')
	}

	const samplesAvailable = m._sonicSamplesAvailable(streamPtr)

	const outputSamplesRef = wasmMemory.allocFloat32Array(samplesAvailable)

	const samplesRead = m._sonicReadFloatFromStream(streamPtr, outputSamplesRef.address, outputSamplesRef.length)

	const outputSamples = outputSamplesRef.view.slice(0, samplesRead)

	const resultAudio: RawAudio = { audioChannels: [outputSamples], sampleRate }

	m._sonicDestroyStream(streamPtr)

	wasmMemory.freeAll()

	return resultAudio
}

async function getSonicInstance() {
	if (!sonicInstance) {
		const { default: SonicInitializer } = await import('@echogarden/sonic-wasm')

		sonicInstance = await SonicInitializer()
	}

	return sonicInstance
}
