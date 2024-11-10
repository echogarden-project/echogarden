# Options reference

Here's a detailed reference for all the options accepted by the Echogarden CLI and API.

**Related pages**:
* [List of all supported engines](Engines.md)
* [Quick guide to the command line interface](CLI.md)
* [Node.js API reference](API.md)

## Text-to-speech

Applies to CLI operations: `speak`, `speak-file`, `speak-url`, `speak-wikipedia`, API method: `synthesize`

**General**:
* `engine`: identifier of the synthesis engine to use, such as `espeak`, `vits` or `google-translate` (see [the full engine list](Engines.md)). Auto-selected if not set
* `language`: language code ([ISO 639-1](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes)), like `en`, `fr`, `en-US`, `pt-BR`. Auto-detected if not set
* `voice`: name of the voice to use. Can be a search string. Auto-selected if not set
* `voiceGender`: gender of the voice to use. Optional
* `speed`: speech rate factor, relative to default. In the range `0.1`..`10.0`. Defaults to `1.0`
* `pitch`: pitch factor, relative to default. In the range `0.1`..`10.0`. Defaults to `1.0`
* `pitchVariation`: pitch variation factor. In the range `0.1`..`10.0`. Defaults to `1.0`
* `splitToSentences`: split text to sentences before synthesis. Defaults to `true`
* `ssml`: the input is SSML. Defaults to `false`
* `sentenceEndPause`: pause duration (seconds) at end of sentence. Defaults to `0.75`
* `segmentEndPause`: pause duration (seconds) at end of segment. Defaults to `1.0`
* `customLexiconPaths`: a list of custom lexicon file paths. Optional
* `alignment`: prefix to provide options for alignment. Options detailed in section for alignment
* `subtitles`: prefix to provide options for subtitles. Options detailed in section for subtitles
* `languageDetection`: prefix to provide options for text language detection. Options detailed in section for text language detection

**Plain text processing**:
* `plainText.paragraphBreaks`: split to paragraphs based on single (`single`), or double (`double`) line breaks. Defaults to `double`
* `plainText.whitespace`: determines how to process whitespace within paragraphs. Can be `preserve` (leave as is), `removeLineBreaks` (convert line breaks to spaces) or `collapse` (convert runs of whitespace characters, including line breaks, to a single space character). Defaults to `collapse`

**Post-processing**:
* `postProcessing.normalizeAudio`: should normalize output audio. Defaults to `true`
* `postProcessing.targetPeak`: target peak (decibels) for normalization. Defaults to `-3`
* `postProcessing.maxGainIncrease`: max gain increase (decibels) when performing normalization. Defaults to `30`
* `postProcessing.speed`: target speed for time stretching. Defaults to `1.0`
* `postProcessing.pitch`: target pitch for pitch shifting. Defaults to `1.0`
* `postProcessing.timePitchShiftingMethod`: method for time and pitch shifting. Can be `sonic` or `rubberband`. Defaults to `sonic`
* `postProcessing.rubberband`: prefix for RubberBand options (TODO: document options)

**Output audio format**:
* `outputAudioFormat.codec`: Codec identifier (**Note**: API only. CLI uses file extensions instead), can be `wav`, `mp3`, `opus`, `m4a`, `ogg`, `flac`. Leaving as `undefined` would return a raw audio structure (see more information at the [API documentation](API.md]). Optional
* `outputAudioFormat.bitrate`: Custom bitrate for encoding, applies only to  `mp3`, `opus`, `m4a`, `ogg`. By default, bitrates are selected between 48Kbps and 64Kbps, to provide a good speech quality while minimizing file size. Optional

