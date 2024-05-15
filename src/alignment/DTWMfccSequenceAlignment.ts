import { cosineDistancePrecomputedMagnitudes, createVectorForIntegerRange, euclidianDistance, euclidianDistance13Dim, magnitude } from '../math/VectorMath.js'
import { logToStderr } from '../utilities/Utilities.js'
import { alignDTWWindowed } from './DTWSequenceAlignmentWindowed.js'

const log = logToStderr

export async function alignMFCC_DTW(mfccFrames1: number[][], mfccFrames2: number[][], windowLength: number, distanceFunctionKind: 'euclidian' | 'cosine' = 'euclidian', centerIndexes?: number[]) {
	if (distanceFunctionKind == 'euclidian') {
		let distanceFunction = euclidianDistance

		if (mfccFrames1.length > 0 && mfccFrames1[0].length === 13) {
			distanceFunction = euclidianDistance13Dim
		}

		const { path } = alignDTWWindowed(
			mfccFrames1,
			mfccFrames2,
			distanceFunction,
			windowLength,
			centerIndexes
		)

		return path
	} else if (distanceFunctionKind == 'cosine') {
		const indexes1 = createVectorForIntegerRange(0, mfccFrames1.length)
		const indexes2 = createVectorForIntegerRange(0, mfccFrames2.length)

		const magnitudes1 = mfccFrames1.map(magnitude)
		const magnitudes2 = mfccFrames2.map(magnitude)

		const { path } = alignDTWWindowed(
			indexes1,
			indexes2,
			(i, j) => cosineDistancePrecomputedMagnitudes(mfccFrames1[i], mfccFrames2[j], magnitudes1[i], magnitudes2[j]),
			windowLength,
			centerIndexes
		)

		return path
	} else {
		throw new Error('Invalid distance function')
	}
}

export function getCostMatrixMemorySizeMB(sequence1Length: number, sequence2Length: number, windowLength: number) {
	const costMatrixMemorySizeMB = sequence1Length * Math.min(sequence2Length, windowLength) * 4 / 1000000

	return costMatrixMemorySizeMB
}
