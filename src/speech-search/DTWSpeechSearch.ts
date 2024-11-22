import { DtwGranularity, getMfccOptionsForGranularity } from "../alignment/SpeechAlignment.js";
import { RawAudio } from "../audio/AudioUtilities.js";
import { computeMFCCs, extendDefaultMfccOptions, MfccOptions } from "../dsp/MFCC.js";
import { euclideanDistance13Dim } from "../math/VectorMath.js";
import { Logger } from "../utilities/Logger.js";

export async function searchSpeech(sourceRawAudio: RawAudio, queryRawAudio: RawAudio) {
	const logger = new Logger()

	const granularity: DtwGranularity = 'low'

	const mfccOptions = extendDefaultMfccOptions({ ...getMfccOptionsForGranularity(granularity), zeroFirstCoefficient: true }) as MfccOptions

	logger.start('Compute query MFCC features')
	const queryMfccs = await computeMFCCs(queryRawAudio, mfccOptions)

	logger.start('Compute source MFCC features')
	const sourceMfccs = await computeMFCCs(sourceRawAudio, mfccOptions)

	logger.start('Compute cost matrix')

	const costMatrixColumns = computeCostMatrix(sourceMfccs, queryMfccs, euclideanDistance13Dim)

	logger.start('Search')

	const rowCount = sourceMfccs.length
	const columnCount = queryMfccs.length

	const maxSearchWindow = columnCount * 2

	for (let rowStartOffset = 0; rowStartOffset < rowCount; rowStartOffset++) {
		const rowEndOffset = Math.min(rowStartOffset + maxSearchWindow, rowCount)

		
	}
}

function computeCostMatrix<T, U>(sequence1: T[], sequence2: U[], costFunction: (a: T, b: U) => number) {
	const rowCount = sequence1.length
	const columnCount = sequence2.length

	const costMatrixColumns: Float32Array[] = []

	for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
		const column = new Float32Array(rowCount)

		for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
			const cost = costFunction(sequence1[rowIndex], sequence2[columnIndex])

			column[columnIndex] = cost
		}

		costMatrixColumns.push(column)
	}

	return costMatrixColumns
}
