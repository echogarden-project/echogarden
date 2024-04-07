export class SmoothEstimator {
	estimate: number

	constructor(
		public readonly positiveAdaptationRate: number,
		public readonly negativeAdaptationRate: number,
		initialEstimate = 0.0) {

		this.estimate = initialEstimate
	}

	update(target: number, adaptaionRateFactor = 1.0) {
		const residual = target - this.estimate

		const adaptationRate = residual >= 0 ? this.positiveAdaptationRate : this.negativeAdaptationRate

		const stepSize = residual * adaptationRate * adaptaionRateFactor

		this.estimate += stepSize
	}

	updateDamped(target: number, dampingReference: number, dampingCurvature: number, adaptationRateFactor = 1.0) {
		const residual = target - this.estimate

		const scaledResidualMagnitude = Math.abs(residual) * dampingCurvature

		const dampingFactor = (scaledResidualMagnitude) / (scaledResidualMagnitude + dampingReference)

		const adaptationRate = residual >= 0 ? this.positiveAdaptationRate : this.negativeAdaptationRate

		const stepSize = residual * adaptationRate * adaptationRateFactor * dampingFactor

		this.estimate += stepSize
	}
}
