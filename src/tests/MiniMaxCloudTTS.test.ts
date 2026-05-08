import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
	voiceList,
	defaultMiniMaxCloudTTSOptions,
	type MiniMaxCloudTTSOptions,
} from '../synthesis/MiniMaxCloudTTS.js'

// ---------------------------------------------------------------------------
// Unit tests — no network calls, no API key required
// ---------------------------------------------------------------------------

describe('MiniMaxCloudTTS – voiceList', () => {
	test('exports a non-empty voiceList', () => {
		assert.ok(Array.isArray(voiceList))
		assert.ok(voiceList.length > 0)
	})

	test('every voice has a name, languages array, and gender', () => {
		for (const voice of voiceList) {
			assert.ok(typeof voice.name === 'string' && voice.name.length > 0, `voice.name must be non-empty string: ${voice.name}`)
			assert.ok(Array.isArray(voice.languages) && voice.languages.length > 0, `voice.languages must be non-empty array for ${voice.name}`)
			assert.ok(['male', 'female', 'unknown'].includes(voice.gender as string), `voice.gender must be valid for ${voice.name}`)
		}
	})

	test('known English voices are present', () => {
		const names = voiceList.map(v => v.name)
		assert.ok(names.includes('English_Graceful_Lady'))
		assert.ok(names.includes('English_Insightful_Speaker'))
		assert.ok(names.includes('English_radiant_girl'))
		assert.ok(names.includes('English_Persuasive_Man'))
		assert.ok(names.includes('English_Lucky_Robot'))
	})

	test('known multi-language voices are present', () => {
		const names = voiceList.map(v => v.name)
		assert.ok(names.includes('Wise_Woman'))
		assert.ok(names.includes('Deep_Voice_Man'))
		assert.ok(names.includes('sweet_girl'))
	})

	test('invalid voice IDs are not present', () => {
		const names = voiceList.map(v => v.name)
		assert.ok(!names.includes('Chinese_Empress'), 'Chinese_Empress is an invalid voice ID')
		assert.ok(!names.includes('Narrator_Man'), 'Narrator_Man is an invalid voice ID')
		assert.ok(!names.includes('podcast_girl'), 'podcast_girl is an invalid voice ID')
		assert.ok(!names.includes('young_boy'), 'young_boy is an invalid voice ID')
	})

	test('all voices include "en" language', () => {
		for (const voice of voiceList) {
			const hasEnglish = voice.languages.includes('en') || voice.languages.some(l => l.startsWith('en-'))
			assert.ok(hasEnglish, `voice ${voice.name} should support English`)
		}
	})
})

describe('MiniMaxCloudTTS – defaultMiniMaxCloudTTSOptions', () => {
	test('default model is speech-2.8-hd', () => {
		assert.strictEqual(defaultMiniMaxCloudTTSOptions.model, 'speech-2.8-hd')
	})

	test('default baseURL points to api.minimax.io', () => {
		assert.strictEqual(defaultMiniMaxCloudTTSOptions.baseURL, 'https://api.minimax.io')
	})

	test('default apiKey is undefined', () => {
		assert.strictEqual(defaultMiniMaxCloudTTSOptions.apiKey, undefined)
	})
})

describe('MiniMaxCloudTTS – options type compliance', () => {
	test('accepts all valid model values', () => {
		const hd: MiniMaxCloudTTSOptions = { model: 'speech-2.8-hd' }
		const turbo: MiniMaxCloudTTSOptions = { model: 'speech-2.8-turbo' }
		assert.strictEqual(hd.model, 'speech-2.8-hd')
		assert.strictEqual(turbo.model, 'speech-2.8-turbo')
	})

	test('accepts optional apiKey and baseURL', () => {
		const opts: MiniMaxCloudTTSOptions = {
			apiKey: 'test-key',
			baseURL: 'https://custom.example.com',
			model: 'speech-2.8-turbo',
		}
		assert.strictEqual(opts.apiKey, 'test-key')
		assert.strictEqual(opts.baseURL, 'https://custom.example.com')
	})
})

describe('MiniMaxCloudTTS – synthesize (error handling)', () => {
	test('throws if no API key given and MINIMAX_API_KEY not set', async () => {
		const savedEnv = process.env['MINIMAX_API_KEY']
		delete process.env['MINIMAX_API_KEY']

		try {
			const { synthesize } = await import('../synthesis/MiniMaxCloudTTS.js')
			await assert.rejects(
				() => synthesize('hello', 'English_Graceful_Lady', 1.0, {}),
				(err: Error) => {
					assert.ok(err.message.includes('No MiniMax API key'), `Unexpected error message: ${err.message}`)
					return true
				}
			)
		} finally {
			if (savedEnv !== undefined) {
				process.env['MINIMAX_API_KEY'] = savedEnv
			}
		}
	})
})

describe('MiniMax integration with SynthesisEngine type', () => {
	test('minimax-cloud appears in SynthesisEngine type (runtime check via engineList)', async () => {
		const { synthesisEngines } = await import('../api/Synthesis.js')
		const engineIds = synthesisEngines.map((e: { id: string }) => e.id)
		assert.ok(engineIds.includes('minimax-cloud'), `minimax-cloud not found in synthesisEngines: ${engineIds}`)
	})
})
