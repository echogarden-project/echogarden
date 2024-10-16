import { logToStderr } from '../utilities/Utilities.js'
import { AlignmentPath } from './SpeechAlignment.js'

const log = logToStderr

export function alignDTWWindowed<T, U>(sequence1: ArrayLike<T>, sequence2: ArrayLike<U>, costFunction: (a: T, b: U) => number, windowMaxLength: number, centerIndexes?: ArrayLike<number>) {
	windowMaxLength = Math.max(windowMaxLength, 2)

	if (sequence1.length == 0 || sequence2.length == 0) {
		return {
			path: [] as AlignmentPath,
			pathCost: 0
		}
	}

	// Compute accumulated cost matrix (transposed)
	const { accumulatedCostMatrixTransposed, windowStartOffsets } = computeAccumulatedCostMatrixTransposed(sequence1, sequence2, costFunction, windowMaxLength, centerIndexes)

	// Find best path for the computed matrix
	const path = computeBestPathTransposed(accumulatedCostMatrixTransposed, windowStartOffsets)

	// Best path cost is the bottom right element of the matrix
	const columnCount = accumulatedCostMatrixTransposed.length
	const rowCount = accumulatedCostMatrixTransposed[0].length

	const pathCost = accumulatedCostMatrixTransposed[columnCount - 1][rowCount - 1]

	// Return
	return { path, pathCost }
}

function computeAccumulatedCostMatrixTransposed<T, U>(sequence1: ArrayLike<T>, sequence2: ArrayLike<U>, costFunction: (a: T, b: U) => number, windowMaxLength: number, centerIndexes?: ArrayLike<number>) {
	const halfWindowMaxLength = Math.floor(windowMaxLength / 2)

	const columnCount = sequence1.length
	const rowCount = Math.min(windowMaxLength, sequence2.length)

	const accumulatedCostMatrixTransposed: Float32Array[] = new Array<Float32Array>(columnCount)

	// Initialize an array to store window start offsets
	const windowStartOffsets = new Int32Array(columnCount)

	// Compute accumulated cost matrix column by column
	for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
		// Create new column and add it to the matrix
		const currentColumn = new Float32Array(rowCount)
		accumulatedCostMatrixTransposed[columnIndex] = currentColumn

		// Compute window center, or use given one
		let windowCenter: number

		if (centerIndexes) {
			windowCenter = centerIndexes[columnIndex]
		} else {
			windowCenter = Math.floor((columnIndex / columnCount) * sequence2.length)
		}

		// Compute window start and end offsets
		let windowStartOffset = Math.max(windowCenter - halfWindowMaxLength, 0)
		let windowEndOffset = windowStartOffset + rowCount

		if (windowEndOffset > sequence2.length) {
			windowEndOffset = sequence2.length
			windowStartOffset = windowEndOffset - rowCount
		}

		// Store the start offset for this column
		windowStartOffsets[columnIndex] = windowStartOffset

		// Get target sequence1 value
		const targetSequence1Value = sequence1[columnIndex]

		// If this is the first column, fill it only using the 'up' neighbors
		if (columnIndex == 0) {
			for (let rowIndex = 1; rowIndex < rowCount; rowIndex++) {
				const cost = costFunction(targetSequence1Value, sequence2[windowStartOffset + rowIndex])
				const upCost = currentColumn[rowIndex - 1]

				currentColumn[rowIndex] = cost + upCost
			}

			continue
		}

		// If not first column

		// Store the column to the left
		const leftColumn = accumulatedCostMatrixTransposed[columnIndex - 1]

		// Compute the delta between the current window start offset
		// and left column's window offset
		const windowOffsetDelta = windowStartOffset - windowStartOffsets[columnIndex - 1]

		// Compute the accumulated cost for all rows in the window
		for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
			// Compute the cost for current cell
			const cost = costFunction(targetSequence1Value, sequence2[windowStartOffset + rowIndex])

			// Retrieve the cost for the 'up' (insertion) neighbor
			let upCost = Infinity
			if (rowIndex > 0) {
				upCost = currentColumn[rowIndex - 1]
			}

			// Retrieve the cost for the 'left' (deletion) neighbor
			let leftCost = Infinity
			const leftRowIndex = rowIndex + windowOffsetDelta

			if (leftRowIndex < rowCount) {
				leftCost = leftColumn[leftRowIndex]
			}

			// Retrieve the cost for the 'up and left' (match) neighbor
			let upAndLeftCost = Infinity
			const upAndLeftRowIndex = leftRowIndex - 1

			if (upAndLeftRowIndex >= 0 && upAndLeftRowIndex < rowCount) {
				upAndLeftCost = leftColumn[upAndLeftRowIndex]
			}

			// Find the minimum of all neighbors
			let minimumNeighborCost = minimumOf3(upCost, leftCost, upAndLeftCost)

			// If all neighbors are infinity, then it means there is a "jump" between the window
			// of the current column and the left column, and they don't have overlapping rows.
			// In this case, only the cost of the current cell will be used
			if (minimumNeighborCost === Infinity) {
				minimumNeighborCost = 0
			}

			// Write cost + minimum neighbor cost to the current column
			currentColumn[rowIndex] = cost + minimumNeighborCost
		}
	}

	return {
		accumulatedCostMatrixTransposed,
		windowStartOffsets
	}
}

