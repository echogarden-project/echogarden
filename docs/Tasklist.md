# Developer's task list

## Bugs


### eSpeak

* IPA -> Kirshenbaum translation is still not completely similar to what is output by eSpeak. Also, in rare situations, it outputs characters that are not accepted by eSpeak and eSpeak errors. Investigate when that happens and how to improve on this

### Browser extension
* Investigate why WebSpeech events sometimes completely stop working in the middle of an utterance for no apparent reason. Sometimes this is permanent, until the extension is restarted. Is this a browser issue?
* If a request is made and the server takes too much time to respond, the service worker may sleep and the request never canceled

### Browser extension / content script
* Highlighting sometimes does not appear when mouse is pressed over handle while speech of element starts

### External bugs

* `espeak-ng`: 'Oh dear!”' is read as "oh dear exclamation mark", because of the special quote character following the exclamation mark
* `espeak-ng`: [Marker right after sentence end is not reported as an event](https://github.com/espeak-ng/espeak-ng/issues/920)
* `espeak-ng`: On Japanese text, it says "Chinese character" or "Japanese character" for characters it doesn't know
* `espeak-ng`: Broken markers on the Korean voice
* `wtf_wikipedia` Sometimes fails on `getResult.js` without throwing a humanly readable error
* `wtf_wikipedia` Sometimes captures markup like `.svg` etc.
* `msspeech`: Initialization fails on Chinese and Japanese voices (but not Korean)
* `compromise`: Slow initialization time. Currently, it takes more than a second
* Chromium doesn't fire timer events when cursor is positioned over scrollbar or body margins
* `whisper.cpp`: Timestamps aren't very accurate when `enableDTW` is set. There's a constant lag
* Node.js WASI for `flite` on Node `v21.7.2` and `v20.12.1` is intermittently crashing the process when `run` is called

## Features and enhancements

### CLI
* Show names of files written to disk. This is useful for cases where a file is auto-renamed to prevent overwriting existing data
* Restrict input media file extensions to ensure that invalid files are not passed to FFmpeg
* Consider what to do with non-supported templates like `[hello]`
* Show a message when a new version is available
* Figure out which terminal outputs should go to stdout, or if that's a good idea at all
* Print available synthesis voices when no voice matches (or suggest near matches)
* `transcribe` may also accept `http://` and `https://` URLs and pull the remote media file
* Make `enum` options case-insensitive if possible
* More fine-grained intermediate progress report for operations
* Suggest possible correction on the error of not using `=`, e.g. `speed 0.9` instead of `speed=0.9`
* Multiple configuration files in `--config=..` taking precedence by order
* Generate JSON configuration file schema
* Use a file type detector like `file-type` that uses magic numbers to detect the type of a binary file regardless of its extension. This would help to give better error messages when the given file type is wrong
* Mode to print IPA words when speaking

### CLI / playback
* Option to set audio output device for playback
* Option to set playback volume
* Maybe find a way not to pre-normalize if the audio is silent (to prevent a 30dB increase of possible noise)
* Add phone playback support

### CLI / `speak`
* Add support for sentence templates, like `echogarden speak-file text.txt /parts/[sentence].wav`

### CLI / `speak-wikipedia`
* Correctly detect language when a Wikipedia URL is passed instead of an article name
* Add option to set language edition separately from language, since Wikipedia language editions has its own code system that is slightly different from the standard one, in some cases

### CLI / `speak-url`
* Use the Wikipedia reader when the URL is detected to be from `wikipedia.org`

### CLI / `list-voices`
* When given a configuration file, see if you can fall back to take options from `speak` options, for example, to take API keys that are required for both the synthesis request and voice list request and

### CLI / `list-packages`
* Support filters

### CLI / New commands
* `play-with-subtitles`: Preview subtitles in terminal
* `play-with-timeline`: Preview timeline in terminal
* `subtitles-to-text`, `subtitles-to-timeline`, `srt-to-vtt`, `vtt-to-srt`
* `text-to-ipa`, `arpabet-to-ipa`, `ipa-to-arpabet`
* `phonemize`
* `normalize-text`
* `transcribe-youtube`: Transcribe the audio in a YouTube video (requires fetching the audio somehow - which can't be done using the normal YouTube API)
* `speak-youtube-subtitles`: To speak the subtitles of a YouTube video

### API
* Validate timelines to ensure timestamps are always increasing: no negative timestamps or timestamps over the duration of the audio. No sentences without words, etc. and correct if needed
* See whether it's possible to detect and include / remove Emoji characters in timelines
* Add support for phrases in timelines
* Accept voice list caching options in `SynthesisOptions`

### Package manager
* Better error message when a package is not found remotely. Currently, it just gives a `404 not found` without any other information
* Retry on network failure

### Speech language detection

### Text language detection
* Deploy and add the new n-gram based text language detection model

### Segmentation
* See if it's possible or useful to reliably use eSpeak as a segmentation engine.

### Subtitles
* Split long words if needed. This is especially important for Chinese and Japanese
* If a subtitle is too short and at the end of the audio, try to extend it back if possible (for example, if the previous subtitle is already extended, take back from it)
* Decide how many punctuation characters to allow before breaking to a new line (currently it's infinite)
* Add more clause separators, for even more special cases
* Add option to output usable word or phoneme-level caption files (investigate how it's done on YouTube auto-captions)
* Parse VTT's language

### Synthesis
* Option to disable alignment (only for some engines). Alternative: use a low granularity DTW setting that is very fast to compute
* Find places to add commas (",") to improve speech fluency. VITS voices don't normally add speech breaks if there is no punctuation
* An isolated dash " - " can be converted to a " , " to ensure there's a break in the speech
* Ensure abbreviations like "Ph.d" or similar names are segmented and read correctly (does `cldr` treat it as a word? Maybe eSpeak doesn't recognize it as a word). "C#" and ".NET" as well
* Find a way to manually reset voice list cache
* When synthesized text isn't pre-split to sentences, apply sentence splits by using the existing method to convert the output of word timelines to sentence/segment timelines
* Some `sapi` voices and `msspeech` languages output phones that are converted to Microsoft alphabet, not IPA symbols. Try to see if these can be translated to IPA
* Decide whether asterisk `*` should be spoken when using `speak-url` or `speak-wikipedia`
* Add partial SSML support for all engines. In particular, allow changing language or voice using the `<voice>` and `<lang>` tags, `<say-as>` and `<phoneme>` where possible
* Try to remove reliance on `()` after `.` character hack in `EspeakTTS.synthesizeFragments`
* eSpeak IPA output applies stress marks on vowels, not syllables - which is usually the standard for IPA. Consider how to make a conversion to and from these two approaches (possibly detect it automatically), to provide users with more useful phonemizations
* Decide if `msspeech` engine should be selected if available. This would require attempting to load a matching voice, and falling back if it is not installed
* Speaker-specific voice option
* Use VAD on the synthesized audio file to get more accurate sentence or word segmentation
* When `splitToSentences` is set to `false`, the timeline doesn't include proper sentences. Find a way to pass larger sections to the TTS, but still have proper sentences in the timeline

### Synthesis / preprocessing
* Extend the heteronyms JSON document with additional words like "conducts", "survey", "protest", "transport", "abuse", "combat", "combats", "affect", "contest", "detail", "marked", "contrast", "construct", "constructs", "console", "recall", "permit", "permits", "prospect", "prospects", "proceed", "proceeds", "invite", "reject", "deserts", "transcript", "transcripts", "compact", "impact", "impacts"
* Full date normalization (e.g. `21 August 2023`, `21 Aug 2023`, `August 21, 2023`)
* Add support for capitalized-only rules, and possibly also all uppercase / all lowercase rules
* Add support for multiple words in `precededBy` and `succeededBy`
* Support substituting to graphemes in lexicons, not only phonemes
* Cache lexicons to avoid parsing the JSON each time it is loaded (this may not be needed for if the file is relatively small)
* Is it possible to pre-phonemize common words like "the" or is it a bad idea / not necessary?
* Add support for text preprocessing for all engines that can benefit from it (possibly including cloud engines)
* Add SAPI pronunciation to lexicons (you already have the pronunciations for `en_US` and `en_GB`)
* Try to use entity recognition to detect years, dates, currencies etc., which would disambiguate cases where it is not clear, like "in 1993" in "She was born in 1993" and "It searched in 1993 websites"
* Option to add POS tags to timeline, if available

### Synthesis / VITS
* Allow limiting how many models are cached in memory
* Custom model paths (decide how to implement)
* Pull voice list from JSON file, or based on URL? Is that a good idea?
* Add speaker names to voice list somehow

### Synthesis / Azure Cognitive Services
* Currently, when input is set to be SSML, it is wrapped in a `<speak>` tag. Handle the case where the user made their own SSML document wrapped with a `<speak>` tag as well. Currently, it may send invalid input to Azure

### Recognition
* Show alternatives when playing in the CLI. Clear current line and rewrite already printed text for alternatives during the speech recognition process

### Recognition / Whisper
* Whisper's Chinese and Japanese output can be split into words in a more accurate way. Consider using a dedicated segmentation library to perform the segmentation in character sequences that have no punctuation characters to aid on guessing word boundaries
* Cache last model (if enough memory is available)
* The segment output can be used to split into segments, otherwise it is possible to try to guess using pause lengths or voice activity detection
* Bring back the option to use eSpeak DTW based alignment on segments, as an alternative approach

### Alignment

### Alignment / DTW
* Accept percentages like `20%` in the `windowDuration` option
* For the `granularity` option, add more granularities like `xxx-low` and `xxxx-low` (should the naming be changed? Maybe transition to a new naming scheme?)
* Add and test official support for more than 6 hours of audio

### Alignment / DTW-RA

### Alignment / Whisper

### Source separation / MDX-NET
* Option to customize overlap
* Add more models

### Server
* Option to allow or disallow local file paths as arguments to API methods (as a security safeguard)

### Worker
* Add cancellation checks in more operations
* Support more operations

### Browser extension
* Options UI
* Add supported engines and voices to WebSpeech voice list
* Pause and resume support

### Browser extension / content script
* Autoscroll should work even if the scrollbar relevant to the target element is not the viewport's scrollbar
* Find a way to show handles even for elements that start with a link
* Add detection for line breaks in `pre` blocks
* Support the custom tags used in YouTube comments
* Show handles based on `<br>` tags and possibly line breaks internal to the element
* Show handles based on sentence start positions
* UI or gesture to stop speech (other than the `esc` key)
* Hide handles when mouse leaves the viewport
* Don't show handles when mouse is over a large container element
* Button or keyboard shortcut to show and hide handles
* Show blinking placeholder when synthesis is loading for a particular text node
* Navigate paragraphs or sentences with keyboard shortcuts
* Minimum size when iterating text nodes to get handle

## Maintenance and cleanup

* Find a way to reset voice list cache on update
* CLI code has a lot of repetition. See how it can be refactored
* See if the installation of `winax` can be automated and only initiate if it is in a Windows environment
* Ensure that all modules have no internal state other than caching
* Start thinking about some modules being available in the browser. Which node core APIs the use? Which of them can be polyfilled, and which cannot?
* Remove built-in voices from `flite` to reduce size?
* Slim down `kuromoji` package to reduce base installation size

## Things to test

* Test that SSML works where it should
* Test that alignment works correctly when the input is SSML
* Test synthesis, recognition and alignment with empty input. Do they still work?
* Test everything's fine on macOS
* Test that cloud services all still work correctly, especially with SSML inputs

## Future features and enhancements

### CLI
* Auto-generate options file, with comments, based on default options of the API
* Have the CLI launch a background worker (in a thread) to enable better parallelism
* Playback result audio while synthesis or recognition is still processing in the background
* Auto-import and extract project Gutenberg texts (by URL or from a file)
* `stdin` input support
* `stdout` output support
* Markdown file as text input?

### Web
* Web based frontend UI to the server
* Adapt some WASM modules to also run on the web
* Investigate running in WebContainer

### API
* Auto-install npm modules when needed using an approach similar to like `npm-programmatic`

### Text enhancement
* Add capitalization and punctuation to recognized outputs if needed (Silero has a model for it for `en`, `de`, `ru`, `es`, but in `.pt` format only)

### Synthesis
* Synthesize the given subtitle file and try to preserve the existing timing of cues, or even align to existing speech

### Recognition
* Low latency, streaming recognition mode. Make the partial transcription available as fast as possible
* Live input / microphone recognition
* Implement beam search for Whisper decoder
* Implement beam search for Silero decoder
* Live Vosk alternatives events
* Investigate exporting Whisper models to 16-bit quantized ONNX or a mix of 16-bit and 32-bit

### Alignment
* Method to align audio file to audio file
* Allow `dtw` mode work with more speech synthesizers to produce its reference
* Predict timing for individual letters (graphemes) based on phoneme timestamps (especially useful for Chinese and Japanese)

## Possible new engines or platforms

* [PlayHT](https://play.ht/) speech synthesis cloud service
* [Deepgram](https://deepgram.com/) cloud text-to-speech API
* [Assembly AI](https://www.assemblyai.com/) cloud speech recognition API
* Coqui STT server connection
* [MarbleNet VAD](https://github.com/NVIDIA/NeMo/blob/main/tutorials/asr/Online_Offline_Microphone_VAD_Demo.ipynb), included of the NVIDIA NeMo framework, can be exported to ONNX
* Silero text enhancement engine can be ported to ONNX
* See what can be done for supporting WinRT speech: in particular `windows.media.speechsynthesis` and `windows.media.speechrecognition` support, possibly using NodeRT or some other method
* Figure out how to support `julius` speech recognition via WASM
* Any way to support RHVoice?

## Maybe?

* Using a machine translation model to provide speech translation to languages other than English
* Is it possible to get sentence boundaries without punctuation using NLP techniques like part-of-speech tagging?

## May or may not be good ideas

* Bring back interleaved playback
* Bring back debugging file output

## Other ideas

* Support alignment of EPUB 3 eBooks with a corresponding audiobook
* Voice cloning
* Speech-to-speech voice conversion
* Speech-to-speech translation
* HTML generator, that includes text and audio, with playback and word highlighting
* Video generator
* Desktop app that uses the tool to transcribe the PC audio output
* Special method to use time stretching to project between different aligned utterances of the same text
* Is it possible to combine the Silero speech recognizer and a language model and try to perform Viterbi decoding to find alignments?
