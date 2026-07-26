import type { LanguageCode, SynthesizeSpeechCommandInput, VoiceId } from '@aws-sdk/client-polly'
import { IncomingMessage } from 'http'
import * as FFMpegTranscoder from '../codecs/FFMpegTranscoder.js'
import { Logger } from '../utilities/Logger.js'

import { readBinaryIncomingMessage } from '../utilities/Utilities.js'
import { SynthesisCallbacks, VoiceListRequestCallbacks } from '../api/API.js'

export async function synthesize(text: string, language: string | undefined, voice: string, region: string, accessKeyId: string, secretAccessKey: string, engine: 'standard' | 'neural' = 'standard', ssmlEnabled = false, lexiconNames: string[] | undefined, callbacks: SynthesisCallbacks) {
	const logger = new Logger(callbacks.logLevel)

	logger.start('Load AWS SDK client module')

	const polly = await import('@aws-sdk/client-polly')

	const pollyClient = new polly.PollyClient({
		region,
		credentials: {
			accessKeyId,
			secretAccessKey
		}
	})

	const params: SynthesizeSpeechCommandInput = {
		VoiceId: voice as VoiceId,

		LanguageCode: language as LanguageCode,

		Engine: engine,
		Text: text,
		LexiconNames: lexiconNames,

		TextType: ssmlEnabled ? 'ssml' : 'text',

		OutputFormat: 'mp3',
	}

	logger.start('Request synthesis from AWS Polly')

	const command = new polly.SynthesizeSpeechCommand(params)

	const result = await pollyClient.send(command)

	const audioStream: IncomingMessage = result.AudioStream as any

	const audioData = await readBinaryIncomingMessage(audioStream)

	logger.end()

	const rawAudio = await FFMpegTranscoder.decodeToChannels(
		audioData as any,
		undefined,
		undefined,
		{ abortSignal: callbacks.abortSignal, logLevel: 'warning' }
	)

	return { rawAudio }
}

export async function getVoiceList(region: string, accessKeyId: string, secretAccessKey: string, callbacks: VoiceListRequestCallbacks) {
	const logger = new Logger(callbacks.logLevel)
	logger.start('Load AWS SDK client module')

	const polly = await import('@aws-sdk/client-polly')

	logger.start('Request voice list from AWS Polly')

	const pollyClient = new polly.PollyClient({
		region,
		credentials: {
			accessKeyId,
			secretAccessKey
		}
	})

	const command = new polly.DescribeVoicesCommand({})

	const result = await pollyClient.send(command)

	const voices = result.Voices!

	logger.end()

	return voices
}
