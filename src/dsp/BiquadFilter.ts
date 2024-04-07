// Based on the Chromium WebAudio source code at:
// https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/web_tests/webaudio/resources/biquad-filters.js
//
// A biquad filter has a z-transform of
// H(z) = (b0 + b1 / z + b2 / z^2) / (1 + a1 / z + a2 / z^2)
//
// The formulas for the various filters were taken from:
// https://webaudio.github.io/Audio-EQ-Cookbook/audio-eq-cookbook.html
//
// MDN documentation:
// https://developer.mozilla.org/en-US/docs/Web/API/BiquadFilterNode

export function createLowpassFilter(sampleRate: number, cutoffFrequency: number, q = 0.7071) {
	return createFilter('lowpass', sampleRate, cutoffFrequency, q, 0)
}

export function createHighpassFilter(sampleRate: number, cutoffFrequency: number, q = 0.7071) {
	return createFilter('highpass', sampleRate, cutoffFrequency, q, 0)
}

export function createBandpassFilter(sampleRate: number, centerFrequency: number, q = 1) {
	return createFilter('bandpass', sampleRate, centerFrequency, q, 0)
}

export function createLowshelfFilter(sampleRate: number, midpointFrequency: number, gain: number) {
	return createFilter('lowshelf', sampleRate, midpointFrequency, 0, gain)
}

export function createHighshelfFilter(sampleRate: number, midpointFrequency: number, gain: number) {
	return createFilter('highshelf', sampleRate, midpointFrequency, 0, gain)
}

export function createPeakingFilter(sampleRate: number, centerFrequency: number, q = 1, gain = 0) {
	return createFilter('peaking', sampleRate, centerFrequency, q, gain)
}

export function createNotchFilter(sampleRate: number, centerFrequency: number, q = 1) {
	return createFilter('notch', sampleRate, centerFrequency, q, 0)
}

export function createAllpassFilter(sampleRate: number, centerFrequency: number, q = 1) {
	return createFilter('allpass', sampleRate, centerFrequency, q, 0)
}

export function createFilter(filterType: FilterType, sampleRate: number, frequency: number, q: number, gain: number) {
	const coefficients = getFilterCoefficients(filterType, sampleRate, frequency, q, gain)

	return new BiquadFilter(coefficients)
}

export class BiquadFilter {
	private b0 = 0
	private b1 = 0
	private b2 = 0
	private a1 = 0
	private a2 = 0

	private prevInput1 = 0
	private prevInput2 = 0

	private prevOutput1 = 0
	private prevOutput2 = 0

	constructor(coefficients: FilterCoefficients) {
		this.setCoefficients(coefficients)
	}

	filter(sample: number): number {
		const filteredSample =
			(this.b0 * sample) +
			(this.b1 * this.prevInput1) +
			(this.b2 * this.prevInput2) -
			(this.a1 * this.prevOutput1) -
			(this.a2 * this.prevOutput2)

		this.prevInput2 = this.prevInput1
		this.prevInput1 = sample

		this.prevOutput2 = this.prevOutput1
		this.prevOutput1 = filteredSample

		return filteredSample
	}

	filterSamplesInPlace(samples: Float32Array) {
		for (let i = 0; i < samples.length; i++) {
			samples[i] = this.filter(samples[i])
		}
	}

	reset() {
		this.prevInput1 = 0
		this.prevInput2 = 0
		this.prevOutput1 = 0
		this.prevOutput2 = 0
	}

	setCoefficients(coefficients: FilterCoefficients) {
		this.b0 = coefficients.b0
		this.b1 = coefficients.b1
		this.b2 = coefficients.b2
		this.a1 = coefficients.a1
		this.a2 = coefficients.a2
	}
}

export function getFilterCoefficients(filterType: FilterType, sampleRate: number, centerFrequency: number, q: number, gain: number) {
	const nyquistFrequency = sampleRate / 2
	const freqRatio = clamp(centerFrequency / nyquistFrequency, 0, 1)

	return filterCoefficientsFunction[filterType](freqRatio, q, gain) as FilterCoefficients
}

