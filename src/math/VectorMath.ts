import { clip } from "../utilities/Utilities.js"

export function covarianceMatrixOfSamples(samples: number[][], weights?: number[], biased = false) {
	if (samples.length == 0) {
		throw new Error('No vectors given')
	}

	const { centeredVectors: centeredSamples, mean } = centerVectors(samples, weights)

	let covarianceMatrix

	if (weights) {
		covarianceMatrix = weightedCovarianceMatrixOfCenteredSamples(centeredSamples, weights)
	} else {
		covarianceMatrix = covarianceMatrixOfCenteredSamples(centeredSamples, biased)
	}

	return { covarianceMatrix, mean }
}

export function covarianceMatrixOfCenteredSamples(centeredSamples: number[][], biased = false, diagonalRegularizationAmount = 1e-6) {
	const sampleCount = centeredSamples.length

	if (sampleCount == 0) {
		throw new Error('No vectors given')
	}

	const sampleSizeMetric = biased || sampleCount == 1 ? sampleCount : sampleCount - 1
	const featureCount = centeredSamples[0].length

	const covarianceMatrix = createVectorArray(featureCount, featureCount)

	if (sampleCount == 1) {
		return covarianceMatrix
	}

	for (let i = 0; i < featureCount; i++) {
		for (let j = 0; j < featureCount; j++) {
			if (i > j) {
				covarianceMatrix[i][j] = covarianceMatrix[j][i]
				continue
			}

			let matrixElement = 0.0

			for (const sample of centeredSamples) {
				matrixElement += sample[i] * sample[j]
			}

			matrixElement /= sampleSizeMetric

			if (i == j) {
				matrixElement += diagonalRegularizationAmount
			}

			covarianceMatrix[i][j] = matrixElement
		}
	}

	return covarianceMatrix
}

export function weightedCovarianceMatrixOfCenteredSamples(centeredSamples: number[][], weights: number[], diagonalRegularizationAmount = 1e-6) {
	const sampleCount = centeredSamples.length

	if (sampleCount == 0) {
		throw new Error('No vectors given')
	}

	const featureCount = centeredSamples[0].length

	const covarianceMatrix = createVectorArray(featureCount, featureCount)

	if (sampleCount == 1) {
		return covarianceMatrix
	}

	for (let i = 0; i < featureCount; i++) {
		for (let j = 0; j < featureCount; j++) {
			if (i > j) {
				covarianceMatrix[i][j] = covarianceMatrix[j][i]
				continue
			}

			let matrixElement = 0.0

			for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
				const sample = centeredSamples[sampleIndex]
				const weight = weights[sampleIndex]

				matrixElement += weight * (sample[i] * sample[j])
			}

			if (i == j) {
				matrixElement += diagonalRegularizationAmount
			}

			covarianceMatrix[i][j] = matrixElement
		}
	}

	return covarianceMatrix
}

export function centerVectors(vectors: number[][], weights?: number[]) {
	const vectorCount = vectors.length

	if (vectorCount == 0) {
		return { centeredVectors: [], mean: [] }
	}

	let mean: number[]
	if (weights) {
		mean = weightedMeanOfVectors(vectors, weights)
	} else {
		mean = meanOfVectors(vectors)
	}

	const centeredVectors: number[][] = new Array(vectorCount)

	for (let i = 0; i < vectorCount; i++) {
		centeredVectors[i] = subtractVectors(vectors[i], mean)
	}

	return { centeredVectors, mean }
}

export function centerVector(vector: number[]) {
	const mean = meanOfVector(vector)

	const centeredVector: number[] = new Array(vector.length)

	for (let i = 0; i < vector.length; i++) {
		centeredVector[i] = vector[i] - mean
	}

	return centeredVector
}

export function scaleToSumTo1(vector: number[]) {
	if (vector.length == 0) {
		return []
	}

	if (vector.length == 1) {
		return [1]
	}

	const minValue = vector[indexOfMin(vector)]

	const scaledVector = vector.slice()

	if (minValue < 0) {
		const addedOffset = -minValue * 2

		for (let i = 0; i < scaledVector.length; i++) {
			scaledVector[i] += addedOffset
		}
	}

	const sum = sumVector(scaledVector)

	if (sum == 0) {
		return scaledVector
	}

	if (sum == Infinity) {
		throw new Error('Vector sum is infinite')
	}

	for (let i = 0; i < vector.length; i++) {
		scaledVector[i] /= sum

		scaledVector[i] = zeroIfNaN(scaledVector[i])
	}

	return scaledVector
}

