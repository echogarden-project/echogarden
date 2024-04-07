import { sumVector } from '../math/VectorMath.js'
import { logToStderr } from './Utilities.js'

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

	getNormallyDistributedVector(featureCount: number, meanVector: number[], standardDeviationVector: number[]) {
		const features = this.getNormallyDistributedValues(featureCount)

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

	selectRandomIndexFromDistribution(distribution: number[]) {
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

export class MurmurRNG extends RandomGenerator {
	state: number

	constructor(seed: number) {
		super()

		this.state = seed
	}

	nextFloat() {
		return this.nextUint32() / 4294967296
	}

	nextUint32() {
		return this.nextInt32() >>> 0
	}

	nextInt32() {
		const multiplier = 3332679571

		let s = this.state

		s = Math.imul(s, multiplier)
		s ^= s >>> 16

		s = Math.imul(s, multiplier)
		s ^= s >>> 10

		s = Math.imul(s, multiplier)
		s ^= s >>> 17

		this.state = s

		return s
	}

	static hashInt32(val: number, seed = 234928357) {
		const rng = new MurmurRNG(seed ^ val)
		return rng.nextUint32()
	}
}

export class XorShift32RNG extends RandomGenerator {
	state: number

	constructor(seed: number) {
		super()

		this.state = seed
	}

	nextFloat() {
		return this.nextUint32() / 4294967296
	}

	nextUint32() {
		return this.nextInt32() >>> 0
	}

	nextInt32() {
		let s = this.state

		s ^= s << 13
		s ^= s >>> 17
		s ^= s << 5

		this.state = s

		return s
	}
}

export class LehmerRNG extends RandomGenerator {
	state: number

	constructor(seed: number) {
		super()

		this.state = seed
	}

	nextFloat() {
		return this.nextUint32() / 4294967296
	}

	nextUint32() {
		return this.nextInt32() >>> 0
	}

	nextInt32() {
		let s = this.state

		s = s * 48271 % 0x7fffffff

		this.state = s

		return s
	}
}

const log = logToStderr

export function testRngCycleLength() {
	const seed = 1

	const rng = new XorShift32RNG(seed)

	const bucketCount = 1000000
	const seen: number[][] = []

	for (let i = 0; i < bucketCount; i++) {
		seen[i] = []
	}

	for (let i = 0; i < 4294967296; i++) {
		if (i % 1000000 == 0) {
			log(`${i} iterations`)
		}

		const r = rng.nextUint32()

		const bucket = seen[r % bucketCount]

		if (bucket.includes(r)) {
			log(`Cycles at iteration ${i}`)
			return
		}

		bucket.push(r)
	}
}
