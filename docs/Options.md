# Configuration options reference

Here is a detailed reference for the options accepted by the Echogarden API and CLI.

**Related resources**:
* [A comprehensive list of all supported engines](Engines.md)
* [A quick guide for using the command line interface](CLI.md)
* [Developer's API reference](API.md)

## Synthesis

Applicable to CLI commands: `speak`, `speak-file`, `speak-url`, `speak-wikipedia`, API method: `synthesize`

**General**:
* `engine`: identifier of the synthesis engine to use, such as `espeak` or `vits`.
* `language`: language code ([ISO 639-1](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes)), like `en`, `fr`, `en-US`, `pt-BR`. Auto-detected if not set
* `voice`: name of the voice to use. Can be a search string. Optional
* `voiceGender`: gender of the voice to use. Optional
* `speed`: speech rate factor, relative to default. In the range `0.1`..`10.0`. Defaults to `1.0`
* `pitch`: pitch factor, relative to default. In the range `0.1`..`10.0`. Defaults to `1.0`
* `pitchVariation`: pitch variation factor. In the range `0.1`..`10.0`. Defaults to `1.0`
* `splitToSentences`: split text to sentences before synthesis. Defaults to `true`
* `ssml`: the input is SSML. Defaults to `false`
* `sentenceEndPause`: pause duration (seconds) at end of sentence. Defaults to `0.75`
* `segmentEndPause`: pause duration (seconds) at end of segment. Defaults to `1.0`
* `customLexiconPaths`: an array of custom lexicon file paths. Optional
* `alignment`: prefix to provide custom options for alignment. Options detailed in section for alignment
* `languageDetection`: prefix to provide custom options for language detection. Options detailed in section for text language detection

**Plain text processing**:
* `plainText.paragraphBreaks`: split to paragraphs based on single (`single`), or double (`double`) line breaks. Defaults to `double`
* `plainText.whitespace`: determines how to process whitespace within paragraphs. Can be `preserve` (leave as is), `removeLineBreaks` (convert line breaks to spaces) or `collapse` (convert runs of whitespace characters, including line breaks, to a single space character). Defaults to `collapse`

**Post-processing**:
* `postProcessing.normalizeAudio`: should normalize output audio. Defaults to `true`
* `postProcessing.targetPeakDb`: target peak (decibels) for normalization. Defaults to `-3`
* `postProcessing.maxIncreaseDb`: max gain increase (decibels) when performing normalization. Defaults to `30`
* `postProcessing.speed`: target speed for time stretching. Defaults to `1.0`
* `postProcessing.pitch`: target pitch for pitch shifting. Defaults to `1.0`
* `postProcessing.timePitchShiftingMethod`: method for time and pitch shifting. Can be `sonic` or `rubberband`. Defaults to `sonic`
* `postProcessing.rubberband`: prefix for RubberBand options (TODO)

**Output audio format**:
* `outputAudioFormat.codec`: Codec identifier (**Note**: API only! CLI uses file extension instead), can be `wav`, `mp3`, `opus`, `m4a`, `ogg`, `flac`. Leaving as `undefined` would return a raw audio structure (see more information at the API documentation). Optional
* `outputAudioFormat.bitrate`: Custom bitrate for encoding, applies only to  `mp3`, `opus`, `m4a`, `ogg`. By default, bitrates are selected between 48Kbps and 64Kbps, to provide a good speech quality while minimizing file size.  Optional

**Subtitles**
* `subtitles.maxLineCount`: maximum number of lines per cue. Defaults to `2`
* `subtitles.maxLineWidth`: maximum characters in a line. Defaults to `42`
* `subtitles.minWordsInLine`: minimum number of words in a line, such that a line break can be added. Defaults to `4`
* `subtitles.maxAddedDuration`: maximum extra time (in seconds) that may be added after a cue's speech end time. This also ensures that very short-duration segments aren't shown in a flash. Defaults to `3`

**VITS**:
* `vits.speakerId`: speaker ID, for VITS models that support multiple speakers. Optional

**eSpeak-ng**:
* `espeak.rate`: speech rate, in eSpeak units. Overrides `speed` when set
* `espeak.pitch`: pitch, in eSpeak units. Overrides `pitch` when set
* `espeak.pitchRange`: pitch range, in eSpeak units. Overrides `pitchVariation` when set

**SAM**:
* `sam.pitch`: pitch value, between `0`..`255`. Overrides `pitch` when set
* `sam.speed`: speed value, between `0`..`255`. Overrides `speed` when set
* `sam.mouth`: mouth value, between `0`..`255` (defaults to `128`)
* `sam.throat`: throat value, between `0`..`255` (defaults to `128`)

**SAPI**:
* `sapi.rate`: SAPI speech rate, in its native units. An integer number between `-10` and `10`. Setting `speed` would apply time stretching instead. The two options can be used together

**Microsoft Speech Platform**:
* `msspeech.rate`: same  units and effects as the SAPI speech rate

**Coqui Server**:
* `coquiServer.serverUrl`: server URL
* `coquiServer.speakerId`: speaker ID (if applicable)

**Google Cloud**:
* `googleCloud.apiKey`: API key (required)
* `googleCloud.pitchDeltaSemitones`: pitch delta in semitones. Overrides `pitch` when set
* `googleCloud.customVoice.model`: name of custom voice
* `googleCloud.customVoice.reportedUsage`: reported usage of custom voice

**Azure Cognitive Services**:
* `microsoftAzure.subscriptionKey`: subscription key (required)
* `microsoftAzure.serviceRegion`: service region (required)
* `microsoftAzure.pitchDeltaHz`: pitch delta in Hz. Overrides `pitch` when set

**Amazon Polly**:
* `amazonPolly.region`: region (required)
* `amazonPolly.accessKeyId`: access key ID (required)
* `amazonPolly.secretAccessKey`: secret access key (required)
* `amazonPolly.pollyEngine`: Amazon Polly engine kind, can be `standard` or `neural`. Defaults to `neural`
* `amazonPolly.lexiconNames`: An array of lexicon names. Optional

**Elevenlabs**:
* `elevenLabs.apiKey`: API key (required)
* `elevenLabs.stability`: stability. Defaults to `0.5`
* `elevenLabs.similarityBoost`: similarity boost. Defaults to `0.5`

**Google Translate**:
* `googleTranslate.tld`: top level domain to to connect to. Can change the dialect for a small number or voices. For example `us` gives American English for `en`, while `com` gives British English for `en`. Defaults to `us`

**Microsoft Edge**:
* `microsoftEdge.trustedClientToken`: trusted client token (required). A special token required to use the service
* `microsoftEdge.pitchDeltaHz`: pitch delta in Hz. Overrides `pitch` when set

## Voice list request

Applicable to CLI command: `list-voices`, API method: `requestVoiceList`

**General**
* `language`: language code to filter by (optional)
* `voice`: name or name pattern to filter by (optional)
* `voiceGender`: gender to filter by (optional)

Also accepted are engine-specific options that may be required in order to retrieve the voice list, especially for cloud engines. Examples:
* `googleCloud.apiKey`
* `microsoftAzure.subscriptionKey`, `microsoftAzure.serviceRegion`
* `amazonPolly.region`, `amazonPolly.accessKeyId`, `amazonPolly.secretAccessKey`
* `elevenLabs.apiKey`

## Recognition

Applicable to CLI command: `transcribe`, API method: `recognize`

**General**:
* `engine`: identifier of the recognition engine to use, such as `whisper` or `vosk`
* `language`: language code ([ISO 639-1](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes)) for the audio, like `en`, `fr`, `de`. Auto-detected if not set
* `alignment`: prefix to provide custom options for alignment. Options detailed in section for alignment
* `languageDetection`: prefix to provide custom options for language detection. Options detailed in section for speech language detection

**Subtitles**
* `subtitles.maxLineCount`: maximum number of lines per cue. Defaults to `2`
* `subtitles.maxLineWidth`: maximum characters in a line. Defaults to `42`
* `subtitles.minWordsInLine`: minimum number of words in a line, such that a line break to be added. Defaults to `4`
* `subtitles.maxAddedDuration`: maximum extra time (in seconds) that may be added after a cue's speech end time. This also ensures that very short-duration segments aren't shown in a flash. Defaults to `3`

**Whisper**:
* `whisper.model`: selects which Whisper model to use. Can be `tiny`, `tiny.en`, `base`, `base.en`, `small`, `small.en`, `medium`, `medium.en`, `large` (same as `large-v2`), `large-v1`, `large-v2`. Defaults to `tiny` or `tiny.en`
* `whisper.temperature`: temperature setting for the text decoder. Impacts amount of randomization for token selection. It is recommended to leave at `0.1` (close to no randomization - almost always chooses the top ranked token) or choose a relatively low value (`0.25` or lower) for best results. Defaults to `0.1`
* `whisper.prompt`: initial text to give the Whisper model. Can be a vocabulary, or example of some sort. Note that if the prompt is very similar to the transcript, the model may intentionally avoid producing the transcript tokens as it may assume that they have already been transcribed. Optional
* `whisper.topCandidateCount`: the number of top candidate tokens to consider. Defaults to `5`
* `whisper.punctuationThreshold`: the minimal probability for a punctuation token, included in the top candidates, to be chosen unconditionally. A lower threshold encourages the model to output more punctuation symbols. Defaults to `0.2`
* `whisper.autoPromptParts`: use previous part's recognized text as prompt for the next part. Disabling this may help to prevent repetition carrying over between parts, in some cases. Defaults to `true`

**Vosk**:
* `vosk.modelPath`: path to the Vosk model to be used

**Silero**:
* `silero.modelPath`: path to a Silero model. Note that latest `en`, `de`, `fr` and `uk` models are automatically installed when needed based on the selected language. This should only be used to manually specify a different model, otherwise specify `language` instead

**Google Cloud**:
* `googleCloud.apiKey`: Google Cloud API key (required)
* `googleCloud.alternativeLanguageCodes`: An array of alternative language codes. Optional
* `googleCloud.profanityFilter`: censor profanity. Defaults to `false`
* `googleCloud.autoPunctuation`: add punctuation automatically. Defaults to `true`
* `googleCloud.useEnhancedModel`: use enhanced model. Defaults to `true`

**Azure Cognitive Services**:
* `azureCognitiveServices.subscriptionKey`: subscription key (required)
* `azureCognitiveServices.serviceRegion`: service region (required)

**Amazon Transcribe**:
* `amazonTranscribe.region`: region (required)
* `amazonTranscribe.accessKeyId`: access key ID (required)
* `amazonTranscribe.secretAccessKey`: secret access key (required)

## Alignment

Applicable to CLI command: `align`, API method: `align`

**General**:
* `engine`: what alignment algorithm to use, can be `dtw`, `dtw-ra` or `whisper`. Defaults to `dtw`
* `language`: language code for the audio and transcript ([ISO 639-1](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes)), like `en`, `fr`, `en-US`, `pt-BR`. Auto-detected from transcript if not set
* `customLexiconPaths`: an array of custom lexicon file paths. Optional

**Plain text processing**:
* `plainText.paragraphBreaks`: split transcript to paragraphs based on single (`single`), or double (`double`) line breaks. Defaults to `double`
* `plainText.whitespace`: determines how to process whitespace within transcript paragraphs. Can be `preserve` (leave as is), `removeLineBreaks` (convert line breaks to spaces) or `collapse` (convert runs of whitespace characters, including line breaks, to a single space character). Defaults to `collapse`

**Subtitles**
* `subtitles.maxLineCount`: maximum number of lines per cue. Defaults to `2`
* `subtitles.maxLineWidth`: maximum characters in a line. Defaults to `42`
* `subtitles.minWordsInLine`: minimum number of leftover words required to break to a new line or cue. Defaults to `4`
* `subtitles.maxAddedDuration`: maximum extra time (in seconds) that may be added after a cue's speech end time. This also ensures that very short-duration segments aren't shown in a flash. Defaults to `3`

**DTW**:
* `dtw.granularity`: adjusts the MFCC frame width and hop size based on the profile selected. Can be set to either `auto` (auto-selected based on audio duration and task), `xx-low` (400ms width, 160ms hop), `x-low` (200ms width, 80ms hop), `low` (100ms width, 40ms hop), `medium` (50ms width, 20ms hop), `high` (25ms width, 10ms hop), `x-high` (20ms width, 5ms hop). For multi-pass processing, multiple granularities can be provided, like `dtw.granularity=['low','high']`. Defaults to `auto`.
* `dtw.windowDuration`: maximum duration (in seconds) of the Sakoe-Chiba window when performing DTW alignment. Higher values consume quadratically larger amounts of memory. The estimated memory requirement is shown in the log before alignment starts. Recommended to be set to at least 10% - 20% of total audio duration. For multi-pass processing, multiple durations can be provided, like `dtw.windowDuration=[240,20]`. Auto-selected by default

**DTW-RA only**:
* `recognition`: prefix for providing custom recognition options when using `dtw-ra` method, for example: setting `recognition.whisper.model = base.en`
* `dtw.phoneAlignmentMethod`: algorithm to use when aligning phones: can either be set to `dtw` or `interpolate`. Defaults to `dtw`

**Whisper alignment only**
* `whisper`: prefix to provide Whisper options when the `whisper` alignment engine is used.

## Speech translation

Applicable to CLI command: `translate-speech`, API method: `translateSpeech`

**General**:
* `engine`: only `whisper` supported
* `sourceLanguage`: the source language code for the input speech. Auto-detected if not set
* `targetLanguage`: the target language code for the output speech. Only `en` supported at this time
* `languageDetection`: prefix to provide custom options for language detection. Options detailed in section for speech language detection

**Whisper**:

* `whisper`: prefix for options for the Whisper model. Same options as detailed in the recognition section above

## Language detection

### Speech language detection

Applicable to CLI command: `detect-speech-langauge`, API method: `detectSpeechLangauge`

**General**:
* `engine`: `silero` or `whisper`. Defaults to `silero`
* `whisper`: whisper options prefix, can be used like `whisper.model = base` to set options for the Whisper engine. See Whisper options on the recognition section

### Text language detection

Applicable to CLI command: `detect-text-langauge`, API method: `detectTextLangauge`

**General**:
* `engine`: `tinyld` or `fasttext`. Defaults to `tinyld`
* `defaultLanguage`: language to fall back to when confidence of is low. Defaults to `en`
* `fallbackThresholdProbability`: confidence threshold to cause fallback. Defaults to `0.05`

## Voice activity detection

Applicable to CLI command: `detect-voice-activity`, API method: `detectVoiceActivity`

**General**:
* `engine`: VAD engine to use. Can be `webrtc`, `silero` or `rnnoise`. Defaults to `webrtc`
* `activityThreshold`: minimum predicted probability for determining a frame as having speech activity. Defaults to `0.5`

**WebRTC**:
* `webrtc.frameDuration`: WebRTC frame duration (ms). Can be `10`, `20` or `30`. Defaults to `30`
* `webrtc.mode`: WebRTC mode (aggressiveness). Can be `0`, `1`, `2` or `3`. Defaults to `1`

**Silero**:
* `silero.frameDuration`: Silero frame duration (ms). Can be `30`, `60` or `90`. Defaults to `90`

## Speech denoising

Applicable to CLI command: `denoise`, API method: `denoise`

**General**:
* `engine`: can only be `rnnoise`

**Postprocessing**:
* `postProcessing.normalizeAudio`: should normalize output audio. Defaults to `false`
* `postProcessing.targetPeakDb`: target peak (decibels) for normalization. Defaults to `-3`
* `postProcessing.maxIncreaseDb`: max gain increase (decibels) when performing normalization. Defaults to `30`
* `postProcessing.dryMixGainDb`: gain (decibels) of dry (original) signal to mix back to the denoised output. Defaults to `-20`