**VITS**:
* `vits.speakerId`: speaker ID, for VITS models that support multiple speakers. Defaults to `0`
* `vits.provider`: ONNX execution provider to use. Can be `cpu`, `dml` ([DirectML](https://microsoft.github.io/DirectML/)-based GPU acceleration - Windows only), or `cuda` (Linux only - requires [CUDA Toolkit 12.x](https://developer.nvidia.com/cuda-downloads) and [cuDNN 9.x](https://developer.nvidia.com/cudnn-downloads) to be installed). Using GPU acceleration for VITS may or may not be faster than CPU, depending on your hardware. Defaults to `cpu`

**eSpeak**:
* `espeak.rate`: speech rate, in eSpeak units. Overrides `speed` when set
* `espeak.pitch`: pitch, in eSpeak units. Overrides `pitch` when set
* `espeak.pitchRange`: pitch range, in eSpeak units. Overrides `pitchVariation` when set
* `espeak.useKlatt`: use the Klatt synthesis method. Defaults to `false`

**SAM**:
* `sam.pitch`: pitch value, between `0`..`255`. Overrides `pitch` when set
* `sam.speed`: speed value, between `0`..`255`. Overrides `speed` when set
* `sam.mouth`: mouth value, between `0`..`255` (defaults to `128`)
* `sam.throat`: throat value, between `0`..`255` (defaults to `128`)

**SAPI**:
* `sapi.rate`: SAPI speech rate, in its native units. An integer number between `-10` and `10`. Setting `speed` would apply time stretching instead. The two options can be used together

**Microsoft Speech Platform**:
* `msspeech.rate`: same units and effects as the SAPI speech rate

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
* `amazonPolly.lexiconNames`: an array of lexicon names. Optional

**OpenAI Cloud**:
* `openAICloud.apiKey`: API key (required)
* `openAICloud.organization`: organization identifier. Optional
* `openAICloud.baseURL`: override the default base URL for the API. Optional
* `openAICloud.model`: model to use. Can be either `tts-1` or `tts-1-hd`. Defaults to `tts-1`
* `openAICloud.timeout`: request timeout. Optional
* `openAICloud.maxRetries`: maximum retries on failure. Defaults to 10

**Elevenlabs**:
* `elevenLabs.apiKey`: API key (required)
* `elevenLabs.stability`: stability. Defaults to `0.5`
* `elevenLabs.similarityBoost`: similarity boost. Defaults to `0.5`

**Google Translate**:
* `googleTranslate.tld`: top level domain to connect to. Can change the dialect for a small number of voices. For example `us` gives American English for `en`, while `com` gives British English for `en`. Defaults to `us`

**Microsoft Edge**:
* `microsoftEdge.trustedClientToken`: trusted client token (required). A special token required to use the service
* `microsoftEdge.pitchDeltaHz`: pitch delta in Hz. Overrides `pitch` when set

### Voice list request

Applies to CLI operation: `list-voices`, API method: `requestVoiceList`

**General**:
* `language`: language code to filter by (optional)
* `voice`: name or name pattern to filter by (optional)
* `voiceGender`: gender to filter by (optional)

Also accepted are the following engine-specific options that may be required in order to retrieve the voice list:
* `googleCloud.apiKey`
* `microsoftAzure.subscriptionKey`, `microsoftAzure.serviceRegion`
* `amazonPolly.region`, `amazonPolly.accessKeyId`, `amazonPolly.secretAccessKey`
* `elevenLabs.apiKey`
* `microsoftEdge.trustedClientToken`

## Speech-to-text

Applies to CLI operation: `transcribe`, API method: `recognize`

**General**:
* `engine`: identifier of the recognition engine to use, such as `whisper` or `vosk` (see [the full engine list](Engines.md))
* `language`: language code ([ISO 639-1](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes)) for the audio, like `en`, `fr`, `de`. Auto-detected if not set
* `crop`: crop to active parts using voice activity detection before starting recognition. Defaults to `true`
* `isolate`: apply source separation to isolate voice before starting recognition. Defaults to `false`
* `alignment`: prefix to provide options for alignment. Options detailed in section for alignment
* `languageDetection`: prefix to provide options for language detection. Options detailed in section for speech language detection
* `subtitles`: prefix to provide options for subtitles. Options detailed in section for subtitles
* `vad`: prefix to provide options for voice activity detection when `crop` is set to `true`. Options detailed in section for voice activity detection
* `sourceSeparation`: prefix to provide options for source separation when `isolate` is set to `true`. Options detailed in section for source separation

**Whisper**:
* `whisper.model`: selects which Whisper model to use. Can be `tiny`, `tiny.en`, `base`, `base.en`, `small`, `small.en`, `medium`, `medium.en` or `large-v3-turbo`. Defaults to `tiny` or `tiny.en`
* `whisper.temperature`: temperature setting for the text decoder. Impacts the amount of randomization for token selection. It is recommended to leave at `0.1` (close to no randomization - almost always chooses the top ranked token) or choose a relatively low value (`0.25` or lower) for best results. Defaults to `0.1`
* `whisper.prompt`: initial text to give the Whisper model. Can be a vocabulary, or example text of some sort. Note that if the prompt is very similar to the transcript, the model may intentionally avoid producing the transcript tokens as it may assume that they have already been transcribed. Optional
* `whisper.topCandidateCount`: the number of top candidate tokens to consider. Defaults to `5`
* `whisper.punctuationThreshold`: the minimal probability for a punctuation token, included in the top candidates, to be chosen unconditionally. A lower threshold encourages the model to output more punctuation characters. Defaults to `0.2`
* `whisper.autoPromptParts`: use previous part's recognized text as the prompt for the next part. Disabling this may help to prevent repetition carrying over between parts, in some cases. Defaults to `true` (**Note**: currently always disabled for `large-v3-turbo` model due to an apparent issue with corrupt output when prompted)
* `whisper.maxTokensPerPart`: maximum number of tokens to decode for each audio part. Defaults to `250`
* `whisper.suppressRepetition`: attempt to suppress decoding of repeating token patterns. Defaults to `true`
* `whisper.repetitionThreshold`: minimal repetition / compressibility score to cause a part not to be auto-prompted to the next part. Defaults to `2.4`
* `whisper.decodeTimestampTokens`: enable/disable decoding of timestamp tokens. Setting to `false` can reduce the occurrence of hallucinations and token repetition loops, possibly due to the overall reduction in the number of tokens decoded. This has no impact on the accuracy of timestamps, since they are derived independently using cross-attention weights. However, there are cases where this can cause the model to end a part prematurely, especially in singing and less speech-like voice segments, or when there are multiple speakers. Defaults to `true`
* `whisper.timestampAccuracy`: timestamp accuracy. can be `medium` or `high`. `medium` uses a reduced subset of attention heads for alignment, `high` uses all attention heads and is thus more accurate at the word level, but slower for larger models. Defaults to `high` for the `tiny` and `base` models, and `medium` for the larger models
* `whisper.encoderProvider`: identifier for the ONNX execution provider to use with the encoder model. Can be `cpu`, `dml` ([DirectML](https://microsoft.github.io/DirectML/)-based GPU acceleration - Windows only), or `cuda` (Linux only - requires [CUDA Toolkit 12.x](https://developer.nvidia.com/cuda-downloads) and [cuDNN 9.x](https://developer.nvidia.com/cudnn-downloads) to be installed). In general, GPU-based encoding should be significantly faster. Defaults to `cpu`, or `dml` if available
* `whisper.decoderProvider`: identifier for the ONNX execution provider to use with the decoder model. Can be `cpu`, `dml` ([DirectML](https://microsoft.github.io/DirectML/)-based GPU acceleration - Windows only), or `cuda` (Linux only - requires [CUDA Toolkit 12.x](https://developer.nvidia.com/cuda-downloads) and [cuDNN 9.x](https://developer.nvidia.com/cudnn-downloads) to be installed). Using GPU acceleration for the decoder may be faster than CPU, especially for larger models, but that depends on your particular combination of CPU and GPU. Defaults to `cpu`, and on Windows, `dml` if available for larger models (`small`, `medium`, `large`)
* `whisper.seed`: provide a custom random seed for token selection when temperature is greater than 0. Uses a constant seed by default to ensure reproducibility

**Whisper.cpp**:
* `whisperCpp.model`: selects which `whisper.cpp` model to use.  Can be `tiny`, `tiny.en`, `base`, `base.en`, `small`, `small.en`, `medium`, `medium.en`, `large` (same as `large-v2`), `large-v1`, `large-v2`, `large-v3`, `large-v3-turbo`. The following quantized models are also supported: `tiny-q5_1`, `tiny.en-q5_1`, `tiny.en-q8_0`,`base-q5_1`, `base.en-q5_1`, `small-q5_1`, `small.en-q5_1`, `medium-q5_0`, `medium.en-q5_0`, `large-v2-q5_0`, `large-v3-q5_0`, `large-v3-turbo-q5_0`. Defaults to `base` or `base.en`
* `whisperCpp.executablePath`: a path to a custom `whisper.cpp` `main` executable (currently required for macOS)
* `whisperCpp.build`: type of `whisper.cpp` build to use. Can be set to `cpu`, `cublas-12.4.0` or `custom`. By default, builds are auto-selected and downloaded for Windows x64 (`cpu`, `cublas-12.4.0`) and Linux x64 (`cpu`). Using other builds requires providing a custom `executablePath`, which will automatically set this option to `custom`
* `whisperCpp.threadCount`: number of threads to use, defaults to `4`
* `whisperCpp.splitCount`: number of splits of the audio data to process in parallel (called `--processors` in the `whisper.cpp` CLI). A value greater than `1` can increase memory use significantly, reduce timing accuracy, and slow down execution in some cases. Defaults to `1` (highly recommended)
* `whisperCpp.enableGPU`: enable GPU processing. Setting to `true` will try to use a CUDA build, if available for your system. Defaults to `true` when a CUDA-enabled build is selected via `whisperCpp.build`, otherwise `false`. If a custom build is used, it will enable or disable GPU for that build
* `whisperCpp.topCandidateCount`: the number of top candidate tokens to consider. Defaults to `5`
* `whisperCpp.beamCount`: the number of decoding paths to use during beam search. Defaults to `5`
* `whisperCpp.temperature`: set temperature. Defaults to `0.0`
* `whisperCpp.temperatureIncrement`: set temperature increment. Defaults to `0.2`
* `whisperCpp.repetitionThreshold`: minimal repetition / compressibility score to cause a decoded segment to be discarded. Defaults to `2.4`
* `whisperCpp.prompt`: initial text to give the Whisper model. Can be a vocabulary, or example text of some sort. Note that if the prompt is very similar to the transcript, the model may intentionally avoid producing the transcript tokens as it may assume that they have already been transcribed. Optional
* `whisperCpp.enableDTW`: enable `whisper.cpp`'s own experimental DTW-based token alignment to be used to derive timestamps. Defaults to `false`
* `whisperCpp.enableFlashAttention`: enable flash attention. Can significantly increase performance for some configurations (**Note**: setting this to `true` will cause `enableDTW` to always be set to `false` since it's not compatible with flash attention). Defaults to `false`
* `whisperCpp.verbose`: show all CLI messages during execution. Defaults to `false`

**Vosk**:
* `vosk.modelPath`: path to the Vosk model to be used

**Silero**:
* `silero.modelPath`: path to a Silero model. Note that latest `en`, `de`, `fr` and `uk` models are automatically installed when needed based on the selected language. This should only be used to manually specify a different model, otherwise specify `language` instead
* `silero.provider`: ONNX execution provider to use. Can be `cpu`, `dml` ([DirectML](https://microsoft.github.io/DirectML/)-based GPU acceleration - Windows only), or `cuda` (Linux only - requires [CUDA Toolkit 12.x](https://developer.nvidia.com/cuda-downloads) and [cuDNN 9.x](https://developer.nvidia.com/cudnn-downloads) to be installed). Defaults to `cpu`, or `dml` if available

**Google Cloud**:
* `googleCloud.apiKey`: Google Cloud API key (required)
* `googleCloud.alternativeLanguageCodes`: An array of alternative language codes. Optional
* `googleCloud.profanityFilter`: censor profanity. Defaults to `false`
* `googleCloud.autoPunctuation`: add punctuation automatically. Defaults to `true`
* `googleCloud.useEnhancedModel`: use enhanced model. Defaults to `true`

**Azure Cognitive Services**:
* `microsoftAzure.subscriptionKey`: subscription key (required)
* `microsoftAzure.serviceRegion`: service region (required)

**Amazon Transcribe**:
* `amazonTranscribe.region`: region (required)
* `amazonTranscribe.accessKeyId`: access key ID (required)
* `amazonTranscribe.secretAccessKey`: secret access key (required)

**OpenAI Cloud**:
* `openAICloud.apiKey`: API key (required)
* `openAICloud.model`: model to use. When using the default provider (OpenAI), can only be `whisper-1`. For a custom provider, like Groq, see its documentation
* `openAICloud.organization`: organization identifier. Optional
* `openAICloud.baseURL`: override the default endpoint used by the API. For example, set `https://api.groq.com/openai/v1` to use Groq's OpenAI-compatible API instead of the default one. Optional
* `openAICloud.temperature`: temperature. Choosing `0` uses a dynamic temperature approach. Defaults to `0`
* `openAICloud.prompt`: initial prompt for the model. Optional
* `openAICloud.timeout`: request timeout. Optional
* `openAICloud.maxRetries`: maximum retries on failure. Defaults to 10
* `openAICloud.requestWordTimestamps`: request word timestamps from the server. Defaults to `true` for the default OpenAI endpoint, and `false` if a custom one is set using `baseURL`

## Speech-to-transcript alignment

Applies to CLI operation: `align`, API method: `align`

**General**:
* `engine`: alignment algorithm to use, can be `dtw`, `dtw-ra` or `whisper`. Defaults to `dtw`
* `language`: language code for the audio and transcript ([ISO 639-1](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes)), like `en`, `fr`, `en-US`, `pt-BR`. Auto-detected from transcript if not set
* `crop`: crop to active parts using voice activity detection before starting. Defaults to `true`
* `isolate`: apply source separation to isolate voice before starting alignment. Defaults to `false`
* `customLexiconPaths`: an array of custom lexicon file paths. Optional
* `subtitles`: prefix to provide options for subtitles. Options detailed in section for subtitles
* `vad`: prefix to provide options for voice activity detection when `crop` is set to `true`. Options detailed in section for voice activity detection
* `sourceSeparation`: prefix to provide options for source separation when `isolate` is set to `true`. Options detailed in section for source separation

**Plain text processing**:
* `plainText.paragraphBreaks`: split transcript to paragraphs based on single (`single`), or double (`double`) line breaks. Defaults to `double`
* `plainText.whitespace`: determines how to process whitespace within transcript paragraphs. Can be `preserve` (leave as is), `removeLineBreaks` (convert line breaks to spaces) or `collapse` (convert runs of whitespace characters, including line breaks, to a single space character). Defaults to `collapse`

**DTW**:
* `dtw.granularity`: adjusts the MFCC frame width and hop size based on the profile selected. Can be set to either `xx-low` (400ms width, 160ms hop), `x-low` (200ms width, 80ms hop), `low` (100ms width, 40ms hop), `medium` (50ms width, 20ms hop), `high` (25ms width, 10ms hop), `x-high` (20ms width, 5ms hop). For multi-pass processing, multiple granularities can be provided, like `dtw.granularity=['xx-low','medium']`. Auto-selected by default.
* `dtw.windowDuration`: sets the maximum duration of the Sakoe-Chiba window when performing DTW alignment. The value can be specified in seconds, like `240`, or as  an integer percentage (formatted like `15%`), relative to the total duration of the source audio. The estimated memory requirement is shown in the log before alignment starts. Recommended to be set to at least 10% - 20% of total audio duration. For multi-pass processing, multiple durations can be provided (which can mix absolute and relative values), like `dtw.windowDuration=['15%',20]`. Auto-selected by default

**DTW-RA**:
* `recognition`: prefix to provide recognition options when using `dtw-ra` method, for example: setting `recognition.engine = whisper` and `recognition.whisper.model = base.en`
* `dtw.phoneAlignmentMethod`: algorithm to use when aligning phones: can either be set to `dtw` or `interpolation`. Defaults to `dtw`

**Whisper**:

Applies to the `whisper` engine only. To provide Whisper options for `dtw-ra`, use `recognition.whisper` instead.

* `whisper.model`: Whisper model to use. Defaults to `tiny` or `tiny.en`
* `whisper.endTokenThreshold`: minimal probability to accept an end token for a recognized part. The probability is measured via the softmax between the end token's logit and the second highest logit. You can try to adjust this threshold in cases the model is ending a part with too few, or many tokens decoded. Defaults to `0.9`. On the last audio part, it is always effectively set to `Infinity`, to ensure the remaining transcript tokens are decoded in full
* `whisper.maxTokensPerPart`: maximum number of tokens to decode per part. Should help avoid edge cases where the model never reaches an end token for the part, which otherwise may cause the model to decode too many tokens and eventually crash. Defaults to 250
* `whisper.timestampAccuracy`: timestamp accuracy. can be `medium` or `high`. `medium` uses a reduced subset of attention heads for alignment, `high` uses all attention heads and is thus more accurate at the word level, but slower for larger models. Defaults to `high` for the `tiny` and `base` models, and `medium` for the larger models
* `whisper.encoderProvider`: encoder ONNX provider. See details in recognition section above
* `whisper.decoderProvider`: decoder ONNX provider. See details in recognition section above

## Speech-to-text translation

Applies to CLI operation: `translate-speech`, API method: `translateSpeech`

**General**:
* `engine`: only `whisper` supported
* `sourceLanguage`: the source language code for the input speech. Auto-detected if not set
* `targetLanguage`: the target language code for the output speech. Only `en` (English) supported by the `whisper` engine. Optional
* `crop`: crop to active parts using voice activity detection before starting. Defaults to `true`
* `isolate`: apply source separation to isolate voice before starting speech translation. Defaults to `false`
* `languageDetection`: prefix to provide options for language detection. Options detailed in section for speech language detection
* `vad`: prefix to provide options for voice activity detection when `crop` is set to `true`. Options detailed in section for voice activity detection
* `sourceSeparation`: prefix to provide source separation options when `isolate` is to `true`

**Whisper**:

* `whisper`: prefix to provide options for the Whisper model. Same options as detailed in the recognition section above

**Whisper.cpp**:

* `whisper.cpp`: prefix to provide options for the Whisper.cpp model. Same options as detailed in the recognition section above

**OpenAI Cloud**:

* `openAICloud`: prefix to provide options for OpenAI cloud. Same options as detailed in the recognition section above

## Text-to-text translation

Applies to CLI operation: `translate-text`, API method: `translateText`

**General**:
* `engine`: only `google-translate` supported
* `sourceLanguage`: the source language code for the input text. Auto-detected if not set
* `targetLanguage`: the target language code for the output text. Required
* `languageDetection`: language detection options. Optional
* `plainText`: plain text processing options. Optional

**Google Translate**:
* `googleTranslate.tld`: top-level domain to request from. Defaults to `com`
* `googleTranslate.maxCharactersPerPart`: maximum number of characters in each part requested from the server. Defaults to 2000

## Speech-to-translated-transcript alignment

Applies to CLI operation: `align-translation`, API method: `alignTranslation`

**General**:
* `engine`: alignment algorithm to use, can only be `whisper`. Defaults to `whisper`
* `sourceLanguage`: language code for the source audio ([ISO 639-1](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes)), like `en`, `fr`, `zh`, etc. Auto-detected from audio if not set
* `targetLanguage`: language code for the translated transcript. Can only be `en` for now. Defaults to `en`
* `crop`: crop to active parts using voice activity detection before starting. Defaults to `true`
* `isolate`: apply source separation to isolate voice before starting alignment. Defaults to `false`
* `subtitles`: prefix to provide options for subtitles. Options detailed in section for subtitles
* `vad`: prefix to provide options for voice activity detection when `crop` is set to `true`. Options detailed in section for voice activity detection
* `sourceSeparation`: prefix to provide options for source separation when `isolate` is set to `true`. Options detailed in section for source separation

**Whisper**:
* `whisper.model`: Whisper model to use. Only multilingual models can be used. Defaults to `tiny`
* `whisper.endTokenThreshold`: see details in the alignment section above
* `whisper.encoderProvider`: encoder ONNX execution provider. See details in recognition section above
* `whisper.decoderProvider`: decoder ONNX execution provider. See details in recognition section above

## Speech-to-transcript-and-translation alignment

Applies to CLI operation: `align-transcript-and-translation`, API method: `alignTranscriptAndTranslation`

**General**:
* `engine`: can only be `two-stage`. Defaults to `two-stage`
* `sourceLanguage`: language code for the source audio ([ISO 639-1](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes)), like `en`, `fr`, `zh`, etc. Auto-detected from audio if not set
* `targetLanguage`: language code for the translated transcript. Can only be `en` for now. Defaults to `en`
* `crop`: crop to active parts using voice activity detection before starting. Defaults to `true`
* `isolate`: apply source separation to isolate voice before starting alignment. Defaults to `false`
* `alignment`: prefix to provide options for alignment. Options detailed in section for alignment
* `timelineAlignment`: prefix to provide options for timeline alignment. Options detailed in section for timeline alignment
* `vad`: prefix to provide options for voice activity detection when `crop` is set to `true`. Options detailed in section for voice activity detection
* `sourceSeparation`: prefix to provide options for source separation when `isolate` is set to `true`. Options detailed in section for source separation
* `subtitles`: prefix to provide options for subtitles. Options detailed in section for subtitles

## Timeline-to-translated-text alignment

Applies to CLI operation: `align-timeline-translation`, API method: `alignTimelineTranslation`

**General**:
* `engine`: alignment engine to use. Can only be `e5`. Defaults to `e5`
* `sourceLanguage`: language code for the source timeline. Auto-detected from timeline if not set
* `targetLanguage`: language code for the translated transcript. Auto-detected if not set
* `audio`: spoken audio to play when previewing the result in the CLI (not required or used by the alignment itself). Optional
* `languageDetection`: prefix to provide options for language detection. Options detailed in section for text language detection
* `subtitles`: prefix to provide options for subtitles. Options detailed in section for subtitles

**E5**:
* `e5.model`: E5 model to use. Defaults to `e5-small-fp16` (support for additional models will be added in the future)

## Language detection

### Speech language detection

Applies to CLI operation: `detect-speech-langauge`, API method: `detectSpeechLangauge`

**General**:
* `engine`: `whisper` or `silero`. Defaults to `whisper`
* `defaultLanguage`: language to fallback to when confidence for top candidate of is low. Defaults to `en`
* `fallbackThresholdProbability`: confidence threshold to cause fallback. Defaults to `0.05`
* `crop`: crop to active parts using voice activity detection before starting. Defaults to `true` (recommended, otherwise inactive sections may skew the probabilities towards various random languages)
* `vad`: prefix to provide options for voice activity detection when `crop` is set to `true`. Options detailed in section for voice activity detection

**Whisper**:
* `whisper.model`: Whisper model to use. See model list in the recognition section
* `whisper.temperature`: impacts the distribution of candidate languages when applying the softmax function to compute language probabilities over the model output. Higher temperature causes the distribution to be more uniform, while lower temperature causes it to be more strongly weighted towards the best scoring candidates. Defaults to `1.0`
* `whisper.encoderProvider`: encoder ONNX execution provider. See details in recognition section above
* `whisper.decoderProvider`: decoder ONNX execution provider. See details in recognition section above

**Silero**:
* `silero.provider`: ONNX execution provider to use. Can be `cpu`, `dml` ([DirectML](https://microsoft.github.io/DirectML/)-based GPU acceleration - Windows only), or `cuda` (Linux only - requires [CUDA Toolkit 12.x](https://developer.nvidia.com/cuda-downloads) and [cuDNN 9.x](https://developer.nvidia.com/cudnn-downloads) to be installed). Using GPU may be faster, but the initialization overhead is larger. **Note**: `dml` provider seems to be unstable at the moment for this model. Defaults to `cpu`

### Text language detection

Applies to CLI operation: `detect-text-langauge`, API method: `detectTextLangauge`

**General**:
* `engine`: `tinyld` or `fasttext`. Defaults to `tinyld`
* `defaultLanguage`: language to fallback to when confidence for top candidate is low. Defaults to `en`
* `fallbackThresholdProbability`: confidence threshold to cause fallback. Defaults to `0.05`

## Voice activity detection

Applies to CLI operation: `detect-voice-activity`, API method: `detectVoiceActivity`

**General**:
* `engine`: VAD engine to use. Can be `webrtc`, `silero`, `rnnoise`, or `adaptive-gate`. Defaults to `silero`
* `activityThreshold`: minimum predicted probability for determining a frame as having speech activity. Defaults to `0.5`

**WebRTC**:
* `webrtc.frameDuration`: WebRTC frame duration (ms). Can be `10`, `20` or `30`. Defaults to `30`
* `webrtc.mode`: WebRTC mode (aggressiveness). Can be `0`, `1`, `2` or `3`. Defaults to `1`

**Silero**:
* `silero.frameDuration`: Silero frame duration (ms). Can be `30`, `60` or `90`. Defaults to `90`
* `silero.provider`: ONNX provider to use. Can be `cpu`, `dml` ([DirectML](https://microsoft.github.io/DirectML/)-based GPU acceleration - Windows only), or `cuda` (Linux only - requires [CUDA Toolkit 12.x](https://developer.nvidia.com/cuda-downloads) and [cuDNN 9.x](https://developer.nvidia.com/cudnn-downloads) to be installed). Using GPU is likely to be slower than CPU due to inference being independently executed on each audio frame. Defaults to `cpu` (recommended)

## Speech denoising

Applies to CLI operation: `denoise`, API method: `denoise`

**General**:
* `engine`: `rnnoise` or `nsnet2`. Defaults to `rnnoise`

**Post-processing**:
* `postProcessing.normalizeAudio`: should normalize output audio. Defaults to `false`
* `postProcessing.targetPeak`: target peak (decibels) for normalization. Defaults to `-3`
* `postProcessing.maxGainIncrease`: max gain increase (decibels) when performing normalization. Defaults to `30`
* `postProcessing.dryMixGain`: gain (decibels) of dry (original) signal to mix back to the denoised (wet) signal. Defaults to `-100`

**NSNet2**:
* `nsnet2.model`: can be `baseline-16khz` or `baseline-48khz`. Defaults to `baseline-48khz`
* `nsnet2.provider`: ONNX execution provider (**Note**: `dml` provider seems to fail with these models). Defaults to `cpu`
* `maxAttenuation`: maximum amount of attenuation, in decibels, applied to an FFT bin when filtering the audio frames. Defaults to `30`

## Source separation

Applies to CLI operation: `isolate`, API method: `isolate`

**General**:

* `engine`: can only be `mdx-net`

**MDX-NET**:

* `mdxNet.model`: model to use. Currently available models are `UVR_MDXNET_1_9703`, `UVR_MDXNET_2_9682`, `UVR_MDXNET_3_9662`, `UVR_MDXNET_KARA`, and higher quality models `UVR_MDXNET_Main` and `Kim_Vocal_2`. Defaults to `UVR_MDXNET_1_9703`
* `mdxNet.provider`: ONNX execution provider to use. Can be `cpu`, `dml` ([DirectML](https://microsoft.github.io/DirectML/)-based GPU acceleration - Windows only), or `cuda` (Linux only - requires [CUDA Toolkit 12.x](https://developer.nvidia.com/cuda-downloads) and [cuDNN 9.x](https://developer.nvidia.com/cudnn-downloads) to be installed). Defaults to `dml` if available (Windows) or `cpu` (other platforms)

# Common options

## Subtitles

These are shared between text-to-speech, speech-to-text and alignment operations, usually prefixed with `subtitles.`.

* `mode`: subtitle generation mode. Can be `segment` (ensures each segment starts at a new cue), `sentence` (ensures each sentence starts at a new cue), `word` (one word per cue, no punctuation included), `phone` (one phone per cue), `word+phone` (include both `word` and `phone` cues, with overlapping time ranges), `line` (each text line is made a separate cue). Defaults to `sentence`
* `maxLineCount`: maximum number of lines per cue. Defaults to `2`
* `maxLineWidth`: maximum characters in a line. Defaults to `42`
* `minWordsInLine`: minimum number of remaining words to break to a new line. Defaults to `4`
* `separatePhrases`: try to separate phrases or sentences in new lines or cues, if possible. Defaults to `true`
* `maxAddedDuration`: maximum extra time (in seconds) that may be added after a cue's end time. This gives the reader additional time to read the cue, and also ensures that very short duration cues aren't shown in a flash. Defaults to `3.0`

**Note**: options `maxLineCount`, `maxLineWidth`, `minWordsInLine`, `separatePhrases`, are only effective when using the `segment` and `sentence` modes, and are ignored in all other modes. `maxAddedDuration` doesn't apply to modes `word`, `phone` and `word+phone` (they always use the exact start and end timestamps).

## Global options

On the CLI, global options can be used with any operation. To set global options via the API, use the `setGlobalOption(key, value)` method (see the [API reference](API.md) for more details).

* `ffmpegPath`: sets a custom path for the FFmpeg executable
* `soxPath`: sets a custom path for the SoX executable
* `packageBaseURL`: sets a custom base URL for the remote package repository used to download missing packages. Default is `https://huggingface.co/echogarden/echogarden-packages/resolve/main/`. If `huggingface.co` isn't accessible in your location, you can set to use a mirror by changing `huggingface.co` to an alternative domain like `hf-mirror.com`
* `logLevel`: adjusts the quantity of log messages shown during processing. Possible values: `silent`, `output`, `error`, `warning`, `info`, `trace`. Defaults to `info`


## CLI options

These options are for the CLI only.

* `--play`, `--no-play`: enable/disable audio playback. Defaults to play if there is no output file specified
* `--player`: audio player to use. Can be `audio-io` (uses the [`audio-io` package](https://github.com/echogarden-project/audio-io) to directly output to native OS audio buffers) or `sox` (requires `sox` to be available on path on macOS, auto-downloaded on other platforms). Defaults to `audio-io`
* `--overwrite`, `--no-overwrite`: overwrite/keep existing files. Doesn't overwrite by default
* `--debug`, `--no-debug`: show/hide the full details of JavaScript errors, if they occur. Disabled by default
* `--config=...`: path to configuration file to use. Defaults to `echogarden.config` or `echogarden.config.json`, if found at the current directory

## Using a configuration file

The CLI supports loading options from a default or custom configuration file in various formats. See the [CLI Guide](CLI.md) for more details.
