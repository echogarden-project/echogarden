import { test, expect } from 'vitest'
import * as Echogarden from '../src/api/API.ts'
import { readFileAsUtf8 } from '../src/utilities/FileSystem.ts'

const log = console.error

test(`Gets voice list`, async () => {
	const voiceList = await Echogarden.requestVoiceList({
		engine: 'espeak'
	})

	expect(voiceList.voiceList.length).toBeGreaterThan(0)
})

test(`Synthesizes "hello world" in all supported languages`, async () => {
	const text = 'Hello World!'

	await testSynthesisInAllLanguages(text)
}, Infinity)

test(`Synthesizes a sentence with diverse punctuation in all supported languages`, async () => {
	const text = `
	hey, yo|b, hello: <<good>
	and <bad>>; "say"

	ba|, @ $$$$great$$$$ , h^i: <good>
`

	await testSynthesisInAllLanguages(text)
}, Infinity)

test(`Synthesizes Lorem Ipsum in all supported languages`, async () => {
	const text = await readFileAsUtf8('tests/inputs/lorem-ipsum.txt')

	await testSynthesisInAllLanguages(text)
}, Infinity)

test(`Synthesizes complex ASCII art in all supported languages`, async () => {
	const text = await readFileAsUtf8('tests/inputs/ascii-art.txt')

	await testSynthesisInAllLanguages(text)
}, Infinity)

async function testSynthesisInAllLanguages(text: string) {
	const voiceList = await Echogarden.requestVoiceList({
		engine: 'espeak'
	})

	expect(voiceList.voiceList.length).toBeGreaterThan(0)

	const failedVoices: string[] = []

	for (const voiceEntry of voiceList.voiceList) {
		try {
			const result = await Echogarden.synthesize(text, {
				engine: 'espeak',
				voice: voiceEntry.name,
			}, { logLevel: 'silent' })

			if (result.audio instanceof Uint8Array) {
				expect(result.audio.length).toBeGreaterThan(0)
			} else {
				expect(result.audio.audioChannels.length).toBeGreaterThan(0)
				expect(result.audio.audioChannels[0].length).toBeGreaterThan(0)
			}
		} catch (e) {
			failedVoices.push(voiceEntry.name)
		}
	}

	expect(failedVoices).toEqual([])
}
