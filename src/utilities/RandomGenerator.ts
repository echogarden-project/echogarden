import { sumVector } from '../math/VectorMath.js'

export abstract class RandomGenerator {
	getIntInRange(min: number, max: number) {
		return Math.floor(this.getFloatInRange(min, max))
	}

	getFloatInRange(min = 0, max = 1) {
		return min + (this.nextFloat() * (max - min))
	}

	getFloats(length: number, min = 0, max = 1) {
		const result = []

		for (let i = 0; i < length; i++) {
			result.push(this.getFloatInRange(min, max))
		}

		return result
	}

	getInts(length: number, min: number, max: number) {
		const result = []

		for (let i = 0; i < length; i++) {
			result.push(this.getIntInRange(min, max))
		}

		return result
	}

	getNormallyDistributedVector(elementCount: number, meanVector: ArrayLike<number>, standardDeviationVector: ArrayLike<number>) {
		const features = this.getNormallyDistributedValues(elementCount)

		for (let i = 0; i < features.length; i++) {
			features[i] = meanVector[i] + (features[i] * standardDeviationVector[i])
		}

		return features
	}

	getNormallyDistributedValues(count: number, mean = 0, standardDeviation = 1) {
		const result: number[] = []

		for (let i = 0; i < count; i += 2) {
			const [n1, n2] = this.getNormallyDistributedPair()

			result.push(mean + (n1 * standardDeviation))

			if (i + 1 < count) {
				result.push(mean + (n2 * standardDeviation))
			}
		}

		return result
	}

	getNormallyDistributedPair() {
		// Using Marsaglia polar method
		// https://en.wikipedia.org/wiki/Marsaglia_polar_method

		let x: number
		let y: number
		let s: number

		do {
			x = (this.nextFloat() * 2) - 1
			y = (this.nextFloat() * 2) - 1

			s = (x ** 2) + (y ** 2)
		} while (s <= 0 || s >= 1)

		const m = Math.sqrt((-2 * Math.log(s)) / s)

		const n1 = x * m
		const n2 = y * m

		return [n1, n2]
	}

	selectRandomIndexFromDistribution(distribution: ArrayLike<number>) {
		const sum = sumVector(distribution)

		const randomTarget = this.getFloatInRange(0, sum)

		let cumSum = 0

		for (let i = 0; i < distribution.length; i++) {
			const element = distribution[i]

			if (randomTarget < cumSum + element) {
				return i
			}

			cumSum += element
		}

		return distribution.length - 1
	}

	abstract nextFloat(): number
	abstract nextUint32(): number
	abstract nextInt32(): number
}

export abstract class Int32RandomGenerator extends RandomGenerator {
	nextUint32() {
		return this.nextInt32() >>> 0
	}

	nextFloat() {
		return this.nextUint32() * (1 / 4294967296)
	}
}

export class XorShift32PRNG extends Int32RandomGenerator {
	state: number

	constructor(seed: number) {
		super()

		this.state = (3077908504 + seed) | 0
	}

	nextInt32() {
		let state = this.state | 0

		state ^= state << 13
		state ^= state >>> 17
		state ^= state << 5

		this.state = state

		return state
	}
}
