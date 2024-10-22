import { SynthesisVoice } from '../api/API.js'
import { decodeToChannels } from '../audio/AudioBufferConversion.js'
import { SampleFormat } from '../codecs/WaveCodec.js'
import { bandwidthToQFactor } from '../dsp/BiquadFilter.js'
import { Logger } from '../utilities/Logger.js'
import { WasmMemoryManager } from '../utilities/WasmMemoryManager.js'
import { RawAudio } from '../audio/AudioUtilities.js'
import { readFileAsBinary } from '../utilities/FileSystem.js'
import { concatUint8Arrays } from '../utilities/Utilities.js'

let svoxPicoInstance: any

export async function synthesize(text: string, textAnalysisFilePath: string, signalGenerationFilePath: string, postprocessOutput = true) {
	const logger = new Logger()
	logger.start('Get pico WASM instance')

	const m = await getInstance()

	logger.start('Initialize pico engine')

	const wasmMemory = new WasmMemoryManager(m)

	const pico_initialize = m._pico_initialize
	const picoext_setTraceLevel = m._picoext_setTraceLevel
	const pico_loadResource = m._pico_loadResource
	const pico_getResourceName = m._pico_getResourceName
	const pico_createVoiceDefinition = m._pico_createVoiceDefinition
	const pico_addResourceToVoiceDefinition = m._pico_addResourceToVoiceDefinition
	const pico_newEngine = m._pico_newEngine
	const pico_putTextUtf8 = m._pico_putTextUtf8
	const pico_getData = m._pico_getData

	const pico_getSystemStatusMessage = m._pico_getSystemStatusMessage

	const pico_disposeEngine = m._pico_disposeEngine
	const pico_terminate = m._pico_terminate
	const pico_releaseVoiceDefinition = m._pico_releaseVoiceDefinition
	const pico_unloadResource = m._pico_unloadResource

	const picoMemSize = 2500000
	const picoMemAreaRef = wasmMemory.allocUint8Array(picoMemSize)

	const systemPtrRef = wasmMemory.allocPointer()

	let resultCode = pico_initialize(picoMemAreaRef.address, picoMemAreaRef.length, systemPtrRef.address)
	const systemPtr = systemPtrRef.value

	throwErrorIfFailed(resultCode, 'Failed Pico initialization.')

	picoext_setTraceLevel(systemPtr, 5)

	async function loadResource(localFilePath: string) {
		const virtualFilePath = '.' + localFilePath.substring(localFilePath.lastIndexOf('/'))

		const fileData = await readFileAsBinary(localFilePath)
		m.FS.writeFile(virtualFilePath, fileData)

		const virtualFilePathRef = wasmMemory.allocNullTerminatedUtf8String(virtualFilePath)
		const resourcePtrRef = wasmMemory.allocPointer()

		resultCode = pico_loadResource(systemPtr, virtualFilePathRef.address, resourcePtrRef.address)
		const resourcePtr = resourcePtrRef.value

		throwErrorIfFailed(resultCode, `Failed loading Pico resource ${localFilePath}.`)

		return { resourcePtr, resourcePtrRef }
	}

	const { resourcePtr: textAnalysisResourcePtr, resourcePtrRef: textAnalysisResourcePtrRef } = await loadResource(textAnalysisFilePath)
	const { resourcePtr: signalGenerationResourcePtr, resourcePtrRef: signalGenerationResourcePtrRef } = await loadResource(signalGenerationFilePath)

	function getResourceName(resourcePtr: number) {
		const resourceNameRef = wasmMemory.allocUint8Array(32)
		resultCode = pico_getResourceName(systemPtr, resourcePtr, resourceNameRef.address)

		throwErrorIfFailed(resultCode, `Failed getting Pico resource name.`)

		const resourceName = resourceNameRef.readAsNullTerminatedUtf8String()

		return { resourceName, resourceNameRef }
	}

	const { resourceName: textAnalysisResourceName, resourceNameRef: textAnalysisResourceNameRef } = getResourceName(textAnalysisResourcePtr)
	const { resourceName: signalGenerationResourceName, resourceNameRef: signalGenerationResourceNameRef } = getResourceName(signalGenerationResourcePtr)

	const voiceNameRef = wasmMemory.allocNullTerminatedUtf8String('PicoVoice')

	resultCode = pico_createVoiceDefinition(systemPtr, voiceNameRef.address)

	function addResourceToVoiceDefinition(resourceNamePtr: number) {
		resultCode = pico_addResourceToVoiceDefinition(systemPtr, voiceNameRef.address, resourceNamePtr)

		throwErrorIfFailed(resultCode, `Failed adding resource to voice definition.`)
	}

	addResourceToVoiceDefinition(textAnalysisResourceNameRef.address)
	addResourceToVoiceDefinition(signalGenerationResourceNameRef.address)

	const enginePtrRef = wasmMemory.allocPointer()
	resultCode = pico_newEngine(systemPtr, voiceNameRef.address, enginePtrRef.address)

	throwErrorIfFailed(resultCode, `Failed creating new engine.`)

	const enginePtr = enginePtrRef.value

	logger.start('Synthesize with pico')

	const textRef = wasmMemory.allocNullTerminatedUtf8String(text)

	const bytesWrittenRef = wasmMemory.allocInt32()

	const audioParts: Uint8Array[] = []

	for (let textByteOffset = 0; textByteOffset < textRef.length;) {
		bytesWrittenRef.value = 0
		resultCode = pico_putTextUtf8(enginePtr, textRef.address + textByteOffset, textRef.length - textByteOffset, bytesWrittenRef.address)
		const bytesWritten = bytesWrittenRef.value

		throwErrorIfFailed(resultCode, `Failed writing text to engine.`)

		const audioPart = readAudioDataFromEngine()
		audioParts.push(audioPart)

		textByteOffset += bytesWritten
	}

	const audioData = concatUint8Arrays(audioParts)

	function readAudioDataFromEngine() {
		const outBuffers: Uint8Array[] = []

		const outBufferLength = 16384
		const outBufferRef = wasmMemory.allocUint8Array(outBufferLength)

		const outByteCountRef = wasmMemory.allocInt16()
		const outDataTypeRef = wasmMemory.allocInt16()

		while (true) {
			resultCode = pico_getData(enginePtr, outBufferRef.address, outBufferRef.length, outByteCountRef.address, outDataTypeRef.address)

			throwErrorIfFailed(resultCode, `Failed getting audio data from engine.`, [200, 201])

			const outByteCount = outByteCountRef.value
			const outDataType = outDataTypeRef.value

			if (resultCode == 200) {
				break
			}

			if (outByteCount > 0) {
				outBuffers.push(outBufferRef.slice(0, outByteCount) as Uint8Array)
			}
		}

		return concatUint8Arrays(outBuffers)
	}

	dispose()

	function dispose() {
		if (!systemPtr) {
			return
		}

		if (enginePtrRef) {
			pico_disposeEngine(systemPtr, enginePtrRef.address)
		}

		if (voiceNameRef) {
			pico_releaseVoiceDefinition(systemPtr, voiceNameRef.address)
		}

		if (textAnalysisResourcePtrRef) {
			pico_unloadResource(systemPtr, textAnalysisResourcePtrRef.address)
		}

		if (signalGenerationResourcePtrRef) {
			pico_unloadResource(systemPtr, signalGenerationResourcePtrRef.address)
		}

		pico_terminate(systemPtrRef.address)

		wasmMemory.freeAll()
	}

	function throwErrorIfFailed(resultCode: number, title: string, successCodes = [0]) {
		if (successCodes.includes(resultCode)) {
			return
		}

		const picoErrorMessageRef = wasmMemory.allocUint8Array(200)
		pico_getSystemStatusMessage(systemPtr, resultCode, picoErrorMessageRef)
		const picoErrorMessage = picoErrorMessageRef.readAsNullTerminatedUtf8String()

		dispose()
		throw new Error(`${title} ${picoErrorMessage}`)
	}

	const audioChannels = decodeToChannels(audioData, 1, 16, SampleFormat.PCM)
	let rawAudio: RawAudio = { audioChannels, sampleRate: 16000 }

	if (postprocessOutput) {
		logger.start('Apply EQ to synthesized audio')

		const Biquad = await import('../dsp/BiquadFilter.js')

		Biquad.createLowshelfFilter(rawAudio.sampleRate, 177, -2.6).filterSamplesInPlace(rawAudio.audioChannels[0])
		Biquad.createPeakingFilter(rawAudio.sampleRate, 440, bandwidthToQFactor(2), -9.7).filterSamplesInPlace(rawAudio.audioChannels[0])
		//Biquad.createPeakingFilter(rawAudio.sampleRate, 1639, bandwidthToQFactor(2), 5.2).filterSamplesInPlace(rawAudio.audioChannels[0])
		Biquad.createHighshelfFilter(rawAudio.sampleRate, 5180, 10.6).filterSamplesInPlace(rawAudio.audioChannels[0])
	}

	logger.end()

	return { rawAudio }
}

