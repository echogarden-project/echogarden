export function medianOf5Filter(points: ArrayLike<number>): Float32Array {
	// This function computes the moving median with a window of 5 elements.

	// I initialized the window such that at the edges of the range no median would be computed.
	// This is a form of optimization assuming that computing a median edge points
	// is less important.

	const pointCount = points.length

	if (pointCount < 5) {
		return Float32Array.from(points)
	}

	const medians = new Float32Array(pointCount)

	medians[0] = points[0]
	medians[1] = points[1]
	medians[pointCount - 2] = points[pointCount - 2]
	medians[pointCount - 1] = points[pointCount - 1]

	for (let i = 2; i < pointCount - 2; i++) {
		medians[i] = medianOf5(points[i - 2], points[i - 1], points[i], points[i + 1], points[i + 2])
	}

	return medians
}

export function medianOf3Filter(points: ArrayLike<number>) {
	// This function computes the moving median with a window of 3 elements.

	// I initialized the window such that at the edges of the range no median would be computed.

	const pointCount = points.length

	if (pointCount < 3) {
		return points
	}

	const medians = new Float32Array(pointCount)

	medians[0] = points[0]
	medians[pointCount - 1] = points[pointCount - 1]

	for (let i = 1; i < pointCount - 1; i++) {
		medians[i] = medianOf3(points[i - 1], points[i], points[i + 1])
	}

	return medians
}

export function medianOf5(a: number, b: number, c: number, d: number, e: number) {
	// These swapping computation should be faster than separately using the minimum and maximum
	// functions but maybe less readable.

	// Ensure b is greater or equal to a (swap if needed)
	if (b < a) {
		[a, b] = [b, a]
	}

	// Ensure d is greater or equal to c (swap if needed)
	if (d < c) {
		[c, d] = [d, c]
	}

	// What this part does is compute the two middle medians of the first 4 elements
	// given to the function (a, b, c, d), but it doesn't actually determine their relative order:
	const firstMedianOfABCD = Math.max(a, c) // First median of a, b, c, d
	const secondMedianOfABCD = Math.min(b, d) // Second median of a, b, c, d

	// Now in relation to all five numbers, the median can only be either
	// the first median of ABCD, the second median of ABCD, or E:
	return medianOf3(firstMedianOfABCD, secondMedianOfABCD, e)
}

export function medianOf3(a: number, b: number, c: number) {
	// This function uses a decision tree to find the median of three numbers.
	//
	// I tried to ensure that the comparison preserved the natural altering of
	// a, b and c such that in case that they are given already in order,
	// then all the initial branches would be directly taken.

	// Possible orderings:
	//
	// a, b, c
	// a, c, b
	// b, a, c
	// b, c, a
	// c, a, b
	// c, b, a

	if (a <= b) {
		if (b <= c) {
			return b // a, b, c
		} else if (a <= c) {
			return c // a, c, b
		} else {
			return a // c, a, b
		}
	} else {
		if (a <= c) {
			return a // b, a, c
		} else if (b <= c) {
			return c // b, c, a
		} else {
			return b // c, b, a
		}
	}
}
