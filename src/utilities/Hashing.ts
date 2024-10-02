export function murmurHash3(bytes: Uint8Array, seed = 0) {
	// https://github.com/bryc/code/blob/master/jshash/hashes/murmurhash3.js

	const p1 = 3432918353
	const p2 = 461845907
	const p3 = 2246822507
	const p4 = 3266489909

	const byteCount = bytes.length

	const intIterationMaxIndex = byteCount & -4

	let k = 0
	let hash = seed | 0
	let i = 0

	for (; i < intIterationMaxIndex; i += 4) {
		k = bytes[i + 3] << 24 | bytes[i + 2] << 16 | bytes[i + 1] << 8 | bytes[i]

		k = Math.imul(k, p1)

		k = k << 15 | k >>> 17

		hash ^= Math.imul(k, p2)

		hash = hash << 13 | hash >>> 19

		hash = (Math.imul(hash, 5) + 3864292196) | 0 // |0 = prevent float
	}

	k = 0

	switch (bytes.length & 3) {
		case 3: {
			k ^= bytes[i + 2] << 16
		}

		case 2: {
			k ^= bytes[i + 1] << 8
		}

		case 1: {
			k ^= bytes[i]

			k = Math.imul(k, p1)

			k = k << 15 | k >>> 17

			hash ^= Math.imul(k, p2)
		}
	}

	hash ^= byteCount

	hash ^= hash >>> 16

	hash = Math.imul(hash, p3)
	hash ^= hash >>> 13

	hash = Math.imul(hash, p4)
	hash ^= hash >>> 16

	return hash >>> 0
}

export function convertToSingleInt32Hash(hash: (bytes: Uint8Array) => number) {
	const bytes = new Uint8Array(4)
	const ints = new Int32Array(bytes.buffer)

	return (int32Val: number): number => {
		ints[0] = int32Val

		return hash(bytes)
	}
}

export const murmurHash3_int32Input = convertToSingleInt32Hash(murmurHash3)
