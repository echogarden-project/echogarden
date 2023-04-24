export function knuthMultiplicative(bytes: Buffer) {
	let hash = 0

	for (const byte of bytes) {
		hash += Math.imul(byte, 2654435761)
	}

	return hash
}

export function xorShift32Hash(bytes: Buffer) {
	let s = 0

	for (const byte of bytes) {
		s += byte

		s ^= s << 13
		s ^= s >> 17
		s ^= s << 5
	}

	return s
}

export function jenkinsOneAtATime(bytes: Buffer) {
	let hash = 0

	for (const byte of bytes) {
		hash += byte
		hash += hash << 10
		hash ^= hash >> 6
	}

	hash += hash << 3
	hash ^= hash >> 11
	hash += hash << 15

	return hash >>> 0
}

export function FNV1a(bytes: Buffer) {
	let hval = 2166136261 | 0

	for (const byte of bytes) {
		hval = Math.imul(hval ^ byte, 16777619)
	}

	return hval >>> 0
}

export function superFastHash(bytes: Buffer) {
	let hash = bytes.length, tmp, p = 0
	const len = bytes.length >>> 2

	for (let i = 0; i < len; i++) {
		hash += bytes[p] | bytes[p + 1] << 8
		tmp = ((bytes[p + 2] | bytes[p + 3] << 8) << 11) ^ hash
		hash = (hash << 16) ^ tmp
		hash += hash >>> 11
		p += 4
	}

	switch (bytes.length & 3) {
		case 3:
			hash += bytes[p] | bytes[p + 1] << 8
			hash ^= hash << 16
			hash ^= bytes[p + 2] << 18
			hash += hash >>> 11
			break
		case 2:
			hash += bytes[p] | bytes[p + 1] << 8
			hash ^= hash << 11
			hash += hash >>> 17
			break
		case 1:
			hash += bytes[p]
			hash ^= hash << 10
			hash += hash >>> 1
			break
	}

	hash ^= hash << 3
	hash += hash >>> 5
	hash ^= hash << 4
	hash += hash >>> 17
	hash ^= hash << 25
	hash += hash >>> 6

	return hash >>> 0
}

export function cyrb53Hash(bytes: Buffer, seed = 0) {
	// https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js

	let h1 = 0xdeadbeef ^ seed
	let h2 = 0x41c6ce57 ^ seed

	for (const byte of bytes) {
		h1 = Math.imul(h1 ^ byte, 2654435761)
		h2 = Math.imul(h2 ^ byte, 1597334677)
	}

	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)

	return (4294967296 * (2097151 & h2)) + (h1 >>> 0)
}

export function djb2(bytes: Buffer) {
	let hash = 5381

	for (const byte of bytes) {
		//hash += (hash << 5) + byte
		hash += (hash * 33) + byte
	}

	return hash >>> 0
}


export function murmurHash1(bytes: Buffer, seed = 0) {
	// https://github.com/bryc/code/blob/master/jshash/hashes/murmurhash1.js

	const length = bytes.length

	const multiplier = 3332679571
	const intIterationMaxIndex = length & -4

	let hash = seed ^ Math.imul(length, multiplier)
	let index = 0

	for (; index < intIterationMaxIndex; index += 4) {
		hash += bytes[index + 3] << 24 |
			bytes[index + 2] << 16 |
			bytes[index + 1] << 8 |
			bytes[index]

		hash = Math.imul(hash, multiplier)
		hash ^= hash >>> 16
	}

	switch (length & 3) {
		case 3: {
			hash += bytes[index + 2] << 16
		}

		case 2: {
			hash += bytes[index + 1] << 8
		}

		case 1: {
			hash += bytes[index]
			hash = Math.imul(hash, multiplier)
			hash ^= hash >>> 16
		}
	}

	hash = Math.imul(hash, multiplier)
	hash ^= hash >>> 10

	hash = Math.imul(hash, multiplier)
	hash ^= hash >>> 17

	return hash >>> 0
}

export function MurmurHash3(bytes: Buffer, seed = 0) {
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
