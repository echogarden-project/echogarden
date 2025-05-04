import * as WaveCodec from '@echogarden/wave-codec'
import { BitDepth, SampleFormat } from '@echogarden/wave-codec'

/////////////////////////////////////////////////////////////////////////////////////////////
// Low level audio sample conversions
/////////////////////////////////////////////////////////////////////////////////////////////
export function encodeToAudioBuffer(audioChannels: Float32Array[], targetBitDepth: BitDepth = 16, targetSampleFormat: SampleFormat = SampleFormat.PCM): Uint8Array {
	return WaveCodec.float32ChannelsToBuffer(audioChannels, targetBitDepth, targetSampleFormat)
}

export function decodeToChannels(audioBuffer: Uint8Array, channelCount: number, sourceBitDepth: BitDepth, sourceSampleFormat: SampleFormat) {
	return WaveCodec.bufferToFloat32Channels(audioBuffer, channelCount, sourceBitDepth, sourceSampleFormat)
}

export function float32ToUint8Pcm(input: Float32Array) {
	return WaveCodec.float32ToUint8Pcm(input)
}

export function int16PcmToFloat32(input: Int16Array) {
	return WaveCodec.int16PcmToFloat32(input)
}

export function float32ToInt16Pcm(input: Float32Array) {
	return WaveCodec.float32ToInt16Pcm(input)
}

export function int24PcmToFloat32(input: Int32Array) {
	return WaveCodec.int24PcmToFloat32(input)
}

export function float32ToInt24Pcm(input: Float32Array) {
	return WaveCodec.float32ToInt24Pcm(input)
}

export function int32PcmToFloat32(input: Int32Array) {
	return WaveCodec.int32PcmToFloat32(input)
}

export function float32ToInt32Pcm(input: Float32Array) {
	return WaveCodec.float32ToInt32Pcm(input)
}

export function interleaveChannels(channels: Float32Array[]) {
	return WaveCodec.interleaveChannels(channels)
}

export function deinterleaveChannels(interleavedChannels: Float32Array, channelCount: number) {
	return WaveCodec.deinterleaveChannels(interleavedChannels, channelCount)
}

export { type BitDepth, SampleFormat } from '@echogarden/wave-codec'
