import { SynthesisVoice } from '../api/API.js'
import { decodeWaveToRawAudio } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'
import { getRandomHexString, logToStderr, resolveModuleMainPath } from '../utilities/Utilities.js'
import { open, close, remove, ensureDir, readFileAsBinary, readFileAsUtf8 } from '../utilities/FileSystem.js'
import { getAppTempDir, joinPath } from '../utilities/PathUtilities.js'

const log = logToStderr

export type FliteVoiceName = 'kal' | 'kal16' | 'awb' | 'rms' | 'slt' | string

let fliteModuleObject: WebAssembly.Module

export async function synthesize(text: string, voice: FliteVoiceName, voiceDir: string | undefined, rate: number, pitchMeanHz?: number, pitchStdDev?: number) {
	const logger = new Logger()
	logger.start('Get Flite WASI instance')

	const randomId = getRandomHexString(16)

	const outFileName = `${randomId}.out.wav`
	const stdOutFileName = `${randomId}.stdout`

	const tempDir = getAppTempDir('flite')
	await ensureDir(tempDir)

	const tempAudioFilePath = joinPath(tempDir, outFileName)
	const tempStdOutFilePath = joinPath(tempDir, stdOutFileName)

	const stdOutFileFd = await open(tempStdOutFilePath, 'w+')

	if (voiceDir) {
		voice = `voices/${voice}.flitevox`
	}

	const optionArgs = [
		'-voice', voice,
		'--setf', `duration_stretch=${1.0 / rate}`,
	]

	if (pitchMeanHz != null) {
		optionArgs.push('--setf', `int_f0_target_mean=${pitchMeanHz}`)
	}

	if (pitchStdDev != null) {
		optionArgs.push('--setf', `int_f0_target_stddev=${pitchStdDev}`)
	}

	const preopens: { [k: string]: string } = {
		'.': tempDir,
	}

	if (voiceDir != undefined) {
		preopens['./voices'] = voiceDir
	}

	const { WASI } = await import('wasi')

	const wasi = new WASI({
		version: 'preview1',

		env: {
		},

		args: ['--',
			//'-ssml',
			'-psdur',
			...optionArgs,
			//` ${escapeHtml(text)} `,
			` ${text} `,
			outFileName
		],

		preopens,

		stdout: stdOutFileFd,

		returnOnExit: true
	})

	// Some WASI binaries require `const importObject = { wasi_unstable: wasi.wasiImport }`
	const importObject = { wasi_snapshot_preview1: wasi.wasiImport }

	const moduleObject = await getModuleObject()
	const instance = await WebAssembly.instantiate(moduleObject, importObject)

	logger.start('Synthesize with flite')
	const exitCode: number = wasi.start(instance) as any

	await close(stdOutFileFd)

	async function cleanup() {
		await remove(tempAudioFilePath)
		await remove(tempStdOutFilePath)
	}

	if (exitCode != 0) {
		await cleanup()
		throw new Error(`Flite failed with exit code ${exitCode}`)
	}

	const waveData = await readFileAsBinary(tempAudioFilePath)
	const stdOutString = await readFileAsUtf8(tempStdOutFilePath)

	await cleanup()

	const events = parseEventsFromTrace(stdOutString)

	const { rawAudio } = decodeWaveToRawAudio(waveData)

	logger.end()

	return { rawAudio, events }
}

async function getModuleObject() {
	if (!fliteModuleObject) {
		const fliteWasiPath = await resolveModuleMainPath('@echogarden/flite-wasi')

		fliteModuleObject = await WebAssembly.compile(await readFileAsBinary(fliteWasiPath))
	}

	return fliteModuleObject
}

function parseEventsFromTrace(eventTrace: string) {
	//log(eventTrace)

	const eventStrings = eventTrace.trim().split(' ')
	const eventCount = eventStrings.length

	const events: FliteEvent[] = []
	let phraseStartOffset = 0

	for (let i = 0; i < eventCount; i++) {
		const eventString = eventStrings[i]
		const splitPoint = eventString.lastIndexOf(':')

		const id = eventString.substring(0, splitPoint)
		const startTime = events.length > 0 ? events[events.length - 1].endTime : 0

		let eventType: FliteEventType

		if (id == 'pau') {
			eventType = 'pause'
		} else if (id == '\npau') {
			eventType = 'phrasePause'

			phraseStartOffset = startTime
		} else {
			eventType = 'phone'
		}

		const endTime = phraseStartOffset + parseFloat(eventString.substring(splitPoint + 1))

		events.push({
			type: eventType,
			id,
			startTime,
			endTime
		})
	}

	return events
}

export type FliteEventType = 'phone' | 'pause' | 'phrasePause'

export type FliteEvent = {
	type: FliteEventType,
	id: string,
	startTime: number,
	endTime: number
}

