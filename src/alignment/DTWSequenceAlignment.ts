import { logToStderr } from '../utilities/Utilities.js'
import { AlignmentPath } from './SpeechAlignment.js'

const log = logToStderr

export function alignDTW<T, U>(sequence1: ArrayLike<T>, sequence2: ArrayLike<U>, costFunction: (a: T, b: U) => number) {
	if (sequence1.length == 0 || sequence2.length == 0) {
		return { path: [] as AlignmentPath, pathCost: 0 }
	}

	const rowCount = sequence2.length
	const columnCount = sequence1.length

	// Compute accumulated cost matrix
	const accumulatedCostMatrix = computeAccumulatedCostMatrix(sequence1, sequence2, costFunction)

	// Find best path for the computed matrix
	const path = computeBestPath(accumulatedCostMatrix)

	// Best path cost is the bottom right element of the matrix
	const pathCost = accumulatedCostMatrix[rowCount - 1][columnCount - 1]

	return { path, pathCost }
}

function computeAccumulatedCostMatrix<T, U>(sequence1: ArrayLike<T>, sequence2: ArrayLike<U>, costFunction: (a: T, b: U) => number, deletionEnabled = true) {
	const rowCount = sequence2.length
	const columnCount = sequence1.length

	const accumulatedCostMatrix: Float32Array[] = new Array<Float32Array>(rowCount)

	// Initialize matrix
	for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
		accumulatedCostMatrix[rowIndex] = new Float32Array(columnCount)
	}

	for (let i = 1; i < columnCount; i++) {
		accumulatedCostMatrix[0][i] = Infinity
	}

	for (let i = 1; i < rowCount; i++) {
		accumulatedCostMatrix[i][0] = Infinity
	}

	// Fill out the matrix, go row by row
	for (let rowIndex = 1; rowIndex < rowCount; rowIndex++) {
		const previousRow = accumulatedCostMatrix[rowIndex - 1]
		const currentRow = accumulatedCostMatrix[rowIndex]

		for (let columnIndex = 1; columnIndex < columnCount; columnIndex++) {
			const cost = costFunction(sequence1[columnIndex], sequence2[rowIndex])

			const up = previousRow[columnIndex] // insertion
			const left = currentRow[columnIndex - 1] // deletion
			const upAndLeft = previousRow[columnIndex - 1] // match

			currentRow[columnIndex] = cost + minimumOf3(up, deletionEnabled ? left : Infinity, upAndLeft)
		}
	}

	return accumulatedCostMatrix
}

function computeBestPath(costMatrix: Float32Array[]) {
	const rowCount = costMatrix.length
	const columnCount = costMatrix[0].length

	const bestPath: AlignmentPath = []

	let rowIndex = rowCount - 1
	let columnIndex = columnCount - 1

	bestPath.push({
		source: columnIndex,
		dest: rowIndex
	})

	while (rowIndex > 0 || columnIndex > 0) {
		const up = costMatrix[rowIndex - 1][columnIndex]
		const left = costMatrix[rowIndex][columnIndex - 1]
		const upAndLeft = costMatrix[rowIndex - 1][columnIndex - 1]

		const smallestCostDirection = argIndexOfMinimumOf3(up, left, upAndLeft)

		if (smallestCostDirection == 1) {
			rowIndex -= 1
		} else if (smallestCostDirection == 2) {
			columnIndex -= 1
		} else {
			rowIndex -= 1
			columnIndex -= 1
		}

		bestPath.push({
			source: columnIndex,
			dest: rowIndex
		})
	}

	return bestPath.reverse() as AlignmentPath
}

function minimumOf3(x1: number, x2: number, x3: number) {
	if (x1 <= x2 && x1 <= x3) {
		return x1
	} else if (x2 <= x3) {
		return x2
	} else {
		return x3
	}
}

function argIndexOfMinimumOf3(x1: number, x2: number, x3: number) {
	if (x1 <= x2 && x1 <= x3) {
		return 1
	} else if (x2 <= x3) {
		return 2
	} else {
		return 3
	}
}
