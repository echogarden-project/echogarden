# Configuration options reference

For a comprehensive list of all supported engines: see [this page](Engines.md).

## Synthesis

Applicable to CLI commands: `speak`, `speak-file`, `speak-url`, `speak-wikipedia`.

General:
* `engine`: identifier of the synthesis engine to use, such as `espeak` or `vits`.
* `language`: language code, like `en`, `fr`, `en-US`, `pt-BR`. Auto-detected if not set
* `voice`: name of the voice to use. Optional
* `voiceGender`: gender of the voice to use. Optional
* `speed`: speech rate factor, relative to default. In the range `0.1`..`10.0`. Defaults to `1.0`
* `pitch`: pitch factor, relative to default. In the range `0.1`..`10.0`. Defaults to `1.0`
* `pitchVariation`: pitch variation factor. In the range `0.1`..`10.0`. Defaults to `1.0`
* `ssml`: the input is SSML. Defaults to `false`
* `sentenceEndPause`: pause duration (seconds) at end of sentence. Defaults to `0.75`
* `segmentEndPause` pause duration (seconds) at end of segment. Defaults to `1.0`

Post-processing:
* `postProcessing.normalizeAudio` should normalize output audio. Defaults to `true`
* `postProcessing.targetPeakDb` target peak (decibels) for normalization. Defaults to `-3`
* `postProcessing.maxIncreaseDb` max gain increase (decibels) when performing normalization. Defaults to `30`
* `postProcessing.speed`: target speed for time stretching. Defaults to `1.0`
* `postProcessing.pitch`: target pitch for pitch shifting. Defaults to `1.0`
* `postProcessing.timePitchShiftingMethod` method for time and pitch shifting. Can be `sonic` or `rubberband`. Defaults to `sonic`
* `postProcessing.rubberband`: prefix for RubberBand options (TODO)

VITS:
* `vits.speakerId`: speaker ID, for VITS models that support multiple speakers

eSpeak-ng:
* `espeak.rate`: speech rate, in eSpeak units. Overrides `speed` when set
* `espeak.pitch`: pitch, in eSpeak units. Overrides `pitch` when set
* `espeak.pitchRange`: pitch range, in eSpeak units. Overrides `pitchVariation` when set

SAM:
* `sam.pitch`: pitch value, between `0`..`255`, optional. Overrides `pitch` when set
* `sam.speed`: speed value, between `0`..`255`, optional. Overrides `speed` when set
* `sam.mouth`: mouth value, between `0`..`255` (defaults to `128`)
* `sam.throat`: throat value, between `0`..`255` (defaults to `128`)

SAPI:
* `sapi.rate`: SAPI speech rate, in its native units. An integer number between `-10` and `10`. Setting `speed` would apply time stretching instead. The two options can be used together

Microsoft Speech Platform:
* `msspeech.rate`: equivalent units and effect to the SAPI speech rate

Coqui Server:
* `coquiServer.serverUrl`: server URL
* `coquiServer.speakerId`: speaker ID (if applicable)

Google Cloud:
* `googleCloud.apiKey`: API key (required)
* `googleCloud.pitchDeltaSemitones`: pitch delta in semitones. Overrides `pitch` when set
* `googleCloud.customVoice.model`: name of custom voice
* `googleCloud.customVoice.reportedUsage`: reported usage of custom voice

Azure Cognitive Services:
* `microsoftAzure.subscriptionKey`: subscription key (required)
* `microsoftAzure.serviceRegion`: service region (required)
* `microsoftAzure.pitchDeltaHz`: pitch delta in Hz. Overrides `pitch` when set

Amazon Polly:
* `amazonPolly.region`: region (required)
* `amazonPolly.accessKeyId`: access key ID (required)
* `amazonPolly.secretAccessKey`: secret access key (required)
* `amazonPolly.pollyEngine`: Amazon Polly engine kind, can be `standard` or `neural`. Defaults to `neural`
* `amazonPolly.lexiconNames`: TODO

Elevenlabs:
* `elevenLabs.apiKey`: API key (required)
* `elevenLabs.stability`: stability
* `elevenLabs.similarityBoost`: similarity boost

Google Translate:
* `googleTranslate.tld`: top level domain to to connect to. Can change the dialect of the voices for a small number or voices. For example `us` gives American English for `en`, while `com` gives British English for `en`. Defaults to `us`

Microsoft Edge:
* `microsoftEdge.trustedClientToken`: trusted client token (required). A special token required to use the service
* `microsoftEdge.pitchDeltaHz`: pitch delta in Hz. Overrides `pitch` when set

## Recognition

Applicable to CLI command: `transcribe`.

