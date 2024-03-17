import ndarray from 'ndarray'
// import ops from 'ndarray-ops'
import { medianFilter, softmax } from '../math/VectorMath.js'

export function ndarraySoftMax(vector: ndarray.NdArray, temperature = 1.0) {
	const vectorAsArray = new Array(vector.shape[0])

	for (let i = 0; i < vectorAsArray.length; i++) {
		vectorAsArray[i] = vector.get(i)
	}

	const result = softmax(vectorAsArray, temperature)

	for (let i = 0; i < vectorAsArray.length; i++) {
		vector.set(i, result[i])
	}
}

export function ndarrayMedianFilter(vector: ndarray.NdArray, width: number) {
	const vectorAsArray = new Array(vector.shape[0])

	for (let i = 0; i < vectorAsArray.length; i++) {
		vectorAsArray[i] = vector.get(i)
	}

	const result = medianFilter(vectorAsArray, width)

	for (let i = 0; i < vectorAsArray.length; i++) {
		vector.set(i, result[i])
	}
}
