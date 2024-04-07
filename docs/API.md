# API reference

This is a reference for the main methods available in both the JavaScript/TypeScript API and WebSocket messaging-based API.

**Note**: the API is not stable yet. It may change at every new version. There are many methods, types and internal data structures that are not yet exposed.

### Importing as a Node.js module
To import the `echograden` package as a Node.js module:

Install as a dependency in your project:
```bash
npm install echogarden
```

Import with:
```ts
import * as Echogarden from 'echogarden'
```

All methods, properties and arguments have TypeScript type information. You can use it to get more detailed and up-to-date type information that may not be covered in the documentation.

### Related resources
* [Options reference](Options.md)
* [A comprehensive list of all supported engines](Engines.md)
* [A quick guide for using the command line interface](CLI.md)
* [Guide for running and interfacing with a WebSocket server](Server.md)

## Synthesis

### `synthesize(input, options, onSegment, onSentence)`

Synthesizes the given input.

* `input`: Text to synthesize, can be a `string`, or a `string[]`. When given an array of strings, the elements of the array would be seen as predefined segments (this is useful if you would like to have more control over how segments are split, or your input has a special format requiring a custom splitting method).
* `options`: Synthesis options object
* `onSegment`: A callback that is called whenever a segment has been synthesized (optional)
* `onSentence`: A callback that is called whenever a sentence has been synthesized (optional)

#### Returns (via promise):

```ts
{
	audio: RawAudio | Buffer
	timeline: Timeline
	language: string
}
```

`audio` may either be a
* `RawAudio` object, which is a structure containing the sample rate and raw 32-bit float channels:
```ts
{
	sampleRate: number
	channels: Float32Array[]
}
```
* A `Buffer` containing the audio in encoded form, in the case a particular codec was specified in the `outputAudioFormat.codec` option.

#### Segment and sentence event callbacks

You can optionally pass two `async` callbacks to `synthesize`, `onSegment` and `onSentence`.

For example:
```ts
async function onSegment(data: SynthesisSegmentEventData) {
	console.log(data.transcript)
}

const { audio } = await Echogarden.synthesize("Hello World!", { engine: 'espeak' }, onSegment)
```

`SynthesisSegmentEventData` is an object with the structure:
```ts
{
	index: number              // Index of part
	total: number              // Total number of parts
	audio: RawAudio | Buffer   // Audio for part
	timeline: Timeline         // Timeline for part
	transcript: string         // Transcript for part
	language: string           // Language for part
	peakDecibelsSoFar: number  // Peak decibels measured for all synthesized audio, so far
}
```

### `requestVoiceList(options)`

Requests a list of voices for a particular engine.

* `options`: Voice list request options object

#### Returns (via promise):

```ts
{
	voiceList: SynthesisVoice[]
	bestMatchingVoice: SynthesisVoice
}
```

## Recognition

### `recognize(input, options)`

Applies speech recognition to the input.

* `input`: Can be an audio file path (`string`), encoded audio (`Buffer` or `Uint8array`) or a raw audio object (`RawAudio`)
* `options`: Recognition options object

#### Returns (via promise):

```ts
{
	transcript: string
	timeline: Timeline
	wordTimeline: Timeline
	language: string
}
```

## Alignment

### `align(input, transcript, options)`

Aligns input audio with the given transcript.

* `input`: Can be an audio file path (`string`), encoded audio (`Buffer` or `Uint8array`) or a raw audio object (`RawAudio`)
* `options`: Alignment options object

#### Returns (via promise):

```ts
{
	timeline: Timeline
	wordTimeline: Timeline
	transcript: string
	language: string
}
```

## Speech-to-text translation

### `translateSpeech(input, options)`

Translates speech audio directly to English text.

* `input`: Can be an audio file path (`string`), encoded audio (`Buffer` or `Uint8array`) or a raw audio object (`RawAudio`)
* `options`: Speech translation options object

#### Returns (via promise):
```ts
{
	transcript: string
	timeline: Timeline
	wordTimeline: Timeline
	sourceLanguage: string
	targetLanguage: string
}
```

## Language detection

### `detectSpeechLanguage(input, options)`

Detects language of spoken audio.

* `input`: Can be an audio file path (`string`), encoded audio (`Buffer` or `Uint8array`) or a raw audio object (`RawAudio`)
* `options`: Speech language detection options object

#### Returns (via promise):
```ts
{
	detectedLanguage: string
	detectedLanguageName: string
	detectedLanguageProbabilities: LanguageDetectionResults
}
```

### `detectTextLanguage(input, options)`

Detects language of text.

* `input`: Input text as `string`
* `options`: Text language detection options object

#### Returns (via promise):
```ts
{
	detectedLanguage: string
	detectedLanguageName: string
	detectedLanguageProbabilities: LanguageDetectionResults
}
```

## Voice activity detection

### `detectVoiceActivity(input, options)`

Detects voice activity in audio (non real-time).

* `input`: Can be an audio file path (`string`), encoded audio (`Buffer` or `Uint8array`) or a raw audio object (`RawAudio`)
* `options`: Voice activity detection options object

#### Returns (via promise):
```ts
{
	timeline: Timeline
}
```

## Speech denoising

### `denoise(input, options)`

Tries to reduce background noise in spoken audio.

* `input`: Can be an audio file path (`string`), encoded audio (`Buffer` or `Uint8array`) or a raw audio object (`RawAudio`)
* `options`: Denoising options object

#### Returns (via promise):
```ts
{
	denoisedAudio: RawAudio
}
```

## Source separation

### `isolate(input, options)`

Attempts to isolate an individual [audio stem](https://en.wikipedia.org/wiki/Stem_(audio)), like human voice, or one or more musical instruments (depending on model training), from the given waveform.

* `input`: Can be an audio file path (`string`), encoded audio (`Buffer` or `Uint8array`) or a raw audio object (`RawAudio`)
* `options`: Source separation options object

#### Returns (via promise):
```ts
{
	inputRawAudio: RawAudio
	isolatedRawAudio: RawAudio
	backgroundRawAudio: RawAudio
}
```

## Subtitles

### `timelineToSubtitles(timeline, options)`

Converts a timeline to subtitles.

* `timeline`: Timeline object
* `options`: Subtitles configuration object

#### Returns:

Subtitle file content, as a string.

### `subtitlesToTimeline(subtitles)`

Converts subtitles to a timeline.

* `subtitles`: Timeline object

**Note**: This function simply converts each individual cue to a segment entry in a timeline. Since subtitle cues may contain parts of sentences or phrases, this may not produce very useful results for your needs. However, you can use it as a means to parse a subtitle file (`srt` or `vtt`), and apply your own processing later.

#### Returns:

Timeline object.

## Global options

### `setGlobalOption(key, value)`

Set a global option.

Supported keys:

* `'ffmpegPath'`: override FFMpeg executable path
* `'soxPath'`: override SoX executable path

### `getGlobalOption(key)`

Get a global option.

Supported keys:

* `'ffmpegPath'`: get FFMpeg executable path
* `'soxPath'`: get SoX executable path

#### Returns:

The value associated with the given key.

## TODO

* Expose more methods that may be useful for developers, like phonemization, etc.
* Expose audio playback used in CLI, possibly with timeline synchronization support.