export async function getInstance() {
	if (!svoxPicoInstance) {
		const { default: initializer } = await import('@echogarden/svoxpico-wasm')

		svoxPicoInstance = await initializer()
	}

	return svoxPicoInstance
}

export function getResourceFilenamesForLanguage(language: string) {
	let textAnalysisFilename: string
	let signalGenerationFilename: string

	switch (language) {
		case 'en-US':
		case 'en': {
			textAnalysisFilename = 'en-US_ta.bin'
			signalGenerationFilename = 'en-US_lh0_sg.bin'
			break
		}

		case 'en-GB': {
			textAnalysisFilename = 'en-GB_ta.bin'
			signalGenerationFilename = 'en-GB_kh0_sg.bin'
			break
		}

		case 'de-DE':
		case 'de': {
			textAnalysisFilename = 'de-DE_ta.bin'
			signalGenerationFilename = 'de-DE_gl0_sg.bin'
			break
		}

		case 'es-ES':
		case 'es': {
			textAnalysisFilename = 'es-ES_ta.bin'
			signalGenerationFilename = 'es-ES_zl0_sg.bin'
			break
		}

		case 'fr-FR':
		case 'fr': {
			textAnalysisFilename = 'fr-FR_ta.bin'
			signalGenerationFilename = 'fr-FR_nk0_sg.bin'
			break
		}

		case 'it-IT':
		case 'it': {
			textAnalysisFilename = 'it-IT_ta.bin'
			signalGenerationFilename = 'it-IT_cm0_sg.bin'
			break
		}

		default: {
			throw new Error(`Unsupported languge: ${language}`)
		}
	}

	return { textAnalysisFilename, signalGenerationFilename }
}

export const voiceList: SynthesisVoice[] = [
	{
		name: 'en-US',
		languages: ['en-US', 'en'],
		gender: 'female',
		packageName: 'pico-en-US'
	},
	{
		name: 'en-GB',
		languages: ['en-GB', 'en'],
		gender: 'female',
		packageName: 'pico-en-GB'
	},
	{
		name: 'de-DE',
		languages: ['de-DE', 'de'],
		gender: 'female',
		packageName: 'pico-de-DE'
	},
	{
		name: 'es-ES',
		languages: ['es-ES', 'es'],
		gender: 'female',
		packageName: 'pico-es-ES'
	},
	{
		name: 'fr-FR',
		languages: ['fr-FR', 'fr'],
		gender: 'female',
		packageName: 'pico-fr-FR'
	},
	{
		name: 'it-IT',
		languages: ['it-IT', 'it'],
		gender: 'female',
		packageName: 'pico-it-IT'
	},
]