export function normalizeVector(vector: ArrayLike<number>, kind: 'population' | 'sample' = 'population') {
	if (vector.length == 0) {
		throw new Error('Vector is empty')
	}

	const mean = meanOfVector(vector)
	const stdDeviation = stdDeviationOfVector(vector, kind, mean)

	const normalizedVector = createVector(vector.length)

	for (let i = 0; i < vector.length; i++) {
		normalizedVector[i] = (vector[i] - mean) / stdDeviation

		normalizedVector[i] = zeroIfNaN(normalizedVector[i])
	}

	return { normalizedVector, mean, stdDeviation }
}

export function normalizeVectors(vectors: number[][], kind: 'population' | 'sample' = 'population') {
	const vectorCount = vectors.length

	if (vectorCount == 0) {
		return { normalizedVectors: [], mean: [], stdDeviation: [] }
	}

	const featureCount = vectors[0].length

	const mean = meanOfVectors(vectors)
	const stdDeviation = stdDeviationOfVectors(vectors, kind, mean)

	const normalizedVectors: number[][] = []

	for (const vector of vectors) {
		const normalizedVector = createVector(featureCount)

		for (let featureIndex = 0; featureIndex < featureCount; featureIndex++) {
			normalizedVector[featureIndex] = (vector[featureIndex] - mean[featureIndex]) / stdDeviation[featureIndex]

			normalizedVector[featureIndex] = zeroIfNaN(normalizedVector[featureIndex])
		}

		normalizedVectors.push(normalizedVector)
	}

	return { normalizedVectors, mean, stdDeviation }
}

export function deNormalizeVectors(normalizedVectors: number[][], originalMean: number[], originalStdDeviation: number[]) {
	const vectorCount = normalizeVectors.length

	if (vectorCount == 0) {
		return []
	}

	const featureCount = normalizedVectors[0].length

	const deNormalizedVectors: number[][] = []

	for (const normalizedVector of normalizedVectors) {
		const deNormalizedVector = createVector(featureCount)

		for (let featureIndex = 0; featureIndex < featureCount; featureIndex++) {
			deNormalizedVector[featureIndex] = originalMean[featureIndex] + (normalizedVector[featureIndex] * originalStdDeviation[featureIndex])
		}

		deNormalizedVectors.push(deNormalizedVector)
	}

	return deNormalizedVectors
}

export function meanOfVectors(vectors: number[][]) {
	const vectorCount = vectors.length

	if (vectorCount == 0) {
		return []
	}

	const featureCount = vectors[0].length

	const result = createVector(featureCount)

	for (const vector of vectors) {
		for (let featureIndex = 0; featureIndex < featureCount; featureIndex++) {
			result[featureIndex] += vector[featureIndex]
		}
	}

	for (let featureIndex = 0; featureIndex < featureCount; featureIndex++) {
		result[featureIndex] /= vectorCount
	}

	return result
}

export function weightedMeanOfVectors(vectors: number[][], weights: number[]) {
	const vectorCount = vectors.length

	if (vectorCount == 0) {
		return []
	}

	const featureCount = vectors[0].length

	const result = createVector(featureCount)

	for (let vectorIndex = 0; vectorIndex < vectorCount; vectorIndex++) {
		const vector = vectors[vectorIndex]
		const vectorWeight = weights[vectorIndex]

		for (let featureIndex = 0; featureIndex < featureCount; featureIndex++) {
			result[featureIndex] += vectorWeight * vector[featureIndex]
		}
	}

	return result
}

export function stdDeviationOfVectors(vectors: number[][], kind: 'population' | 'sample' = 'population', mean?: number[]) {
	return varianceOfVectors(vectors, kind, mean).map(v => Math.sqrt(v))
}

export function varianceOfVectors(vectors: number[][], kind: 'population' | 'sample' = 'population', mean?: number[]) {
	const vectorCount = vectors.length

	if (vectorCount == 0) {
		return []
	}

	const sampleSizeMetric = kind == 'population' || vectorCount == 1 ? vectorCount : vectorCount - 1
	const featureCount = vectors[0].length

	if (!mean) {
		mean = meanOfVectors(vectors)
	}

	const result = createVector(featureCount)

	for (const vector of vectors) {
		for (let i = 0; i < featureCount; i++) {
			result[i] += (vector[i] - mean[i]) ** 2
		}
	}

	for (let i = 0; i < featureCount; i++) {
		result[i] /= sampleSizeMetric
	}

	return result
}