export const voiceList: SynthesisVoice[] = [
	// Built-in voices
	{
		name: 'slt',
		languages: ['en-US', 'en'],
		gender: 'female'
	},
	{
		name: 'kal16',
		languages: ['en-US', 'en'],
		gender: 'male'
	},
	{
		name: 'rms',
		languages: ['en-US', 'en'],
		gender: 'male'
	},
	{
		name: 'awb',
		languages: ['en-GB-SCOTLAND', 'en-GB', 'en'],
		gender: 'male'
	},
	{
		name: 'kal',
		languages: ['en-US', 'en'],
		gender: 'male'
	},


	// Voices loaded from packages
	// US English voices
	{
		name: 'cmu_us_aew',
		languages: ['en-US', 'en'],
		gender: 'male',
		packageName: 'flite-cmu_us_aew'
	},
	{
		name: 'cmu_us_ahw',
		languages: ['en-US', 'en'],
		gender: 'male',
		packageName: 'flite-cmu_us_ahw'
	},
	{
		name: 'cmu_us_aup',
		languages: ['en-US', 'en'],
		gender: 'male',
		packageName: 'flite-cmu_us_aup'
	},
	{
		name: 'cmu_us_awb',
		languages: ['en-US', 'en'],
		gender: 'male',
		packageName: 'flite-cmu_us_awb'
	},
	{
		name: 'cmu_us_axb',
		languages: ['en-US', 'en'],
		gender: 'female',
		packageName: 'flite-cmu_us_axb'
	},
	{
		name: 'cmu_us_bdl',
		languages: ['en-US', 'en'],
		gender: 'male',
		packageName: 'flite-cmu_us_bdl'
	},
	{
		name: 'cmu_us_clb',
		languages: ['en-US', 'en'],
		gender: 'female',
		packageName: 'flite-cmu_us_clb'
	},
	{
		name: 'cmu_us_eey',
		languages: ['en-US', 'en'],
		gender: 'female',
		packageName: 'flite-cmu_us_eey'
	},
	{
		name: 'cmu_us_fem',
		languages: ['en-US', 'en'],
		gender: 'male',
		packageName: 'flite-cmu_us_fem'
	},
	{
		name: 'cmu_us_gka',
		languages: ['en-US', 'en'],
		gender: 'male',
		packageName: 'flite-cmu_us_gka'
	},
	{
		name: 'cmu_us_jmk',
		languages: ['en-US', 'en'],
		gender: 'male',
		packageName: 'flite-cmu_us_jmk'
	},
	{
		name: 'cmu_us_ksp',
		languages: ['en-US', 'en'],
		gender: 'male',
		packageName: 'flite-cmu_us_ksp'
	},
	{
		name: 'cmu_us_ljm',
		languages: ['en-US', 'en'],
		gender: 'female',
		packageName: 'flite-cmu_us_ljm'
	},
	{
		name: 'cmu_us_lnh',
		languages: ['en-US', 'en'],
		gender: 'female',
		packageName: 'flite-cmu_us_lnh'
	},
	{
		name: 'cmu_us_rms',
		languages: ['en-US', 'en'],
		gender: 'male',
		packageName: 'flite-cmu_us_rms'
	},
	{
		name: 'cmu_us_rxr',
		languages: ['en-US', 'en'],
		gender: 'male',
		packageName: 'flite-cmu_us_rxr'
	},
	{
		name: 'cmu_us_slp',
		languages: ['en-US', 'en'],
		gender: 'female',
		packageName: 'flite-cmu_us_slp'
	},
	{
		name: 'cmu_us_slt',
		languages: ['en-US', 'en'],
		gender: 'female',
		packageName: 'flite-cmu_us_slt'
	},

	// Indic voices
	{
		name: 'cmu_indic_ben_rm',
		languages: ['be', 'bn'],// Bengali
		gender: 'female',
		packageName: 'flite-cmu_indic_ben_rm'
	},
	{
		name: 'cmu_indic_guj_ad',
		languages: ['gu'],// Gujarati
		gender: 'male',
		packageName: 'flite-cmu_indic_guj_ad'
	},
	{
		name: 'cmu_indic_guj_dp',
		languages: ['gu'],// Gujarati
		gender: 'female',
		packageName: 'flite-cmu_indic_guj_dp'
	},
	{
		name: 'cmu_indic_guj_kt',
		languages: ['gu'],// Gujarati
		gender: 'female',
		packageName: 'flite-cmu_indic_guj_kt'
	},
	{
		name: 'cmu_indic_hin_ab',
		languages: ['hi'],// Hindi
		gender: 'female',
		packageName: 'flite-cmu_indic_hin_ab'
	},
	{
		name: 'cmu_indic_kan_plv',
		languages: ['ka'],// Kannada
		gender: 'female',
		packageName: 'flite-cmu_indic_kan_plv'
	},
	{
		name: 'cmu_indic_mar_aup',
		languages: ['mr'],// Marathi
		gender: 'male',
		packageName: 'flite-cmu_indic_mar_aup'
	},
	{
		name: 'cmu_indic_mar_slp',
		languages: ['mr'],// Marathi
		gender: 'female',
		packageName: 'flite-cmu_indic_mar_slp'
	},
	{
		name: 'cmu_indic_pan_amp',
		languages: ['pa'],// Punjabi
		gender: 'female',
		packageName: 'flite-cmu_indic_pan_amp'
	},
	{
		name: 'cmu_indic_tel_kpn',
		languages: ['te'],// Telugu
		gender: 'female',
		packageName: 'flite-cmu_indic_tel_kpn'
	},
	{
		name: 'cmu_indic_tel_sk',
		languages: ['te'],// Telugu
		gender: 'male',
		packageName: 'flite-cmu_indic_tel_sk'
	},
	{
		name: 'cmu_indic_tel_ss',
		languages: ['te'],// Telugu
		gender: 'female',
		packageName: 'flite-cmu_indic_tel_ss'
	},
]