// Lowpass filter.
export function getLowpassFilterCoefficients(freqRatio: number, q: number, gain: number): FilterCoefficients {
	let b0: number
	let b1: number
	let b2: number
	let a0: number
	let a1: number
	let a2: number

	if (freqRatio == 1) {
		// The formula below works, except for roundoff.  When freqRatio = 1,
		// the filter is just a wire, so hardwire the coefficients.
		b0 = 1
		b1 = 0
		b2 = 0
		a0 = 1
		a1 = 0
		a2 = 0
	} else {
		const theta = Math.PI * freqRatio
		const alpha = Math.sin(theta) / (2 * Math.pow(10, q / 20))
		const cosw = Math.cos(theta)
		const beta = (1 - cosw) / 2

		b0 = beta
		b1 = 2 * beta
		b2 = beta
		a0 = 1 + alpha
		a1 = -2 * cosw
		a2 = 1 - alpha
	}

	return normalizeFilterCoefficients(b0, b1, b2, a0, a1, a2)
}

function getHighpassFilterCoefficients(freqRatio: number, q: number, gain: number): FilterCoefficients {
	let b0: number
	let b1: number
	let b2: number
	let a0: number
	let a1: number
	let a2: number

	if (freqRatio == 1) {
		// The filter is 0
		b0 = 0
		b1 = 0
		b2 = 0
		a0 = 1
		a1 = 0
		a2 = 0
	} else if (freqRatio == 0) {
		// The filter is 1.  Computation of coefficients below is ok, but
		// there's a pole at 1 and a zero at 1, so round-off could make
		// the filter unstable.
		b0 = 1
		b1 = 0
		b2 = 0
		a0 = 1
		a1 = 0
		a2 = 0
	} else {
		const theta = Math.PI * freqRatio
		const alpha = Math.sin(theta) / (2 * Math.pow(10, q / 20))
		const cosw = Math.cos(theta)
		const beta = (1 + cosw) / 2

		b0 = beta
		b1 = -2 * beta
		b2 = beta
		a0 = 1 + alpha
		a1 = -2 * cosw
		a2 = 1 - alpha
	}

	return normalizeFilterCoefficients(b0, b1, b2, a0, a1, a2)
}

function getBandpassFilterCoefficients(freqRatio: number, q: number, gain: number): FilterCoefficients {
	let b0: number
	let b1: number
	let b2: number
	let a0: number
	let a1: number
	let a2: number

	let coefficients: FilterCoefficients

	if (freqRatio > 0 && freqRatio < 1) {
		const w0 = Math.PI * freqRatio

		if (q > 0) {
			const alpha = Math.sin(w0) / (2 * q)
			const k = Math.cos(w0)

			b0 = alpha
			b1 = 0
			b2 = -alpha
			a0 = 1 + alpha
			a1 = -2 * k
			a2 = 1 - alpha

			coefficients = normalizeFilterCoefficients(b0, b1, b2, a0, a1, a2)
		} else {
			// q = 0, and frequency ratio is not 0 or 1.  The above formula has a
			// divide by zero problem.  The limit of the z-transform as q
			// approaches 0 is 1, so set the filter that way.
			coefficients = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }
		}
	} else {
		// When freqRatio = 0 or 1, the z-transform is identically 0,
		// independent of q.
		coefficients = { b0: 0, b1: 0, b2: 0, a1: 0, a2: 0 }
	}

	return coefficients
}

