import { RawAudio } from '../audio/AudioUtilities.js'
import { extendDeep } from '../utilities/ObjectUtilities.js'
import { concatFloat32Arrays } from '../utilities/Utilities.js'
import { Float32ArrayRef, WasmMemoryManager } from '../utilities/WasmMemoryManager.js'

let rubberbandInstance: any

export async function stretchTimePitch(rawAudio: RawAudio, speed: number, pitchScale: number, options: RubberbandOptions) {
	options = extendDeep(defaultRubberbandOptions, options)

	const channels = rawAudio.audioChannels
	const channelCount = channels.length
	const sampleCount = channels[0].length
	const sampleRate = rawAudio.sampleRate

	const m = await getRubberbandInstance()
	const wasmMemory = new WasmMemoryManager(m)

	const optionFlags = rubberBandOptionsToFlags(options)

	const statePtr = m._rubberband_new(sampleRate, channelCount, optionFlags, 1, 1)
	m._rubberband_set_time_ratio(statePtr, 1 / speed)
	m._rubberband_set_pitch_scale(statePtr, pitchScale)

	const samplesRequired = m._rubberband_get_samples_required(statePtr)
	const bufferSize = Math.min(samplesRequired, sampleCount)

	const bufferChannelPtrsRef = wasmMemory.allocUint32Array(bufferSize)
	const bufferChannelRefs: Float32ArrayRef[] = []

	for (let i = 0; i < channelCount; i++) {
		const bufferChannelRef = wasmMemory.allocFloat32Array(bufferSize)
		bufferChannelPtrsRef.view[i] = bufferChannelRef.address

		bufferChannelRefs.push(bufferChannelRef)
	}

	m._rubberband_set_expected_input_duration(statePtr, sampleCount)

	//m._rubberband_set_max_process_size(statePtr, bufferSize)

	for (let offset = 0; offset < sampleCount; offset += bufferSize) {
		let writtenSize: number
		let isFinal: 0 | 1

		if (sampleCount - offset > bufferSize) {
			writtenSize = bufferSize
			isFinal = 0
		} else {
			writtenSize = sampleCount - offset
			isFinal = 1
		}

		for (let i = 0; i < channelCount; i++) {
			const samplesToWrite = channels[i].subarray(offset, offset + writtenSize)
			bufferChannelRefs[i].view.set(samplesToWrite)
		}

		m._rubberband_study(statePtr, bufferChannelPtrsRef.address, writtenSize, isFinal)
	}

	const outputAudioChannelChunks: Float32Array[][] = []

	for (let i = 0; i < channelCount; i++) {
		outputAudioChannelChunks.push([])
	}

	for (let readOffset = 0; readOffset < sampleCount; readOffset += bufferSize) {
		let writtenSize: number
		let isFinal: 0 | 1

		if (sampleCount - readOffset > bufferSize) {
			writtenSize = bufferSize
			isFinal = 0
		} else {
			writtenSize = sampleCount - readOffset
			isFinal = 1
		}

		for (let i = 0; i < channelCount; i++) {
			const samplesToWrite = channels[i].subarray(readOffset, readOffset + writtenSize)
			bufferChannelRefs[i].view.set(samplesToWrite)
		}

		m._rubberband_process(statePtr, bufferChannelPtrsRef.address, writtenSize, isFinal)

		while (true) {
			const samplesAvailable = m._rubberband_available(statePtr)
			if (samplesAvailable <= 0) {
				break
			}

			const sizeToRead = Math.min(samplesAvailable, bufferSize)

			const readCount = m._rubberband_retrieve(statePtr, bufferChannelPtrsRef.address, sizeToRead)

			for (let i = 0; i < channelCount; i++) {
				const readSamplesForChannel = bufferChannelRefs[i].view.slice(0, readCount)
				outputAudioChannelChunks[i].push(readSamplesForChannel)
			}
		}
	}

	m._rubberband_delete(statePtr)
	wasmMemory.freeAll()

	const outputAudioChannels = outputAudioChannelChunks.map(chunks => concatFloat32Arrays(chunks))
	const outputRawAudio: RawAudio = { audioChannels: outputAudioChannels, sampleRate }

	return outputRawAudio
}