export function meanOfVector(vector: ArrayLike<number>) {
	if (vector.length == 0) {
		return 0
	}

	return sumVector(vector) / vector.length
}

export function medianOfVector(vector: ArrayLike<number>) {
	if (vector.length == 0) {
		throw new Error('Vector is empty')
	}

	return vector[Math.floor(vector.length / 2)]
}

export function stdDeviationOfVector(vector: ArrayLike<number>, kind: 'population' | 'sample' = 'population', mean?: number) {
	return Math.sqrt(varianceOfVector(vector, kind, mean))
}

export function varianceOfVector(vector: ArrayLike<number>, kind: 'population' | 'sample' = 'population', mean?: number) {
	if (vector.length == 0) {
		return 0
	}

	const sampleSizeMetric = kind == 'population' || vector.length == 1 ? vector.length : vector.length - 1

	if (mean == null) {
		mean = meanOfVector(vector)
	}

	let result = 0.0

	for (let i = 0; i < vector.length; i++) {
		result += (vector[i] - mean) ** 2
	}

	return result / sampleSizeMetric
}

export function logOfVector(vector: number[], minVal = 1e-40) {
	return vector.map(value => Math.log(value + minVal))
}

export function expOfVector(vector: number[]) {
	return vector.map(value => Math.exp(value))
}

export function transpose(matrix: number[][]) {
	const vectorCount = matrix.length
	const featureCount = matrix[0].length

	const transposedMatrix = createVectorArray(featureCount, vectorCount)

	for (let i = 0; i < vectorCount; i++) {
		for (let j = 0; j < featureCount; j++) {
			transposedMatrix[j][i] = matrix[i][j]
		}
	}

	return transposedMatrix
}

export function movingAverageOfWindow3(vector: number[]) {
	const elementCount = vector.length

	if (elementCount == 0) {
		return []
	}

	if (elementCount == 1) {
		return vector.slice()
	}

	const result: number[] = []

	result.push((vector[0] + vector[0] + vector[1]) / 3)

	for (let i = 1; i < elementCount - 1; i++) {
		result.push((vector[i - 1] + vector[i] + vector[i + 1]) / 3)
	}

	result.push((vector[elementCount - 2] + vector[elementCount - 1] + vector[elementCount - 1]) / 3)

	return result
}

export function averageMeanSquaredError(actual: number[][], expected: number[][]) {
	if (actual.length != expected.length) {
		throw new Error('Vectors are not the same length')
	}

	const vectorCount = actual.length

	if (vectorCount == 0) {
		return 0
	}

	let sum = 0.0

	for (let i = 0; i < vectorCount; i++) {
		sum += meanSquaredError(actual[i], expected[i])
	}

	return sum / vectorCount
}

export function meanSquaredError(actual: ArrayLike<number>, expected: ArrayLike<number>) {
	if (actual.length != expected.length) {
		throw new Error('Vectors are not the same length')
	}

	const featureCount = actual.length

	if (featureCount == 0) {
		return 0
	}

	let sum = 0.0

	for (let i = 0; i < featureCount; i++) {
		sum += (actual[i] - expected[i]) ** 2
	}

	return sum / featureCount
}

export function euclidianDistance(vector1: ArrayLike<number>, vector2: ArrayLike<number>) {
	return Math.sqrt(squaredEuclidianDistance(vector1, vector2))
}

export function squaredEuclidianDistance(vector1: ArrayLike<number>, vector2: ArrayLike<number>) {
	if (vector1.length !== vector2.length) {
		throw new Error('Vectors are not the same length')
	}

	const elementCount = vector1.length

	if (elementCount === 0) {
		return 0
	}

	let sum = 0.0

	for (let i = 0; i < elementCount; i++) {
		sum += (vector1[i] - vector2[i]) ** 2
	}

	return sum
}

export function euclidianDistance13Dim(vector1: ArrayLike<number>, vector2: ArrayLike<number>) {
	return Math.sqrt(squaredEuclidianDistance13Dim(vector1, vector2))
}