General:
* `engine`: identifier of the recognition engine to use, such as `whisper` or `vosk`
* `language`: language code for the audio, like `en`, `fr`, `en-US`, `pt-BR`. Auto-detected if not set

Whisper:
* `whisper.model`: selects which Whisper model to use. Can be `tiny`, `tiny.en`, `base`, `base.en`, `small`, `small.en`, `medium`, `medium.en`, `large` (same as `large-v2`), `large-v1`, `large-v2`. Defaults to `tiny`

Vosk:
* `vosk.modelPath`: path to the Vosk model to be used

Silero:
* `silero.modelPath`: path to a Silero model. Note that latest `en`, `de`, `fr` and `uk` models are automatically installed when needed based on the selected language. This should only be used to manually specify a different model, otherwise specify `language` instead

Google Cloud:
* `googleCloud.apiKey`: Google Cloud API key (required)
* `googleCloud.alternativeLanguageCodes`: TODO
* `googleCloud.profanityFilter`: censor profanity. Defaults to `false`
* `googleCloud.autoPunctuation`: add punctuation automatically. Defaults to `true`
* `googleCloud.useEnhancedModel`: use enhanced model. Defaults to `true`

Azure Cognitive Services:
* `azureCognitiveServices.subscriptionKey`: subscription key (required)
* `azureCognitiveServices.serviceRegion`: service region (required)

Amazon Transcribe:
* `amazonTranscribe.region`: region (required)
* `amazonTranscribe.accessKeyId`: access key ID (required)
* `amazonTranscribe.secretAccessKey`: secret access key (required)

## Alignment

Applicable to CLI command: `align`.

General:
* `method`: what alignment algorithm to use, can be `dtw`, `dtw-ra` or `whisper`. Defaults to `dtw`
* `language`: language code for the audio and transcript, like `en`, `fr`, `en-US`, `pt-BR`. Auto-detected if not set

DTW:
* `dtw.windowDuration`: time duration (in seconds) of the Sakoe-Chiba window when performing DTW alignment. Defaults to `120`. If your audio is longer than two minutes, consider increasing this value for better results. Note that a higher value would consume quadratically larger amounts of memory. A value of `600` (ten minutes) would already require several Gigabytes of memory when the audio duration is 10 minutes or greater.

DTW-RA only:
* `dtw.recognition`: prefix for providing custom recognition options when using `dtw-ra` method, for example: setting `dtw.recognition.engine = silero`
* `dtw.phoneAlignmentMethod`: algorithm to use when aligning phones: can either be set to `dtw` or `interpolate`. Defaults to `dtw`

## Speech translation

Applicable to CLI command: `translate-speech`.

General:
* `engine`: only `whisper` supported

Whisper:
* `whisper.engine`: Whisper engine to use (multilingual engines only). Defaults to `tiny`

## Language detection


### Spoken language detection

Applicable to CLI command: `detect-speech-langauge`.

* `engine`: `silero` or `whisper`. Defaults to `silero`
* `whisper`: whisper options prefix, can be used like `whisper.model = base` to set options for the Whisper engine. See Whisper options on the recognition section

### Written language detection

Applicable to CLI command: `detect-text-langauge`.

* `engine`: `tinyld` or `fasttext`. Defaults to `tinyld`

## Voice activity detection

Applicable to CLI command: `detect-voice-activity`.

General:
* `engine`: VAD engine to use. Can be `webrtc`, `silero` or `rnnoise`. Defaults to `webrtc`
* `activityThreshold`: minimum predicted probability for determining a frame as having speech activity. Defaults to `0.5`

WebRTC:
* `webrtc.frameDuration`: WebRTC frame duration (ms). Can be `10`, `20` or `30`. Defaults to `30`
* `webrtc.mode`: WebRTC mode (aggressiveness). Can be `0`, `1`, `2` or `3`. Defaults to `1`

Silero:
* `silero.frameDuration`: Silero frame duration (ms). Can be `30`, `60` or `90`. Defaults to `90`

## Speech denoising

Applicable to CLI command: `denoise`.

General:
* `engine`: can only be `rnnoise`

Postprocessing:
* `postProcessing.normalizeAudio` should normalize output audio. Defaults to `false`
* `postProcessing.targetPeakDb` target peak (decibels) for normalization. Defaults to `-3`
* `postProcessing.maxIncreaseDb` max gain increase (decibels) when performing normalization. Defaults to `30`
* `postProcessing.dryMixGainDb` gain (decibels) of dry (original) signal to mix back to the denoised output. Defaults to `-20`

## Voice list request

Applicable to CLI command: `list-voices`.

* `language`: language code to filter by (optional)
* `voice`: name or name pattern to filter by (optional)
* `voiceGender`: gender to filter by (optional)
