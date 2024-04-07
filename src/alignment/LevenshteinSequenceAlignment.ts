import { logToStderr } from '../utilities/Utilities.js'
import { AlignmentPath } from './SpeechAlignment.js'

const log = logToStderr

export function alignLevenshtein<T, U>(sequence1: T[], sequence2: U[], getSubstitutionCost: (a: T, b: U) => number) {
	const rowCount = sequence2.length + 1
	const columnCount = sequence1.length + 1

	// Compute accumulated cost matrix
	const accumulatedCostMatrix = computeAccumulatedCostMatrix(sequence1, sequence2, getSubstitutionCost)

	// Find best path for the computed matrix
	const path = computeBestPath(accumulatedCostMatrix)

	// Best path cost is the bottom right element of the matrix
	const pathCost = accumulatedCostMatrix[rowCount - 1][columnCount - 1]

	return { path, pathCost }
}

function computeAccumulatedCostMatrix<T, U>(sequence1: T[], sequence2: U[], getSubstitutionCost: (a: T, b: U) => number) {
	const rowCount = sequence2.length + 1
	const columnCount = sequence1.length + 1

	const accumulatedCostMatrix: Float32Array[] = new Array<Float32Array>(rowCount)

	// Allocate rows and initialize first column
	for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
		const newRow = new Float32Array(columnCount)

		newRow[0] = rowIndex
		accumulatedCostMatrix[rowIndex] = newRow
	}

	// Initialize first row
	for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
		accumulatedCostMatrix[0][columnIndex] = columnIndex
	}

	// Fill out the rest of the matrix, go row by row
	for (let rowIndex = 1; rowIndex < rowCount; rowIndex++) {
		const previousRow = accumulatedCostMatrix[rowIndex - 1]
		const currentRow = accumulatedCostMatrix[rowIndex]

		for (let columnIndex = 1; columnIndex < columnCount; columnIndex++) {
			const upAndLeft = previousRow[columnIndex - 1]
			const up = previousRow[columnIndex]
			const left = currentRow[columnIndex - 1]

			const smallestCostDirection = argIndexOfSmallestOf3(upAndLeft, up, left)

			let computedCostForCurrentElement: number

			if (smallestCostDirection == 1) {
				const subtitutionCost = getSubstitutionCost(sequence1[columnIndex - 1], sequence2[rowIndex - 1])

				computedCostForCurrentElement = upAndLeft + subtitutionCost
			} else if (smallestCostDirection == 2) {
				computedCostForCurrentElement = up + 1
			} else {
				computedCostForCurrentElement = left + 1
			}

			currentRow[columnIndex] = computedCostForCurrentElement
		}
	}

	return accumulatedCostMatrix
}

function computeBestPath(costMatrix: Float32Array[]) {
	const bestPath: AlignmentPath = []

	let rowIndex = costMatrix.length - 1
	let columnIndex = costMatrix[0].length - 1

	while (rowIndex > 1 || columnIndex > 1) {
		bestPath.push({
			source: columnIndex - 1,
			dest: rowIndex - 1
		})

		if (rowIndex == 1) {
			columnIndex -= 1
			continue
		}

		if (columnIndex == 1) {
			rowIndex -= 1
			continue
		}

		const upAndLeft = costMatrix[rowIndex - 1][columnIndex - 1]
		const up = costMatrix[rowIndex - 1][columnIndex]
		const left = costMatrix[rowIndex][columnIndex - 1]

		const smallestCostDirection = argIndexOfSmallestOf3(upAndLeft, up, left)

		if (smallestCostDirection == 1) {
			rowIndex -= 1
			columnIndex -= 1
		} else if (smallestCostDirection == 2) {
			rowIndex -= 1
		} else {
			columnIndex -= 1
		}
	}

	bestPath.push({
		source: 0,
		dest: 0
	})

	return bestPath.reverse() as AlignmentPath
}

function argIndexOfSmallestOf3(x1: number, x2: number, x3: number) {
	if (x1 <= x2 && x1 <= x3) {
		return 1
	} else if (x2 <= x3) {
		return 2
	} else {
		return 3
	}
}
