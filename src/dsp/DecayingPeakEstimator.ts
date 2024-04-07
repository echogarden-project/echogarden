export class DecayingPeakEstimator {
	public readonly decayPerTick: number

	currentPeak: number

	constructor(
		public readonly options: DecayingPeakEstimatorOptions,
		public readonly ticksPerSecond: number) {

		this.currentPeak = options.initialPeak
		this.decayPerTick = this.options.decayPerSecond / this.ticksPerSecond

		this.process = options.kind === 'maximum' ? this.processMaximum : this.processMinimum
	}

	public readonly process: (value: number) => void

	private processMaximum(value: number) {
		this.currentPeak -= this.decayPerTick
		this.currentPeak = Math.max(value, this.currentPeak)
	}

	private processMinimum(value: number) {
		this.currentPeak += this.decayPerTick
		this.currentPeak = Math.min(value, this.currentPeak)
	}
}

export interface DecayingPeakEstimatorOptions {
	kind: DecayingPeakEstimatorKind
	decayPerSecond: number
	initialPeak: number
}

export type DecayingPeakEstimatorKind = 'maximum' | 'minimum'