function getLowShelfFilterCoefficients(freqRatio: number, q: number, gain: number): FilterCoefficients {
	// q not used
	let b0: number
	let b1: number
	let b2: number
	let a0: number
	let a1: number
	let a2: number

	let coefficients: FilterCoefficients

	const S = 1
	const A = Math.pow(10, gain / 40)

	if (freqRatio == 1) {
		// The filter is just a constant gain
		coefficients = { b0: A * A, b1: 0, b2: 0, a1: 0, a2: 0 }
	} else if (freqRatio == 0) {
		// The filter is 1
		coefficients = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }
	} else {
		const w0 = Math.PI * freqRatio
		const alpha = 1 / 2 * Math.sin(w0) * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2)
		const k = Math.cos(w0)
		const k2 = 2 * Math.sqrt(A) * alpha
		const Ap1 = A + 1
		const Am1 = A - 1

		b0 = A * (Ap1 - Am1 * k + k2)
		b1 = 2 * A * (Am1 - Ap1 * k)
		b2 = A * (Ap1 - Am1 * k - k2)
		a0 = Ap1 + Am1 * k + k2
		a1 = -2 * (Am1 + Ap1 * k)
		a2 = Ap1 + Am1 * k - k2

		coefficients = normalizeFilterCoefficients(b0, b1, b2, a0, a1, a2)
	}

	return coefficients
}

function getHighShelfFilterCoefficients(freqRatio: number, q: number, gain: number): FilterCoefficients {
	// q not used
	let b0: number
	let b1: number
	let b2: number
	let a0: number
	let a1: number
	let a2: number

	let coefficients: FilterCoefficients

	const A = Math.pow(10, gain / 40)

	if (freqRatio == 1) {
		// When freqRatio = 1, the z-transform is 1
		coefficients = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }
	} else if (freqRatio > 0) {
		const w0 = Math.PI * freqRatio
		const S = 1
		const alpha = 0.5 * Math.sin(w0) * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2)
		const k = Math.cos(w0)
		const k2 = 2 * Math.sqrt(A) * alpha
		const Ap1 = A + 1
		const Am1 = A - 1

		b0 = A * (Ap1 + Am1 * k + k2)
		b1 = -2 * A * (Am1 + Ap1 * k)
		b2 = A * (Ap1 + Am1 * k - k2)
		a0 = Ap1 - Am1 * k + k2
		a1 = 2 * (Am1 - Ap1 * k)
		a2 = Ap1 - Am1 * k - k2

		coefficients = normalizeFilterCoefficients(b0, b1, b2, a0, a1, a2)
	} else {
		// When freqRatio = 0, the filter is just a gain
		coefficients = { b0: A * A, b1: 0, b2: 0, a1: 0, a2: 0 }
	}

	return coefficients
}

function getPeakingFilterCoefficients(freqRatio: number, q: number, gain: number): FilterCoefficients {
	let b0: number
	let b1: number
	let b2: number
	let a0: number
	let a1: number
	let a2: number

	let coefficients: FilterCoefficients

	const A = Math.pow(10, gain / 40)

	if (freqRatio > 0 && freqRatio < 1) {
		if (q > 0) {
			const w0 = Math.PI * freqRatio
			const alpha = Math.sin(w0) / (2 * q)
			const k = Math.cos(w0)

			b0 = 1 + alpha * A
			b1 = -2 * k
			b2 = 1 - alpha * A
			a0 = 1 + alpha / A
			a1 = -2 * k
			a2 = 1 - alpha / A

			coefficients = normalizeFilterCoefficients(b0, b1, b2, a0, a1, a2)
		} else {
			// q = 0, we have a divide by zero problem in the formulas
			// above.  But if we look at the z-transform, we see that the
			// limit as q approaches 0 is A^2.
			coefficients = { b0: A * A, b1: 0, b2: 0, a1: 0, a2: 0 }
		}
	} else {
		// freqRatio = 0 or 1, the z-transform is 1
		coefficients = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }
	}

	return coefficients
}

