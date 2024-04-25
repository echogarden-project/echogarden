# Release notes

## Releases after `1.0.0`

For releases after `1.0.0`, see the [GitHub releases page](https://github.com/echogarden-project/echogarden/releases).

## `1.0.0` (April 12, 2024)

**New features**:
* Add support for [`whisper.cpp`](https://github.com/ggerganov/whisper.cpp), a C++ port of OpenAI's Whisper speech recognition architecture. It is faster than the integrated `whisper` engine, supports large models, and GPU processing. It can now be used for recognition, speech translation and alignment (via `dtw-ra`), though its word timestamps are less accurate than the integrated `whisper` engine.
* Add the [MDX-NET](https://github.com/kuielab/mdx-net/) source separation model, enabling vocal tracks to be extracted from music and speech audio using the new `isolate` operation
* Add support for OpenAI cloud platform's [speech recognition and translation services](https://platform.openai.com/docs/guides/speech-to-text)
* Add support for OpenAI cloud platform's [speech synthesis service](https://platform.openai.com/docs/guides/text-to-speech)
* Integrate optional vocal isolation to speech recognition, alignment and translation operations using the new `--isolate` option, allowing for higher accuracy in difficult cases like achieving word-level lyrics alignment
* Add the new `adaptive-gate` VAD engine using a custom bandlimited adaptive gate. Fast and robust. Works well for relatively clean tracks or tracks that have already been processed using vocal isolation
* Add optional token-level repetition suppression to Whisper engine
* Expose several new configuration options for the Whisper engine: settings for maximum tokens per part, and a setting to enable/disable repetition suppression, set custom random seed, disable/enable decoding of timestamp tokens
* Expose more options for the Elevenlabs engine

**Enhancements**:
* `detect-voice-activity` now also outputs the cropped voice when an audio file is given as output, with `.cropped` suffix added
* Improved word segmentation of whisper engine. Words spanning multiple recognized time segments are now split. Word timestamp ranges don't overlap non-speech sections.
* Whisper and Whisper.cpp outputs now include timestamps for individual recognized tokens

**Behavioral and breaking changes**:
* Minimal required node version changed to `18.0.0`
* All recognition, alignment, translation and language recognition operations first apply the new adaptive gate VAD (can be changed to any other VAD engine via the `vad.` option prefix) and remove any sections that are not identified as containing voice, before starting processing. This should improve results in most cases, and reduce processing time
* To reduce Whisper hallucinations and repetition loops, these changes were made:
	* Pre-cropping by default can significantly help with reducing hallucinations, giving the model less "empty space" to hallucinate on
	* Enable new token-level repetition suppression (`suppressRepetition = true`) during decoding
	* Disable decoding of timestamp tokens by default (`decodeTimestampTokens = false`), since more accurate timing is already extracted via cross-attention weight alignment. For unclear reasons, this can significantly reduce the occurrence of token repetition loops, and increases word timestamp accuracy. However, there are cases where this causes the model to end a part prematurely, especially in singing and less speech-like voice segments. In those cases the it can be enabled with `decodeTimestampTokens = true`
* When `transcribe`, `align` or `translate-speech` operations are run with `--isolate` enabled, they will output the isolated part in `some-output-file.isolated.wav` and background part (isolated subtracted from original) in `some-output-file.background.wav` (any supported codec other than `wav` can be used - this is just an example)
* VAD operations now return a timeline including only the active sections, labeled as `active`
* When the specified language is not English, but an `.en` Whisper model was specified, a warning would be shown, and the model will be automatically switched to the corresponding multilingual model (omitting the `.en`), instead of producing an error
* Default speech language detection engine is now changed to `whisper`
* Default voice activity detection engine is now changed to `silero`
* CLI: duplicate file name outputs would now append the `_001` suffix pattern instead of ` (1)`. This change is meant to simplify sorting and typing the resulting file names and remove the space and parenthesis characters, to ensure compatibility with all operating systems
* `targetPeakDb` post-processing and denoising option renamed to `targetPeak`
* `maxIncreaseDb` post-processing and denoising option renamed to `maxGainIncrease`
* `dryMixGainDb` denoising option renamed to `dryMixGain`

**Fixes**:
* Integrated `whisper` engine now uses `tiktoken` to tokenize text, which produces near identical tokenization compared to the official Python implementation. This fixes issues with decoding Chinese characters, correctly encoding prompts, and several other languages with characters that span multiple tokens
* Fix voice language lists for multilingual voices in Elevenlabs TTS engine
* Fix runtime error with `rnnoise` when used as VAD engine
* Fix issue in CLI where supported output media formats weren't reported correctly
* Fix issue with identifying legacy IEEE Float wave format
* Fix issue with language detection failing with empty inputs
* Fix issue with Whisper model failing when no tokens are detected in a part
* Fix issue with phone alignment not getting the right DTW window size, producing warnings like `all cost directions are equal to infinity`
* Fix phone timelines in DTW-RA
* Add more workarounds for eSpeak tokenization bugs
* Various other fixes

**Documentation**:
* Add new [release notes](./Releases.md) page. Releases before `1.0.x` were retroactively documented based on commit history (may not exactly detail all historical changes)
* Add new [development page](./Development.md) with a quick guide for setting up a development environment to make changes to the Echogarden codebase
* Options reference page reorganized and updated with some missing information

## `0.12.x` (March 16, 2024)

**New features**:
* Add global options support to API
* Add updated `ffmpeg` internal packages for many platforms, including pre-signed binaries for macOS

**Enhancements**:

**Fixes**:
* Fix issue with Polish TTS in eSpeak NG
* Fix warning about `punycode` module in the CLI

**Other**:
* Include `package-lock.json` in repository


## `0.11.x` (August 17, 2023)

Many features, enhancements, and fixes were incrementally added over the span of 7 months, up to March 2024.

**New features**:
* Partial rewrite of subtitle generation methods. Adds many features and options
* Expose subtitle methods to API
* Add support for multi-pass (AKA hierarchical) DTW alignment
* Auto-prompt parts in `whisper` STT engine
* Add support for Klatt synthesis in `espeak` engine

**Enhancements**:
* Adds a total of 14 new VITS voices
* Retry on failure for `microsoft-edge` and `google-translate` TTS engines

**Fixes**:
* Don't error when empty audio is returned in `microsoft-edge` response
* Fix audio playback in macOS
* Many other fixes


## `0.10.x` (August 2, 2023)

**New features**:
* Add developer and server APIs, allowing the package to be used as a library or server
* Add granularity options to DTW
* Add Linux SoX package

**Enhancements**:
* Adds 7 new VITS voices

**Fixes**:
* Many fixes


## `0.9.x` (July 29, 2023)

**New features**:
* Add text offsets to timeline
* Include segments and sentences in recognition and speech translation timelines
* Improve voice information in Elevenlabs engine

**Behavioral changes**:
* Set `en_GB-alan-low` as default `en-GB` VITS voice, since `danny` was trained to accept `en-US` pronunciations, which may confuse some people

**Fixes**:
* Work around several eSpeak bugs
* Many fixes


## `0.8.x` (July 25, 2023)

**New features**:
* Add confidence to some speech recognition timelines
* Add `plaintext` options
* Add punctuation thresholds to Whisper decoder
* Expose subtitle configuration options to CLI

**Enhancements**:
* Improve speech language detection to work with arbitrary length audio. Split audio into overlapping parts and detect each part individually. Then average the results.
* Add more heteronyms

**Behavioral changes**:
* Rename `subtitles.minWords` to `subtitles.minWordsInLine`

**Fixes**:
* Improve numerical stability of softmax function
* Work around eSpeak bug with markers in long inputs
* Various fixes


## `0.7.x` (July 23, 2023)

**New features**:
* Alignment: Add option to accept custom lexicons
* Implement and add decoder temperature option to Whisper model

**Enhancements**:
* Alignment: use preprocessing and lexicons
* Add language detection to speech translation
* Add language detection options to synthesis, and set empty default options for detection in several APIs
* Accept speech language detection options in recognition
* Show warning only when DTW window is smaller than 25% of audio duration
* Add colors to log messages
* Warn when maximum DTW window duration is smaller than source audio duration.

**Behavioral changes**:

**Fixes**:
* Fix support for SSML input in eSpeak engine
* Various fixes


## `0.6.x` (July 20, 2023)

**New features**:
* Add support for custom lexicons. Change lexicon object structure to include language code and allow for multiple languages in a single lexicon
* Add support for SSML inputs (currently only supported by Google, Microsoft and Amazon cloud engines). Ensure they are not split to segments or sentences
* CLI: Add flag to enable or disable file overwriting in CLI
* CLI: Add operation to list engines
* Add arguments to customize paragraph parsing
* Change whitespace option to include option for collapsing all whitespace

**Enhancements**:
* Change whitespace option to include option for collapsing all whitespace
* Add awareness of guillemets
* Log full language of selected voice

**Behavioral changes**:
* Set Elevenlabs defaults to mid-values
* Split plain text to paragraphs using double line breaks by default.
* Rename `awsPolly` options to `amazonPolly` to be more consistent with documentation

**Fixes**:
* Fix and update Elevenlabs engine
* Fix incorrect gender properties for some VITS voices
* Convert to plaintext before detecting language when input is SSML.
* Various fixes

**Other**:
* Remove `package-lock.json` from the repository


## `0.5.x` (July, 19 2023)

**New features**:

**Enhancements**:
* Add large numbers of VITS voices

**Behavioral changes**:
* Move to new package system supporting version tags, and hosted in a Hugging Face repository

**Fixes**:
* Various fixes


## `0.4.x` (July 9, 2023)

**New features**:

**Enhancements**:
* Improve text normalization and add support for currencies
* Improve heteronym lexicons
* Extend year patterns
* Improve logic for decade normalization
* Add some British English (RP) pronunciations to heteronym lexicon
* Add large numbers of VITS voices

**Behavioral changes**:
* Remove support for `afplay` and `aplay` for playback. Only SoX is used now.

**Fixes**:
* Various fixes


## `0.3.x` (July 1, 2023)

**New features**:

**Enhancements**:
* Upgrade heteronym disambiguation to an improved, rule-based approach, which doesn't use POS tagging
* Extend decade normalization
* Improve text normalization and add support to currencies
* Update the heteronym lexicon

**Behavioral changes**:

**Fixes**:
* Remove sentences containing only whitespace when synthesizing
* Many fixes


## `0.2.x` (May 10, 2023)

**New features**:

**Enhancements**:
* Show current sentence and segment in synthesis log
* Add check for cancellation flag
* Add support to additional VITS voices
* Improve auto TTS engine selection
* Many Enhancements

**Behavioral changes**:
* Remove dependency on `xregexp` package. Use Unicode RegExp instead.

**Fixes**:
* Many fixes


## `0.1.x` (April 24, 2023)

Initial release

**Enhancements**:
* Add support for skipping audio playback with the Enter key.
* Run CLI in a worker thread by default.
* Many Enhancements

**Fixes**:
* Many fixes
