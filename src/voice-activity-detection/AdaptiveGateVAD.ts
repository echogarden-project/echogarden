import { RawAudio, getRawAudioDuration } from '../audio/AudioUtilities.js';
import { BiquadFilter, createHighpassFilter, createLowpassFilter } from '../dsp/BiquadFilter.js';
import { DecayingPeakEstimator } from '../dsp/DecayingPeakEstimator.js';
import { LoudnessEstimator } from '../dsp/LoudnessEstimator.js';
import { extendDeep } from '../utilities/ObjectUtilities.js';
import { Timeline } from '../utilities/Timeline.js';
import { logToStderr } from '../utilities/Utilities.js';

const log = logToStderr

export async function detectVoiceActivity(rawAudio: RawAudio, options: AdaptiveGateVADOptions) {
	const channelCount = rawAudio.audioChannels.length
	const sampleCount = rawAudio.audioChannels[0].length
	const sampleRate = rawAudio.sampleRate

	const audioDuration = getRawAudioDuration(rawAudio)

	options = extendDeep(defaultAdaptiveGateOptions, options)

	const gateVAD = new AdaptiveGateVAD(sampleRate, channelCount, options)

	type FrameRecord = {
		timePosition: number
		loudness: number
		minimumLoudness: number
		maximumLoudness: number
	}

	const frameDuration = 0.01

	const frameRecords: FrameRecord[] = []

	for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
		const timePosition = sampleIndex / sampleRate

		for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
			const sample = rawAudio.audioChannels[channelIndex][sampleIndex]

			gateVAD.process(sample, channelIndex)
		}

		if (
			frameRecords.length == 0 ||
			timePosition > frameRecords[frameRecords.length - 1].timePosition + frameDuration) {

			const record: FrameRecord = {
				timePosition,
				loudness: gateVAD.loudnessEstimator.currentLoudness,
				minimumLoudness: gateVAD.minimumLoudnessEstimator.currentPeak,
				maximumLoudness: gateVAD.maximumLoudnessEstimator.currentPeak,
			}

			frameRecords.push(record)

			//log(`${timePosition.toFixed(3)}: loudness: ${record.loudness.toFixed(2)}dB, min: ${record.minimumLoudness.toFixed(2)}dB, max: ${record.maximumLoudness.toFixed(2)}dB dynamic range: ${record.dynamicRange.toFixed(2)}dB`)
		}
	}

	const frameActive: boolean[] = []

	for (let i = 0; i < frameRecords.length; i++) {
		frameActive[i] = false
	}

	{
		const backwardExtensionFrameCount = Math.floor(options.backwardExtensionDuration! / frameDuration)
		const relativeThreshold = options.relativeThreshold!

		let extendedActivityStartIndex = frameRecords.length

		for (let i = frameRecords.length - 1; i >= 0; i--) {
			const record = frameRecords[i]
			const referenceLoudness = Math.max(record.maximumLoudness, -30)

			let isActive = false

			if (i >= extendedActivityStartIndex) {
				isActive = true
			}

			if (record.loudness >= referenceLoudness + relativeThreshold) {
				isActive = true

				extendedActivityStartIndex = Math.max(i - backwardExtensionFrameCount, 0)
			}

			frameActive[i] = isActive
		}
	}

	const timeline: Timeline = []

	for (let i = 0; i < frameRecords.length; i++) {
		const record = frameRecords[i]
		const isActive = frameActive[i]
		const activityText = isActive ? 'active' : 'inactive'
		const startTime = record.timePosition
		const endTime = Math.min(startTime + frameDuration, audioDuration)

		if (timeline.length == 0 || timeline[timeline.length - 1].text != activityText) {
			timeline.push({
				type: 'segment',
				text: activityText,
				startTime,
				endTime,
			})
		} else {
			timeline[timeline.length - 1].endTime = endTime
		}
	}

	return timeline
}

export class AdaptiveGateVAD {
	channelHighpassFilters: BiquadFilter[]
	channelLowpassFilters: BiquadFilter[]

	loudnessEstimator: LoudnessEstimator

	minimumLoudnessEstimator: DecayingPeakEstimator
	maximumLoudnessEstimator: DecayingPeakEstimator

	constructor(
		public readonly sampleRate: number,
		public readonly channelCount: number,
		public readonly options: AdaptiveGateVADOptions) {

		this.channelHighpassFilters = []
		this.channelLowpassFilters = []

		for (let i = 0; i < this.channelCount; i++) {
			this.channelHighpassFilters.push(createHighpassFilter(this.sampleRate, options.lowCutoff!))
			this.channelLowpassFilters.push(createLowpassFilter(this.sampleRate, options.highCutoff!))
		}

		this.loudnessEstimator = new LoudnessEstimator({
			sampleRate: this.sampleRate,
			channelCount: this.channelCount,
			positiveAdaptationRate: options.positiveAdaptationRate!,
			negativeAdaptationRate: options.negativeAdaptationRate!,
			initialEstimate: -60,
			minimumLoudness: -60,
			applyKWeighting: false,
		})

		const ticksPerSecond = this.sampleRate * this.channelCount

		this.minimumLoudnessEstimator = new DecayingPeakEstimator({
			kind: 'minimum',
			decayPerSecond: options.peakLoudnessDecay!,
			initialPeak: -60,
		}, ticksPerSecond)

		this.maximumLoudnessEstimator = new DecayingPeakEstimator({
			kind: 'maximum',
			decayPerSecond: options.peakLoudnessDecay!,
			initialPeak: -60,
		}, ticksPerSecond)
	}

	process(sample: number, channelIndex: number) {
		sample = this.channelHighpassFilters[channelIndex].filter(sample)
		sample = this.channelLowpassFilters[channelIndex].filter(sample)

		this.loudnessEstimator.process(sample, channelIndex)

		const currentLoudness = this.loudnessEstimator.currentLoudness

		this.minimumLoudnessEstimator.process(currentLoudness)

		if (currentLoudness >= -60) {
			this.maximumLoudnessEstimator.process(currentLoudness)
		}
	}
}

export interface AdaptiveGateVADOptions {
	lowCutoff?: number
	highCutoff?: number

	positiveAdaptationRate?: number,
	negativeAdaptationRate?: number,

	peakLoudnessDecay?: number,

	backwardExtensionDuration?: number
	relativeThreshold?: number
}

export const defaultAdaptiveGateOptions: AdaptiveGateVADOptions = {
	lowCutoff: 100,
	highCutoff: 1000,

	positiveAdaptationRate: 400.0,
	negativeAdaptationRate: 10.0,

	peakLoudnessDecay: 4.0,

	backwardExtensionDuration: 0.2,
	relativeThreshold: -15,
}
