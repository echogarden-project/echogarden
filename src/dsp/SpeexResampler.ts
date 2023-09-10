import { RawAudio, cloneRawAudio } from "../audio/AudioUtilities.js"
import { WasmMemoryManager } from "../utilities/WasmMemoryManager.js"

let speexResamplerInstance: any

export async function resampleAudioSpeex(rawAudio: RawAudio, outSampleRate: number, quality = 0) {
	const channelCount = rawAudio.audioChannels.length
	const inSampleRate = rawAudio.sampleRate

	if (inSampleRate == outSampleRate) {
		return cloneRawAudio(rawAudio)
	}

	const m = await getSpeexResamplerInstance()
	const wasmMemory = new WasmMemoryManager(m)

	function speexResultCodeToString(resultCode: number) {
		const errorStrPtr = m._speex_resampler_strerror(resultCode)
		const errorStrRef = wasmMemory.wrapUint8Array(errorStrPtr, 1024)
		const message = errorStrRef.readAsNullTerminatedUtf8String()

		return message
	}

	const initErrRef = wasmMemory.allocInt32()
	const resamplerState = m._speex_resampler_init(channelCount, inSampleRate, outSampleRate, quality, initErrRef.address)
	let resultCode = initErrRef.value

	if (resultCode != 0) {
		throw new Error(`Speex resampler failed while initializing with code ${resultCode}: ${speexResultCodeToString(resultCode)}`)
	}

	const resampledAudio: RawAudio = { audioChannels: [], sampleRate: outSampleRate }

	for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
		const channelSamples = rawAudio.audioChannels[channelIndex]

		const inputLatency = m._speex_resampler_get_input_latency(resamplerState)
		const outputLatency = m._speex_resampler_get_output_latency(resamplerState)

		const inSampleCount = channelSamples.length
		const inSampleCountRef = wasmMemory.allocInt32()
		inSampleCountRef.value = inSampleCount + inputLatency

		const inSamplesRef = wasmMemory.allocFloat32Array(inSampleCountRef.value)
		inSamplesRef.view.set(channelSamples)

		const outSampleCount = Math.floor((inSampleCount / inSampleRate) * outSampleRate)
		const outSampleCountRef = wasmMemory.allocInt32()
		outSampleCountRef.value = outSampleCount + outputLatency

		const outSamplesRef = wasmMemory.allocFloat32Array(outSampleCountRef.value)

		resultCode = m._speex_resampler_process_float(resamplerState, channelIndex, inSamplesRef.address, inSampleCountRef.address, outSamplesRef.address, outSampleCountRef.address)

		if (resultCode != 0) {
			throw new Error(`Speex resampler failed while resampling with code ${resultCode}: ${speexResultCodeToString(resultCode)}`)
		}

		const resampledChannelAudio = outSamplesRef.view.slice(outputLatency)

		resampledAudio.audioChannels.push(resampledChannelAudio)
	}

	m._speex_resampler_destroy(resamplerState)
	wasmMemory.freeAll()

	return resampledAudio
}

export async function getSpeexResamplerInstance() {
	if (!speexResamplerInstance) {
		const { default: SpeexResamplerInitializer } = await import('@echogarden/speex-resampler-wasm')

		speexResamplerInstance = await SpeexResamplerInitializer()
	}

	return speexResamplerInstance
}