export function squaredEuclidianDistance13Dim(vector1: ArrayLike<number>, vector2: ArrayLike<number>) {
	// Assumes the input has 13 dimensions (optimized for 13-dimensional MFCC vectors)

	const result =
		(vector1[0] - vector2[0]) ** 2 +
		(vector1[1] - vector2[1]) ** 2 +
		(vector1[2] - vector2[2]) ** 2 +
		(vector1[3] - vector2[3]) ** 2 +
		(vector1[4] - vector2[4]) ** 2 +
		(vector1[5] - vector2[5]) ** 2 +
		(vector1[6] - vector2[6]) ** 2 +
		(vector1[7] - vector2[7]) ** 2 +
		(vector1[8] - vector2[8]) ** 2 +
		(vector1[9] - vector2[9]) ** 2 +
		(vector1[10] - vector2[10]) ** 2 +
		(vector1[11] - vector2[11]) ** 2 +
		(vector1[12] - vector2[12]) ** 2

	return result
}

export function cosineDistance(vector1: ArrayLike<number>, vector2: ArrayLike<number>) {
	return 1 - cosineSimilarity(vector1, vector2)
}

export function cosineSimilarity(vector1: ArrayLike<number>, vector2: ArrayLike<number>) {
	if (vector1.length !== vector2.length) {
		throw new Error('Vectors are not the same length')
	}

	if (vector1.length === 0) {
		return 0
	}

	const elementCount = vector1.length

	let dotProduct = 0.0

	let squaredMagnitude1 = 0.0
	let squaredMagnitude2 = 0.0

	for (let i = 0; i < elementCount; i++) {
		const element1 = vector1[i]
		const element2 = vector2[i]

		dotProduct += element1 * element2

		squaredMagnitude1 += element1 ** 2
		squaredMagnitude2 += element2 ** 2
	}

	let result = dotProduct / (Math.sqrt(squaredMagnitude1) * Math.sqrt(squaredMagnitude2) + 1e-40)

	result = zeroIfNaN(result)
	result = clip(result, -1.0, 1.0)

	return result
}

export function cosineDistancePrecomputedMagnitudes(vector1: ArrayLike<number>, vector2: ArrayLike<number>, magnitude1: number, magnitude2: number) {
	return 1 - cosineSimilarityPrecomputedMagnitudes(vector1, vector2, magnitude1, magnitude2)
}

export function cosineSimilarityPrecomputedMagnitudes(vector1: ArrayLike<number>, vector2: ArrayLike<number>, magnitude1: number, magnitude2: number) {
	if (vector1.length != vector2.length) {
		throw new Error('Vectors are not the same length')
	}

	if (vector1.length == 0) {
		return 0
	}

	const featureCount = vector1.length

	let dotProduct = 0.0

	for (let i = 0; i < featureCount; i++) {
		dotProduct += vector1[i] * vector2[i]
	}

	let result = dotProduct / (magnitude1 * magnitude2 + 1e-40)

	result = zeroIfNaN(result)
	result = clip(result, -1.0, 1.0)

	return result
}

export function minkowskiDistance(vector1: ArrayLike<number>, vector2: ArrayLike<number>, power: number) {
	if (vector1.length != vector2.length) {
		throw new Error('Vectors are not the same length')
	}

	const elementCount = vector1.length

	if (elementCount == 0) {
		return 0
	}

	let sum = 0.0

	for (let i = 0; i < elementCount; i++) {
		sum += Math.abs(vector1[i] - vector2[i]) ** power
	}

	return sum ** (1 / power)
}

export function subtractVectors(vector1: number[], vector2: number[]) {
	if (vector1.length != vector2.length) {
		throw new Error('Vectors are not the same length')
	}

	const result = createVector(vector1.length)

	for (let i = 0; i < vector1.length; i++) {
		result[i] = vector1[i] - vector2[i]
	}

	return result
}

export function sumVector(vector: ArrayLike<number>) {
	let result = 0.0

	for (let i = 0; i < vector.length; i++) {
		result += vector[i]
	}

	return result
}

export function dotProduct(vector1: ArrayLike<number>, vector2: ArrayLike<number>) {
	if (vector1.length != vector2.length) {
		throw new Error('Vectors are not the same length')
	}

	const elementCount = vector1.length

	let result = 0.0

	for (let i = 0; i < elementCount; i++) {
		result += vector1[i] * vector2[i]
	}

	return result
}

