
import { RawAudio } from '../audio/AudioUtilities.js'
import { Logger } from '../utilities/Logger.js'
import { extendDeep } from '../utilities/ObjectUtilities.js'
import { Timeline, TimelineEntry } from '../utilities/Timeline.js'

export async function recognize(rawAudio: RawAudio, languageCode: string | undefined, options: DeepgramSTTOptions) {
    const logger = new Logger()

    logger.start('Initialize Deepgram recognition')

    options = extendDeep(defaultDeepgramSTTOptions, options)

    if (!options.apiKey) {
        throw new Error('No Deepgram API key provided')
    }

    // Prepare API request
    const url = new URL('https://api.deepgram.com/v1/listen')

    url.searchParams.set('model', options.model || 'whisper-large')

    // Set language or enable auto-detection
    if (languageCode) {
        url.searchParams.set('language', languageCode)
    } else {
        url.searchParams.set('detect_language', 'true')
    }

    // Set audio encoding parameters
    url.searchParams.set('encoding', 'linear16')
    url.searchParams.set('channels', '1')
    url.searchParams.set('sample_rate', '16000')

    logger.log('Converting Float32 PCM to Int16 PCM format')
    const float32Data = rawAudio.audioChannels[0]
    const int16Data = new Int16Array(float32Data.length)

    // Convert float32 (-1.0 to 1.0) to int16 (-32768 to 32767)
    for (let i = 0; i < float32Data.length; i++) {
        int16Data[i] = Math.max(-32768, Math.min(32767, Math.round(float32Data[i] * 32767)))
    }

    // Create Uint8Array view of the Int16Array for sending
    const audioData = new Uint8Array(int16Data.buffer)

    // Log request details
    logger.log(`Request URL: ${url.toString()}`)
    logger.log(`Request headers: Authorization: Key ***${options.apiKey.slice(-4)}, Content-Type: audio/raw`)

    logger.start('Send request to Deepgram API')
    const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
            'Authorization': `Token ${options.apiKey}`,
            'Content-Type': 'audio/raw',
            'Accept': 'application/json'
        },
        body: audioData
    })

    if (!response.ok) {
        const error = await response.text()
        throw new Error(`Deepgram API error: ${error}`)
    }

    const result = await response.json() as DeepgramResponse

    // Extract transcript and create timeline
    const transcript = result.results?.channels[0]?.alternatives[0]?.transcript || ''

    let timeline: Timeline = []

    // Extract word-level timing information if available
    const words = result.results?.channels[0]?.alternatives[0]?.words || []
    if (words.length > 0) {
        timeline = words.map((word: DeepgramWord): TimelineEntry => ({
            type: 'word',
            text: word.word,
            startTime: word.start,
            endTime: word.end
        }))
    }

    logger.end()

    return { transcript, timeline }
}
export interface DeepgramSTTOptions {
    apiKey?: string
    model?: string
}

export const defaultDeepgramSTTOptions: DeepgramSTTOptions = {
    apiKey: undefined,
    model: 'nova-2'
}


interface DeepgramWord {
    word: string
    start: number
    end: number
    confidence: number
}

interface DeepgramAlternative {
    transcript: string
    confidence: number
    words: DeepgramWord[]
}

interface DeepgramChannel {
    alternatives: DeepgramAlternative[]
}

interface DeepgramResponse {
    metadata?: {
        transaction_key: string
        request_id: string
        sha256: string
        created: string
        duration: number
        channels: number
        models: string[]
        model_info?: {
            name: string
            version: string
        }
    }
    results?: {
        channels: DeepgramChannel[]
        detected_language?: string
    }
}
