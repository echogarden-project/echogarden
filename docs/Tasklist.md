# Developer's task list

## Bugs

### Audio player
* In rare situations, the audio player fails when encountering encoded markup (it can't find it in the text). Decide what to do when this happens

### Phoneme processing
* IPA -> Kirshenbaum translation is still not completely similar to what is output by eSpeak. Also, in rare situations, it outputs characters that are not accepted by eSpeak and eSpeak errors. Investigate when that happens and how to improve on this

### Segmentation
* eSpeak workaround for getting markers to work after sentence boundaries fails on some edge cases, especially when the input has special characters. Sequences like `**********` or `----------` fail.

### Browser extension
* Investigate why WebSpeech events sometimes completely stop working in the middle of an utterance for no apparent reason. Sometimes this is permanent, until the extension is restarted. Is this a browser issue?
* If a request is made and the server takes too much time to respond, the service worker may sleep and the request never canceled

### Browser extension / content script
* Highlighting sometimes does not appear when mouse is pressed over handle while speech of element starts

## Features and enhancements

### Browser extension
* Options UI
* Add supported engines and voices to WebSpeech voice list
* Pause and resume support

### Browser extension / content script
* Autoscroll should work even if the scrollbar relevant to the target element is not the viewport's scrollbar
* Find a way to show handles even for elements that start with a link
* Add detection for line breaks in `pre` blocks
* Some symbols, like `=`, `*`, `#` are not highlighted
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

### Worker
* Add cancelation checks in more operations
* Optionally omit unnecessary data from the response (decoded input, segment data, etc.)
* Support more operations
* Support compressed audio in response

### CLI
* Restrict input media file extensions to a set list to avoid cases where an output media file would be overwritten due to user error
* Mode to print IPA words when speaking
* Ignore non-supported templates like `[hello]`
* Show a message when a new version is available
* Figure out which terminal outputs should go to stdout, or if that's a good idea at all
* Option to set audio output codec options
* Option to set audio output device for playback
* Print available synthesis voices when no voice matches (or suggest near matches)
* `transcribe` may also accept `http://` and `https://` URLs and pull the remote media file
* Make enum options case-insensitive if possible
* Consider adding the input text offset to each segment, sentence and word in the resulting timeline with respect to the original file (even if it is, say, an HTML or captions file)
* Add phone playback support
* More fine-grained intermediate progress report for operations
* Suggest possible correction on the error of not using `=`, e.g. `speed 0.9` instead of `speed=0.9`
* Multiple configuration files in `--config=..` taking precedence by order
* Support comments in the JSON configuration file
* Generate JSON configuration file schema
* Use a file type detector like `file-type` that uses magic numbers to detect the type of a binary file regardless of its extension. This would help giving better error messages when the given file type is wrong.

### CLI / `speak`
* Add support for sentence templates, like `echogarden speak-file text.txt /parts/[sentence].wav`.

### CLI / `speak-wikipedia`
* Correctly detect language when a Wikipedia URL is passed instead of an article name
* Add option to set language edition separately from language, since Wikipedia language editions has its own code system that is different from the standard one in some cases

### CLI / `speak-url`
* Use the Wikipedia reader when the URL is detected to be from `wikipedia.org`

### CLI / `list-voices`
* When given a configuration file, see if you can fall back to take options from from `speak` options, for example, to take API keys that are required for the both the synthesis request and voice list request and

### CLI / `list-packages`
* Support filters

### CLI / New commands
* `speak-youtube`: To speak the subtitles of a YouTube video
* `play-with-captions`: Preview captions in terminal
* `play-with-timeline`: Preview timeline in terminal
* `captions-to-text`, `captions-to-timeline`, `srt-to-vtt`, `vtt-to-srt`
* `crop-to-timeline`, `split-by-timeline`
* `text-to-ipa`, `arpabet-to-ipa`, `ipa-to-arpabet`
* `phonemize-text`
* `normalize-text`
* `remove-nonspeech`

### API
* Option to control logging verbosity
* Add support to accept caption options in API and CLI
* Retry on error when connecting to cloud providers, including WebSocket disconnection with `microsoft-edge` (already supported by `gaxios`, not sure about `ws` - decide on default setting)
* Accept full language names as language identifiers
* Validate timelines to ensure timestamps are always increasing, no -1 timestamps or timestamps over the time of the audio, no sentences without words, etc. and correct if needed
* Add support for phrases in timelines
* Time/pitch shifting for recognition and alignment results
* Accept voice list caching options in `SynthesisOptions`

### Speech language detection

### Text language detection
* Deploy and add the new n-gram based text language detection model

### Segmentation
* Split long words
* See if it's possible to reliably use eSpeak as a segmentation engine
* Path to `kuromoji` dictionaries can be found more reliably than current

### Captions
* If a subtitle is too short and at the end of the audio, try to extend it back if possible (for example, if the previous subtitle is already extended, take back from it)
* Split long words if needed
* Decide how many punctuation characters to allow before breaking to a new line (currently it's infinite)
* Add more clause separators, for even more special cases
* Add option to output word or phoneme-level caption files (investigate how it's done on YouTube auto-captions)
* Parse VTT's language
* Option to generate captions that have word-level timings

### Synthesis
* Option to disable alignment.
* Find places to add commas (",") to improve speech fluency. VITS voices don't normally add phrasing breaks if there is no punctuation
* An isolated dash " - " can be converted to a " , " to ensure there's a break in the speech.
* Ensure abbreviations like "Ph.d" or names like are segmented and read correctly (does `cldr` treat it as a word? Maybe eSpeak doesn't recognize it as a word). "C#" as well
* Find way to manually reset voice list cache
* When synthesized text isn't pre-split to sentences, apply sentence splits by using the existing method to convert the output of word timelines to sentence/segment timelines
* Some `sapi` voices and `msspeech` languages output phones that are converted to Microsoft alphabet, not IPA symbols. Try to see if these can be translated to IPA
* Decide whether asterisk `*` should be spoken when using `speak-url` or `speak-wikipedia`
* Add partial SSML support for all engines. In particular, allow changing language or voice using the `<voice>` and `<lang>` tags, `<say-as>` and `<phoneme>` where possible.
* Try to remove reliance on `()` after `.` character hack in `EspeakTTS.synthesizeFragments`.
* eSpeak IPA output puts stress marks on vowels, not syllables - which is the standard for IPA. Consider how to make a conversion to and from these two approaches (possibly detect it automatically).
* Decide if `msspeech` engine should be selected if available. This would require attempting to load a matching voice, and falling back if it is not installed
* Speaker-specific voice option
* Use VAD on the synthesized audio file to get more accurate sentence or word segmentation

### Synthesis / preprocessing
* Extend the heteronyms JSON document with additional words like "conducts", "survey", "protest", "transport", "abuse", "combat", "combats", "affect", "contest", "detail", "marked", "contrast", "construct", "constructs", "console", "recall", "permit", "permits", "prospect", "prospects", "proceed", "proceeds", "invite", "reject", "deserts", "transcript", "transcripts", "compact", "impact", "impacts"
* Full date normalization (e.g. `21 August 2023`, `21 Aug 2023`)
* Add support for capitalized-only rules, and possibly also all uppercase / all lowercase rules.
* Support normalizing to graphemes, not only phonemes
* Cache lexicons to avoid parsing the JSON each time it is loaded (this may not be needed for if the file is relatively small)
* Is it possible to pre-phonemize common words like "the" or is it a bad idea / not necessary?
* Add support for text preprocessing for all engines that can benefit from it (possibly including cloud engines).
* Add SAPI pronunciation to lexicons (you already have the pronunciations for `en_US` and `en_GB`)
* Try to use entity recognition to detect years, dates, currencies etc., which would disambiguate cases where it is not clear, like "in 1993" in "She was born in 1993" and "It searched in 1993 websites"
* Option to add POS tags to timeline, if available

### Synthesis / VITS
* Allow to limit how many models are cached in memory
* Custom model paths (decide how to implement)
* Pull voice list from JSON file, or based on URL? Is that a good idea?
* Add speaker names to voice list somehow

### Synthesis / Azure Cognitive Services
* Currently, when input is set to be SSML, it is wrapped in a `<speak>` tag. Handle the case where the user made their own SSML document wrapped with a `<speak>` tag as well. Currently it may send invalid input to Azure

### Recognition
* Add confidence to each recognized word on any engine that supports it
* Show alternatives when playing in the CLI. Clear current line and rewrite already printed text for alternatives during the speech recognition process
* Look for good split points using VAD before performing recognition
* Option to split recognized audio to segments or sentences, as is done with synthesized audio

### Recognition / Whisper
* Cache last model (if enough memory available)
* Bring back option to use eSpeak DTW based alignment on segments, as an alternative approach
* The segment output can be use to split to segments, otherwise it is possible to try to guess using pause lengths or voice activity detection
* Way to specify general model size, such that the English-only/multilingual variant would be automatically selected for sizes other than `tiny`?
* Timestamps extracted from cross-attention are still not as accurate as what the official Python implementation gets. Try to see if you can make them better.

### Alignment

### Postprocessing
* When `normalize` is set to false, should obvious clipping still be prevented?

## Maintenance and cleanup

* Find a way to reset voice list cache on update
* CLI code has a lot of repetition. See how it can be refactored
* See if the installation of `winax` can be automated and only initiate if it is in a Windows environment
* Ensure that all modules have no internal state other than caching
* Start thinking about some modules being available in the browser. Which node core APIs the use? Which of them can be polyfilled, an which cannot?
* Change all the Emscripten WASM modules to use the `EXPORT_ES6=1` flag to all of them and rebuild them. Support for node.js was only added in September 2022 (https://github.com/emscripten-core/emscripten/pull/17915), so maybe wait a little bit until it is stable.
* Remove built-in voices from `flite` to reduce size?
* Slim down `kuromoji` package to the reduce base install size

## External bugs

* `espeak-ng`: 'Oh dear!”' is read as "oh dear exclamation mark", because of the special quote character following the exclamation mark
* `espeak-ng`: [Marker right after sentence end is not reported as an event](https://github.com/espeak-ng/espeak-ng/issues/920)
* `espeak-ng`: On Japanese text, it says "Chinese character" or "Japanese character" for characters it doesn't know
* `espeak-ng`: Joins multiple words into a single event when its lexicon has a compound pronunciation. For example "there was" includes the phonemes for both "there" and "was" (`ðɛɹwˌʌz`) only under "there", and leaves "was" empty.
* `wtf_wikipedia` Sometimes fails on `getResult.js` without throwing a humanly readable error
* `wtf_wikipedia` Sometimes captures markup like `.svg` etc.
* `msspeech`: Initialization fails on Chinese and Japanese voices (but not Korean)
* `compromise`: Slow initialization time. Currently it takes more than a second
* Chromium doesn't fire timer events when cursor is positioned over scrollbar or body margins

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
* Play back result audio while synthesis or recognition is still processing on the background (may require `worker_threads`)
* Auto-import and extract project Gutenberg texts (by URL or from a file)
* `stdin` input support
* `stdout` output support
* Markdown file as text input?

### Web
* Web based frontend UI to the server
* Adapt some WASM modules to also run on the web
* Investigate running in WebContainer

### API
* Auto-install npm modules when needed using something like `npm-programmatic`

### Text enhancement
* Add capitalization and punctuation to recognized outputs if needed (Silero has a model for it for `en`, `de`, `ru`, `es`, but in `.pt` format only)

### Synthesis
* Synthesize given subtitle file and try to preserve the existing timing of cues, or even align to existing speech

### Recognition
* Low latency recognition mode. Make the partial transcription available as fast as possible
* Live input / microphone recognition
* Live vosk alternatives events
* Implement beam search for Whisper decoder
* Implement beam search for Silero decoder
* Investigate exporting Whisper models to 16-bit quantized ONNX or a mix of 16-bit and 32-bit

### Alignment
* Implement hierarchical DTW to reduce memory for very long inputs.
* Implement alignment with speech translation assistance, which would enable multilingual subtitle replacement for translated subtitles
* Method to align audio file to audio file
* Make `dtw` mode work with more speech synthesizers to produce its reference
* Predict timing for individual letters (graphemes) based on phoneme timestamps

## Documentation

### CLI
* Document the `serve` command

## Possible new engines or platforms

* OpenAI Whisper cloud service (`large-v2` model is available, at a price).
* [Assembly AI cloud service](https://www.assemblyai.com/)
* [Deepgram cloud service](https://deepgram.com/)
* `whisper.cpp` CLI and WASM support
* Coqui STT server connection
* See what can be done on supporting WinRT speech: in particular `windows.media.speechsynthesis` and `windows.media.speechrecognition` support, possibly using NodeRT or some other method.
* Figure out how to support `julius` speech recognition via WASM.
* Any way to support RHVoice?
* Silero text enhancement engine can be ported to ONNX
* Investigate Raspberry Pi support. In particular, see if `onnxruntime-node` can be built for this environment
* Reimplement KNN model in ONNX for better performance

## Maybe?

* PDF support
* Using a machine translation model to provide speech translation to languages other than English?
* Is it possible to get sentence boundaries without punctuation using NLP techniques like part of speech tagging?

## May or may not be good ideas

* Bring back interleaved playback
* Bring back debugging file output

## Other ideas

* HTML generator, that includes text and audio, with playback and word highlighting
* Video generator
* Desktop app that uses the tool to transcribe the PC audio output
* Special method to use time stretching to project between different utterances of the same text
* Is it possible to combine the Silero speech recognizer and a language model and try to perform Viterbi decoding to find alignments?
* Voice replacement