export async function getRubberbandInstance() {
	if (!rubberbandInstance) {
		const { default: RubberbandInitializer } = await import('@echogarden/rubberband-wasm')

		rubberbandInstance = await RubberbandInitializer()
	}

	return rubberbandInstance
}

export function rubberBandOptionsToFlags(options: RubberbandOptions) {
	let flags = 0

	if (options.stretch == 'precise') {
		flags += RubberBandOptionFlag.StretchPrecise
	}

	if (options.transients == 'mixed') {
		flags += RubberBandOptionFlag.TransientsMixed
	} else if (options.transients == 'smooth') {
		flags += RubberBandOptionFlag.TransientsSmooth
	}

	if (options.detector == 'percussive') {
		flags += RubberBandOptionFlag.DetectorPercussive
	} else if (options.detector == 'soft') {
		flags += RubberBandOptionFlag.DetectorSoft
	}

	if (options.phase == 'independent') {
		flags += RubberBandOptionFlag.PhaseIndependent
	}

	if (options.window == 'short') {
		flags += RubberBandOptionFlag.WindowShort
	} else if (options.window == 'long') {
		flags += RubberBandOptionFlag.WindowLong
	}

	if (options.smoothing == 'on') {
		flags += RubberBandOptionFlag.SmoothingOn
	}

	if (options.formant == 'preserved') {
		flags += RubberBandOptionFlag.FormantPreserved
	}

	if (options.pitch == 'high-quality') {
		flags += RubberBandOptionFlag.PitchHighQuality
	} else if (options.pitch == 'high-consistency') {
		flags += RubberBandOptionFlag.PitchHighConsistency
	}

	if (options.channels == 'together') {
		flags += RubberBandOptionFlag.ChannelsTogether
	}

	if (options.engine == 'finer') {
		flags += RubberBandOptionFlag.EngineFiner
	}

	return flags
}

export enum RubberBandOptionFlag {
	ProcessOffline = 0x00000000,
	ProcessRealTime = 0x00000001,

	StretchElastic = 0x00000000,
	StretchPrecise = 0x00000010,

	TransientsCrisp = 0x00000000,
	TransientsMixed = 0x00000100,
	TransientsSmooth = 0x00000200,

	DetectorCompound = 0x00000000,
	DetectorPercussive = 0x00000400,
	DetectorSoft = 0x00000800,

	PhaseLaminar = 0x00000000,
	PhaseIndependent = 0x00002000,

	ThreadingAuto = 0x00000000,
	ThreadingNever = 0x00010000,
	ThreadingAlways = 0x00020000,

	WindowStandard = 0x00000000,
	WindowShort = 0x00100000,
	WindowLong = 0x00200000,

	SmoothingOff = 0x00000000,
	SmoothingOn = 0x00800000,

	FormantShifted = 0x00000000,
	FormantPreserved = 0x01000000,

	PitchHighSpeed = 0x00000000,
	PitchHighQuality = 0x02000000,
	PitchHighConsistency = 0x04000000,

	ChannelsApart = 0x00000000,
	ChannelsTogether = 0x10000000,

	EngineFaster = 0x00000000,
	EngineFiner = 0x20000000
}

export enum RubberBandPresetOption {
	DefaultOptions = 0x00000000,
	PercussiveOptions = 0x00102000,
}

export const defaultRubberbandOptions: RubberbandOptions = {
	stretch: 'elastic',
	transients: 'crisp',
	detector: 'compound',
	phase: 'laminar',
	window: 'standard',
	smoothing: 'off',
	formant: 'shited',
	pitch: 'high-speed',
	channels: 'apart',
	engine: 'faster'
}

export type RubberbandOptions = {
	stretch?: 'elastic' | 'precise'
	transients?: 'crisp' | 'mixed' | 'smooth'
	detector?: 'compound' | 'percussive' | 'soft'
	phase?: 'laminar' | 'independent'
	window?: 'standard' | 'long' | 'short'
	smoothing?: 'off' | 'on'
	formant?: 'shited' | 'preserved'
	pitch?: 'high-speed' | 'high-quality' | 'high-consistency'
	channels?: 'apart' | 'together'
	engine?: 'faster' | 'finer'
}
