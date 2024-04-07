import { decibelsToGainFactor, gainFactorToDecibels } from '../audio/AudioUtilities.js';
import { SmoothEstimator } from '../utilities/SmoothEstimator.js';
import { KWeightingFilter } from './KWeightingFilter.js';

export class LoudnessEstimator {
	readonly channelFilters: KWeightingFilter[] = []
	readonly channelMeanSquares: SmoothEstimator[] = []

	readonly minPower: number

	constructor(public readonly options: LoudnessEstimatorOptions) {
		const initialMeanSquares = decibelsToGainFactor(options.initialEstimate) ** 2

		const ticksPerSecond = this.options.sampleRate * this.options.channelCount

		for (let i = 0; i < options.channelCount; i++) {
			const weightingFilter =
				new KWeightingFilter(options.sampleRate)

			const channelMeanSquares =
				new SmoothEstimator(options.positiveAdaptationRate / ticksPerSecond, options.negativeAdaptationRate / ticksPerSecond, initialMeanSquares)

			this.channelFilters.push(weightingFilter)
			this.channelMeanSquares.push(channelMeanSquares)
		}

		this.minPower = decibelsToGainFactor(options.minimumLoudness) ** 2
	}

	process(sample: number, channel: number) {
		let filteredSample: number

		if (this.options.applyKWeighting) {
			filteredSample = this.channelFilters[channel].process(sample)
		} else {
			filteredSample = sample
		}

		const filteredSampleSquared = filteredSample ** 2

		const channelMeanSquares = this.channelMeanSquares[channel]

		channelMeanSquares.update(filteredSampleSquared)

		channelMeanSquares.estimate = Math.max(channelMeanSquares.estimate, this.minPower)
	}

	get currentLoudness() {
		let totalMeanSquares = 0

		for (let i = 0; i < this.options.channelCount; i++) {
			totalMeanSquares += this.channelMeanSquares[i].estimate
		}

		const rms = Math.sqrt(totalMeanSquares / this.options.channelCount)
		const rmsDecibels = gainFactorToDecibels(rms)

		return rmsDecibels
	}

	getCurrentRMSForChannel(channel: number) {
		return Math.sqrt(this.channelMeanSquares[channel].estimate)
	}
}

export interface LoudnessEstimatorOptions {
	sampleRate: number
	channelCount: number
	positiveAdaptationRate: number
	negativeAdaptationRate: number
	initialEstimate: number
	minimumLoudness: number
	applyKWeighting: boolean
}
