import { clip } from "../utilities/Utilities.js"

export function covarianceMatrixOfSamples(samples: ArrayLike<number>[], weights?: ArrayLike<number>, biased = false) {
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

export function covarianceMatrixOfCenteredSamples(centeredSamples: ArrayLike<number>[], biased = false, diagonalRegularizationAmount = 1e-6) {
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

export function weightedCovarianceMatrixOfCenteredSamples(centeredSamples: ArrayLike<number>[], weights: ArrayLike<number>, diagonalRegularizationAmount = 1e-6) {
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

export function centerVectors(vectors: ArrayLike<number>[], weights?: ArrayLike<number>) {
	const vectorCount = vectors.length

	if (vectorCount == 0) {
		return { centeredVectors: [] as Float32Array[], mean: new Float32Array(0) }
	}

	let mean: Float32Array

	if (weights) {
		mean = weightedMeanOfVectors(vectors, weights)
	} else {
		mean = meanOfVectors(vectors)
	}

	const centeredVectors: Float32Array[] = []

	for (let i = 0; i < vectorCount; i++) {
		const centeredVector = subtractVectors(vectors[i], mean)

		centeredVectors.push(centeredVector)
	}

	return { centeredVectors, mean }
}

export function centerVector(vector: ArrayLike<number>) {
	const mean = meanOfVector(vector)

	const centeredVector = new Float32Array(vector.length)

	for (let i = 0; i < vector.length; i++) {
		centeredVector[i] = vector[i] - mean
	}

	return centeredVector
}

export function scaleToSumTo1(vector: ArrayLike<number>) {
	if (vector.length == 0) {
		return new Float32Array(0)
	}

	if (vector.length == 1) {
		return Float32Array.from([1])
	}

	const minValue = vector[indexOfMin(vector)]

	const scaledVector = Float32Array.from(vector)

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

export function normalizeVectors(vectors: ArrayLike<number>[], kind: 'population' | 'sample' = 'population') {
	const vectorCount = vectors.length

	if (vectorCount == 0) {
		return { normalizedVectors: [] as Float32Array[], mean: new Float32Array(0), stdDeviation: new Float32Array(0) }
	}

	const featureCount = vectors[0].length

	const mean = meanOfVectors(vectors)
	const stdDeviation = stdDeviationOfVectors(vectors, kind, mean)

	const normalizedVectors: Float32Array[] = []

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

export function deNormalizeVectors(normalizedVectors: ArrayLike<number>[], originalMean: ArrayLike<number>, originalStdDeviation: ArrayLike<number>) {
	const vectorCount = normalizeVectors.length

	if (vectorCount == 0) {
		return [] as Float32Array[]
	}

	const featureCount = normalizedVectors[0].length

	const deNormalizedVectors: Float32Array[] = []

	for (const normalizedVector of normalizedVectors) {
		const deNormalizedVector = createVector(featureCount)

		for (let featureIndex = 0; featureIndex < featureCount; featureIndex++) {
			deNormalizedVector[featureIndex] = originalMean[featureIndex] + (normalizedVector[featureIndex] * originalStdDeviation[featureIndex])
		}

		deNormalizedVectors.push(deNormalizedVector)
	}

	return deNormalizedVectors
}

export function meanOfVectors(vectors: ArrayLike<number>[]) {
	const vectorCount = vectors.length

	if (vectorCount == 0) {
		return new Float32Array(0)
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

export function weightedMeanOfVectors(vectors: ArrayLike<number>[], weights: ArrayLike<number>) {
	const vectorCount = vectors.length

	if (vectorCount == 0) {
		return new Float32Array(0)
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

export function stdDeviationOfVectors(vectors: ArrayLike<number>[], kind: 'population' | 'sample' = 'population', mean?: ArrayLike<number>) {
	return varianceOfVectors(vectors, kind, mean).map(v => Math.sqrt(v))
}

export function varianceOfVectors(vectors: ArrayLike<number>[], kind: 'population' | 'sample' = 'population', mean?: ArrayLike<number>) {
	const vectorCount = vectors.length

	if (vectorCount == 0) {
		return new Float32Array(0)
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

export function logOfVector(vector: ArrayLike<number>, minVal = 1e-40) {
	const result = new Float32Array(vector.length)

	for (let i = 0; i < vector.length; i++) {
		const value = vector[i]

		result[i] = Math.log(value + minVal)
	}

	return result
}

export function expOfVector(vector: ArrayLike<number>) {
	const result = new Float32Array(vector.length)

	for (let i = 0; i < vector.length; i++) {
		const value = vector[i]

		result[i] = Math.exp(value)
	}

	return result
}

export function transpose(matrix: ArrayLike<number>[]) {
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

export function movingAverageOfWindow3(vector: ArrayLike<number>) {
	const elementCount = vector.length

	if (elementCount == 0) {
		return new Float32Array(0)
	}

	if (elementCount == 1) {
		return Float32Array.from(vector)
	}

	const result = new Float32Array(elementCount)

	result[0] = (vector[0] + vector[0] + vector[1]) / 3

	for (let i = 1; i < elementCount - 1; i++) {
		result[i] = (vector[i - 1] + vector[i] + vector[i + 1]) / 3
	}

	result[elementCount - 1] = (vector[elementCount - 2] + vector[elementCount - 1] + vector[elementCount - 1]) / 3

	return result
}

export function averageMeanSquaredError(actual: ArrayLike<number>[], expected: ArrayLike<number>[]) {
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

export function euclideanDistance(vector1: ArrayLike<number>, vector2: ArrayLike<number>) {
	return Math.sqrt(squaredEuclideanDistance(vector1, vector2))
}

export function squaredEuclideanDistance(vector1: ArrayLike<number>, vector2: ArrayLike<number>) {
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

export function euclideanDistance13Dim(vector1: ArrayLike<number>, vector2: ArrayLike<number>) {
	return Math.sqrt(squaredEuclideanDistance13Dim(vector1, vector2))
}

export function squaredEuclideanDistance13Dim(vector1: ArrayLike<number>, vector2: ArrayLike<number>) {
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

export function subtractVectors(vector1: ArrayLike<number>, vector2: ArrayLike<number>) {
	const elementCount = vector1.length

	if (vector1.length != vector2.length) {
		throw new Error('Vectors are not the same length')
	}

	const result = createVector(vector1.length)

	for (let i = 0; i < elementCount; i++) {
		result[i] = vector1[i] - vector2[i]
	}

	return result
}

export function sumVector(vector: ArrayLike<number>) {
	const elementCount = vector.length

	let result = 0.0

	for (let i = 0; i < elementCount; i++) {
		result += vector[i]
	}

	return result
}

export function sumOfSquaresForVector(vector: ArrayLike<number>) {
	const elementCount = vector.length

	let result = 0.0

	for (let i = 0; i < elementCount; i++) {
		result += vector[i] ** 2
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
	const elementCount = vector.length
	let minValue = Infinity
	let result = -1

	for (let i = 0; i < elementCount; i++) {
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

export function softmax(logits: ArrayLike<number>, temperature = 1.0) {
	const logitCount = logits.length

	if (logitCount === 0) {
		return new Float32Array(0)
	}

	let maxValue = -Infinity

	for (let i = 0; i < logitCount; i++) {
		const value = logits[i]

		if (value > maxValue) {
			maxValue = value
		}
	}

	const temperatureReciprocal = 1 / (temperature + 1e-40)

	const results = new Float32Array(logitCount)

	let sumOfExponentiatedValues = 0.0

	for (let i = 0; i < logitCount; i++) {
		const value = logits[i]

		const eToValue = Math.exp((value - maxValue) * temperatureReciprocal)

		sumOfExponentiatedValues += eToValue

		results[i] = eToValue
	}

	const sumOfExponentiatedValuesReciprocal = 1 / (sumOfExponentiatedValues + 1e-40)

	for (let i = 0; i < logitCount; i++) {
		results[i] *= sumOfExponentiatedValuesReciprocal
	}

	return results
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
	const result: Float32Array[] = new Array(vectorCount)

	for (let i = 0; i < vectorCount; i++) {
		result[i] = createVector(featureCount, initialValue)
	}

	return result
}

export function createVector(elementCount: number, initialValue = 0.0) {
	const result = new Float32Array(elementCount)

	if (initialValue !== 0) {
		result.fill(initialValue)
	}

	return result
}

export function zeroIfNaN(val: number) {
	if (isNaN(val)) {
		return 0
	} else {
		return val
	}
}

export function logSumExp(values: ArrayLike<number>, minVal = 1e-40) {
	return Math.log(minVal + sumExp(values))
}

export function sumExp(values: ArrayLike<number>) {
	let sumOfExp = 0

	for (let i = 0; i < values.length; i++) {
		const value = values[i]

		sumOfExp += Math.exp(value)
	}

	return sumOfExp
}

export function logSoftmax(values: ArrayLike<number>, minVal = 1e-40) {
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

export type DistanceFunction = (a: ArrayLike<number>, b: ArrayLike<number>) => number

export interface ComplexNumber {
	real: number
	imaginary: number
}