function computeBestPathTransposed(accumulatedCostMatrixTransposed: ArrayLike<number>[], windowStartOffsets: ArrayLike<number>) {
	const columnCount = accumulatedCostMatrixTransposed.length
	const rowCount = accumulatedCostMatrixTransposed[0].length

	const bestPath: AlignmentPath = []

	// Start at the bottom right corner and find the best path
	// towards the top left
	let columnIndex = columnCount - 1
	let rowIndex = rowCount - 1

	while (columnIndex > 0 || rowIndex > 0) {
		const windowStartIndex = windowStartOffsets[columnIndex]
		const windowStartDelta = columnIndex > 0 ? windowStartIndex - windowStartOffsets[columnIndex - 1] : 0

		// Add the current cell to the best path
		bestPath.push({
			source: columnIndex,
			dest: windowStartIndex + rowIndex
		})

		// Retrieve the cost for the 'up' (insertion) neighbor
		const upRowIndex = rowIndex - 1
		let upCost = Infinity

		if (upRowIndex >= 0) {
			upCost = accumulatedCostMatrixTransposed[columnIndex][upRowIndex]
		}

		// Retrieve the cost for the 'left' (deletion) neighbor
		const leftRowIndex = rowIndex + windowStartDelta
		const leftColumnIndex = columnIndex - 1
		let leftCost = Infinity

		if (leftColumnIndex >= 0 && leftRowIndex < rowCount) {
			leftCost = accumulatedCostMatrixTransposed[leftColumnIndex][leftRowIndex]
		}

		// Retrieve the cost for the 'up and left' (match) neighbor
		const upAndLeftRowIndex = rowIndex - 1 + windowStartDelta
		const upAndLeftColumnIndex = columnIndex - 1
		let upAndLeftCost = Infinity

		if (upAndLeftColumnIndex >= 0 && upAndLeftRowIndex >= 0 && upAndLeftRowIndex < rowCount) {
			upAndLeftCost = accumulatedCostMatrixTransposed[upAndLeftColumnIndex][upAndLeftRowIndex]
		}

		// If all neighbors have a cost of infinity, it means
		// there is a "jump" between the window for the current and previous column
		if (upCost == Infinity && leftCost == Infinity && upAndLeftCost == Infinity) {
			// In that case:
			//
			// If there are rows above
			if (upRowIndex >= 0) {
				// Move upward
				rowIndex = upRowIndex
			} else if (leftColumnIndex >= 0) {
				// Otherwise, move to the left
				columnIndex = leftColumnIndex
			} else {
				// Since we know that either columnIndex > 0 or rowIndex > 0,
				// one of these directions must be available.
				// This error should never happen

				throw new Error(`Unexpected state: columnIndex: ${columnIndex}, rowIndex: ${rowIndex}`)
			}
		} else {
			// Choose the direction with the smallest cost
			const smallestCostDirection = argIndexOfMinimumOf3(upCost, leftCost, upAndLeftCost)

			if (smallestCostDirection == 1) {
				// Move upward
				rowIndex = upRowIndex
				// The upper column index stays the same
			} else if (smallestCostDirection == 2) {
				// Move to the left
				rowIndex = leftRowIndex
				columnIndex = leftColumnIndex
			} else {
				// Move upward and to the left
				rowIndex = upAndLeftRowIndex
				columnIndex = upAndLeftColumnIndex
			}
		}
	}

	bestPath.push({
		source: 0,
		dest: 0
	})

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
