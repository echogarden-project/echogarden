import { cosineDistancePrecomputedMagnitudes, createVectorForIntegerRange, eucledianDistance, magnitude } from "../math/VectorMath.js"
import { logToStderr } from "../utilities/Utilities.js"
import { alignDTWWindowed } from "./DTWSequenceAlignmentWindowed.js"

const log = logToStderr

export async function alignMFCC_DTW(mfccFrames1: number[][], mfccFrames2: number[][], windowLength: number, distanceFunction: "eucledian" | "cosine" = "eucledian") {
	if (distanceFunction == "eucledian") {
		const { path } = await alignDTWWindowed(
			mfccFrames1,
			mfccFrames2,
			eucledianDistance,
			windowLength
		)

		return path
	} else if (distanceFunction == "cosine") {
		const indexes1 = createVectorForIntegerRange(0, mfccFrames1.length)
		const indexes2 = createVectorForIntegerRange(0, mfccFrames2.length)

		const magnitudes1 = mfccFrames1.map(magnitude)
		const magnitudes2 = mfccFrames2.map(magnitude)

		const { path } = await alignDTWWindowed(
			indexes1,
			indexes2,
			(i, j) => cosineDistancePrecomputedMagnitudes(mfccFrames1[i], mfccFrames2[j], magnitudes1[i], magnitudes2[j]),
			windowLength
		)

		return path
	} else {
		throw new Error("Invalid distance function")
	}
}

export function getCostMatrixMemorySizeMB(sequence1Length: number, sequence2Length: number, windowLength: number) {
	const costMatrixMemorySizeMB = sequence1Length * Math.min(sequence2Length, windowLength) * 4 / 1000000
	return costMatrixMemorySizeMB
}