export function magnitude(vector: ArrayLike<number>) {
	const featureCount = vector.length

	let squaredMagnitude = 0.0

	for (let i = 0; i < featureCount; i++) {
		squaredMagnitude += vector[i] ** 2
	}

	return Math.sqrt(squaredMagnitude)
}

export function maxValue(vector: ArrayLike<number>) {
	return vector[indexOfMax(vector)]
}

export function indexOfMax(vector: ArrayLike<number>) {
	if (vector.length == 0) {
		return -1
	}

	let maxValue = vector[0]
	let result = 0

	for (let i = 1; i < vector.length; i++) {
		if (vector[i] > maxValue) {
			maxValue = vector[i]
			result = i
		}
	}

	return result
}

export function minValue(vector: ArrayLike<number>) {
	return vector[indexOfMin(vector)]
}

export function indexOfMin(vector: ArrayLike<number>) {
	let minValue = Infinity
	let result = -1

	for (let i = 0; i < vector.length; i++) {
		if (vector[i] < minValue) {
			minValue = vector[i]
			result = i
		}
	}

	return result
}

export function sigmoid(x: number) {
	const result = 1 / (1 + Math.exp(-x))

	return zeroIfNaN(result)
}

export function softmax(logits: number[], temperature = 1.0) {
	if (logits.length === 0) {
		return []
	}

	let maxValue = -Infinity

	for (const val of logits) {
		if (val > maxValue) {
			maxValue = val
		}
	}

	const temperatureReciprocal = 1 / (temperature + 1e-40)

	const result: number[] = []

	let sumOfExponentiatedValues = 0.0

	for (const value of logits) {
		const eToValue = Math.exp((value - maxValue) * temperatureReciprocal)

		sumOfExponentiatedValues += eToValue

		result.push(eToValue)
	}

	const sumOfExponentiatedValuesReciprocal = 1 / (sumOfExponentiatedValues + 1e-40)

	for (let i = 0; i < result.length; i++) {
		result[i] *= sumOfExponentiatedValuesReciprocal
	}

	return result
}

export function hammingDistance(value1: number, value2: number, bitLength = 32) {
	let valueXor = value1 ^ value2

	let result = 0

	for (let i = 0; i < bitLength; i++) {
		result += valueXor & 1
		valueXor = valueXor >> 1
	}

	return result
}

export function createVectorArray(vectorCount: number, featureCount: number, initialValue = 0.0) {
	const result: number[][] = new Array(vectorCount)

	for (let i = 0; i < vectorCount; i++) {
		result[i] = createVector(featureCount, initialValue)
	}

	return result
}

export function createVector(elementCount: number, initialValue = 0.0) {
	const result: number[] = new Array(elementCount)

	for (let i = 0; i < elementCount; i++) {
		result[i] = initialValue
	}

	return result
}

export function createVectorForIntegerRange(start: number, end: number) {
	const newVector: number[] = []

	for (let i = start; i < end; i++) {
		newVector.push(i)
	}

	return newVector
}

export function zeroIfNaN(val: number) {
	if (isNaN(val)) {
		return 0
	} else {
		return val
	}
}

export function logSumExp(values: number[], minVal = 1e-40) {
	return Math.log(minVal + sumExp(values))
}

export function sumExp(values: number[]) {
	let sumOfExp = 0

	for (const value of values) {
		sumOfExp += Math.exp(value)
	}

	return sumOfExp
}

export function logSoftmax(values: number[], minVal = 1e-40) {
	const softMaxOfValues = softmax(values)

	return logOfVector(softMaxOfValues, minVal)
}

export class IncrementalMean {
	currentElementCount = 0
	currentMean = 0.0

	addValueToMean(value: number) {
		this.currentElementCount += 1
		this.currentMean += (value + this.currentMean) / this.currentElementCount
	}

	// 1, 3.2, 7.23
	// 0 + ((1 - 0) / 1) = 1
	// 1 + ((3.2 - 1) / 2) = 2.1
	// 2.1 + ((7.23 - 3.1) / 3) = 2.04

	// 3.81
}

export type DistanceFunction = (a: number[], b: number[]) => number

export interface ComplexNumber {
	real: number
	imaginary: number
}