function getNotchFilterCoefficients(freqRatio: number, q: number, gain: number): FilterCoefficients {
	let b0: number
	let b1: number
	let b2: number
	let a0: number
	let a1: number
	let a2: number

	let coefficients: FilterCoefficients

	if (freqRatio > 0 && freqRatio < 1) {
		if (q > 0) {
			const w0 = Math.PI * freqRatio
			const alpha = Math.sin(w0) / (2 * q)
			const k = Math.cos(w0)

			b0 = 1
			b1 = -2 * k
			b2 = 1
			a0 = 1 + alpha
			a1 = -2 * k
			a2 = 1 - alpha

			coefficients = normalizeFilterCoefficients(b0, b1, b2, a0, a1, a2)
		} else {
			// When q = 0, we get a divide by zero above.  The limit of the
			// z-transform as q approaches 0 is 0, so set the coefficients
			// appropriately.
			coefficients = { b0: 0, b1: 0, b2: 0, a1: 0, a2: 0 }
		}
	} else {
		// When freqRatio = 0 or 1, the z-transform is 1
		coefficients = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }
	}

	return coefficients
}

function getAllpassFilterCoefficients(freqRatio: number, q: number, gain: number): FilterCoefficients {
	let b0: number
	let b1: number
	let b2: number
	let a0: number
	let a1: number
	let a2: number

	let coefficients: FilterCoefficients

	if (freqRatio > 0 && freqRatio < 1) {
		if (q > 0) {
			const w0 = Math.PI * freqRatio
			const alpha = Math.sin(w0) / (2 * q)
			const k = Math.cos(w0)

			b0 = 1 - alpha
			b1 = -2 * k
			b2 = 1 + alpha
			a0 = 1 + alpha
			a1 = -2 * k
			a2 = 1 - alpha

			coefficients = normalizeFilterCoefficients(b0, b1, b2, a0, a1, a2)
		} else {
			// q = 0
			coefficients = { b0: -1, b1: 0, b2: 0, a1: 0, a2: 0 }
		}
	} else {
		coefficients = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }
	}

	return coefficients
}

function normalizeFilterCoefficients(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): FilterCoefficients {
	const scale = 1 / a0

	return {
		b0: b0 * scale,
		b1: b1 * scale,
		b2: b2 * scale,
		a1: a1 * scale,
		a2: a2 * scale
	}
}

export function bandwidthToQFactor(bandwidth: number) {
	const twoToBandwidth = 2 ** bandwidth
	const q = Math.sqrt(twoToBandwidth) / (twoToBandwidth - 1)

	return q
}

export function qFactorToBandwidth(q: number) {
	const bandwidth = (2 / Math.log(2)) * Math.asinh(1 / (2 * q))

	return bandwidth
}

export function clamp(num: number, min: number, max: number) {
	return Math.max(min, Math.min(max, num))
}

// Map the filter type name to a function that computes the filter coefficents
// for the given filter type.
const filterCoefficientsFunction: { [name in FilterType]: Function } = {
	'lowpass': getLowpassFilterCoefficients,
	'highpass': getHighpassFilterCoefficients,
	'bandpass': getBandpassFilterCoefficients,
	'lowshelf': getLowShelfFilterCoefficients,
	'highshelf': getHighShelfFilterCoefficients,
	'peaking': getPeakingFilterCoefficients,
	'notch': getNotchFilterCoefficients,
	'allpass': getAllpassFilterCoefficients
}

export const filterTypeName: { [name in FilterType]: string } = {
	'lowpass': 'Lowpass filter',
	'highpass': 'Highpass filter',
	'bandpass': 'Bandpass filter',
	'lowshelf': 'Lowshelf filter',
	'highshelf': 'Highshelf filter',
	'peaking': 'Peaking filter',
	'notch': 'Notch filter',
	'allpass': 'Allpass filter'
}

export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'lowshelf' | 'highshelf' | 'peaking' | 'notch' | 'allpass'

export type FilterCoefficients = {
	b0: number
	b1: number
	b2: number
	a1: number
	a2: number
}

export const emptyBiquadCoefficients: FilterCoefficients = {
	b0: 0,
	b1: 0,
	b2: 0,
	a1: 0,
	a2: 0,
}
