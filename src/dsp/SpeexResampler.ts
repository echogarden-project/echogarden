import { RawAudio, cloneRawAudio } from '../audio/AudioUtilities.js'
import { concatFloat32Arrays, isWasmSimdSupported } from '../utilities/Utilities.js'
import { WasmMemoryManager } from '../utilities/WasmMemoryManager.js'

let speexResamplerInstance: any

export async function resampleAudioSpeex(rawAudio: RawAudio, outSampleRate: number, quality = 0): Promise<RawAudio> {
	const channelCount = rawAudio.audioChannels.length
	const inSampleRate = rawAudio.sampleRate

	const totalSampleCount = rawAudio.audioChannels[0].length
	const sampleRateRatio = outSampleRate / inSampleRate

	if (inSampleRate === outSampleRate) {
		return cloneRawAudio(rawAudio)
	}

	if (totalSampleCount === 0) {
		return {
			...cloneRawAudio(rawAudio),
			sampleRate: outSampleRate
		} as RawAudio
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
	const resamplerStateAddress = m._speex_resampler_init(channelCount, inSampleRate, outSampleRate, quality, initErrRef.address)
	let resultCode = initErrRef.value

	if (resultCode != 0) {
		throw new Error(`Speex resampler failed while initializing with code ${resultCode}: ${speexResultCodeToString(resultCode)}`)
	}

	const inputLatency = m._speex_resampler_get_input_latency(resamplerStateAddress)
	const outputLatency = m._speex_resampler_get_output_latency(resamplerStateAddress)

	const maxChunkSize = 2 ** 20

	const inputChunkSampleCountRef = wasmMemory.allocInt32()
	const outputChunkSampleCountRef = wasmMemory.allocInt32()

	const inputChunkSamplesRef = wasmMemory.allocFloat32Array(maxChunkSize * 2)
	const outputChunkSamplesRef = wasmMemory.allocFloat32Array(Math.floor(maxChunkSize * sampleRateRatio) * 2)

	const resampledAudioChunksForChannels: Float32Array[][] = []

	for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
		resampledAudioChunksForChannels.push([])
	}

	for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
		for (let readOffset = 0; readOffset < totalSampleCount;) {
			const isLastChunk = readOffset + maxChunkSize >= totalSampleCount

			const inputPaddingSize = isLastChunk ? inputLatency : 0
			const maxSamplesToRead = Math.min(maxChunkSize, totalSampleCount - readOffset) + inputPaddingSize

			const maxSamplesToWrite = outputChunkSamplesRef.length

			const inputChunkSamplesForChannel = rawAudio.audioChannels[channelIndex].slice(readOffset, readOffset + maxSamplesToRead)

			inputChunkSampleCountRef.value = maxSamplesToRead
			outputChunkSampleCountRef.value = maxSamplesToWrite

			inputChunkSamplesRef.view.set(inputChunkSamplesForChannel)
			resultCode = m._speex_resampler_process_float(resamplerStateAddress, channelIndex, inputChunkSamplesRef.address, inputChunkSampleCountRef.address, outputChunkSamplesRef.address, outputChunkSampleCountRef.address)

			if (resultCode != 0) {
				throw new Error(`Speex resampler failed while resampling with code ${resultCode}: ${speexResultCodeToString(resultCode)}`)
			}

			const samplesReadCount = inputChunkSampleCountRef.value
			const samplesWrittenCount = outputChunkSampleCountRef.value

			const resampledChannelAudio = outputChunkSamplesRef.view.slice(0, samplesWrittenCount)

			resampledAudioChunksForChannels[channelIndex].push(resampledChannelAudio)

			readOffset += samplesReadCount
		}
	}

	m._speex_resampler_destroy(resamplerStateAddress)
	wasmMemory.freeAll()

	const resampledAudio: RawAudio = {
		audioChannels: [],
		sampleRate: outSampleRate
	}

	for (let i = 0; i < channelCount; i++) {
		resampledAudioChunksForChannels[i][0] = resampledAudioChunksForChannels[i][0].slice(outputLatency)

		resampledAudio.audioChannels.push(concatFloat32Arrays(resampledAudioChunksForChannels[i]))
	}

	return resampledAudio
}

export async function getSpeexResamplerInstance() {
	if (!speexResamplerInstance) {
		if (await isWasmSimdSupported()) {
			const { default: SpeexResamplerInitializer } = await import('@echogarden/speex-resampler-wasm/simd')
			speexResamplerInstance = await SpeexResamplerInitializer()
		} else {
			const { default: SpeexResamplerInitializer } = await import('@echogarden/speex-resampler-wasm')
			speexResamplerInstance = await SpeexResamplerInitializer()
		}
	}

	return speexResamplerInstance
}
