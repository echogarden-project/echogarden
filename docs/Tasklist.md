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

### Worker
* Optionally omit unnecessary data from the response (decoded input, segment data, etc.)
* Support compressed audio in response
* Add cancelation checks in more operations
* Support more operations

### CLI
* Don't show an error when `--help` option is given, instead suggest to type `echogarden` or `echogarden help` to get help
* Find a way to ensure that a user who typed `align audio.mp3 transcript.txt` and then changed to `transcribe audio.mp3 transcript.txt` won't accidently overwrite their transcript file. Simple solution, but possibly not the best solution: `align audio.mp3 --reference=transcript.txt`. Other solution: on `transcribe` and `translate-speech`, ask if output file already exist or require an `--overwrite` flag to ensure that the user intended to overwrite the existing file.
* Restrict input media file extensions to a set list to avoid cases where a media file would be overwritten due to user error
* Show a message when a new version is available
* Figure out which terminal outputs should go to stdout, or if that's a good idea at all
* Option to set audio output codec options
* Option to set audio output device
* Print available synthesis voices when no voice matches (or suggest near matches)
* `transcribe` can also accept `http://` and `https://` URLs
* Use a file type detector like `file-type` that uses magic numbers to detect the type of a binary file regardless of its extension. This would help giving better error messages when the given file type is wrong.
* Consider adding the text offset to each segment, sentence and word in the resulting timeline with respect to the original file (even if it is, say, HTML or captions file)
* Add phone playback support
* More fine-grained intermediate progress report for operations
* Suggest possible correction on the error of not using `=`, e.g. `speed 0.9` instead of `speed=0.9`
* Multiple configuration files in `--config=..` taking precedence by order
* Support comments in JSON configuration file
* Generate JSON configuration file schema
* Make enum options case-insensitive if possible
* Mode to print IPA words when speaking
* Support list-typed properties configuration files (already supported in JSON)

### CLI / `speak-wikipedia`
* Correctly detect language when a Wikipedia URL is passed instead of an article name
* Add option to set language edition separately from language, since they use different language codes in some cases

### CLI / `speak-url`
* Use the Wikipedia reader when the URL is detected to be from `wikipedia.org`

### CLI / `list-packages`
* Support filters

### CLI / Configuration file
* Support arrays

### CLI / New commands
* `help`: Show help for a particular command, like `help transcribe`
* `list-engines`: List available engines for a particular command, like `list-engines speak`
* `play-with-captions`: Preview captions in terminal
* `play-with-timeline`: Preview timeline in terminal
* `captions-to-text`, `captions-to-timeline`, `srt-to-vtt`, `vtt-to-srt`
* `crop-to-timeline`, `split-by-timeline`
* `text-to-ipa`, `arpabet-to-ipa`, `ipa-to-arpabet`
* `phonemize-text`
* `normalize-text`
* `pos-tag-text`
* `remove-nonspeech`
* `speak-youtube`: To speak the transcript of a YouTube video

### API
* Option to control logging verbosity
* Add support to accept caption options in API and CLI
* Support full language names as inputs
* Retry on error when connecting to cloud providers, including WebSocket disconnection with `microsoft-edge` (already supported by `gaxios`, not sure about `ws` - decide on default setting)
* Validate timelines to ensure timestamps are always increasing, no -1 timestamps or timestamps over the time of the audio, no sentences without words, etc. and correct if needed
* Time/pitch shifting for recognition and alignment results
* Add support for phrases in timelines
* Accept voice list caching options in `SynthesisOptions`

### Language detection
* Deploy and add the new language detection model
* When using Whisper for language detection of speech, apply it to the entire audio, not just the first 30 seconds

### Segmentation
* Option to split segment on single line break as well as double line break (when splitting on double line breaks, there might be cases where a single line break should be seen as a sentence boundary - a line in song lyrics). Maybe a better approach is to optionally preprocess the text and merge subsequent lines than are intended to be a part of the same paragraph. In this way, paragraph breaks would always be single line breaks, and there's no need to carry settings for this detail within the program.
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
* Find places to add commas (",") to improve speech fluency. VITS voices don't normally add phrasing breaks if there is no punctuation
* An isolated dash " - " can be converted to a " , " to ensure there's a break in the speech.
* Ensure abbreviations like "Ph.d" or names like are segmented and read correctly (why doesn't `cldr` treat it as a word? Maybe it's not getting the right parameters, or it's not included in the list?) and "C#"
* Use preprocessed eSpeak in places other than VITS
* Way to manually reset voice list cache
* When synthesized text isn't pre-split to sentences, apply sentence splits by using the existing method to convert the output of word timelines to sentence/segment timelines
* Log full language of selected voice (it may have a different dialect than expected)
* Add partial SSML support for all engines. In particular, allow changing language or voice using the `<voice>` and `<lang>` tags, `<say-as>` and `<phoneme>` where possible.
* Some `sapi` voices and `msspeech` languages output phones that are converted to Microsoft alphabet, not IPA symbols. Try to see if these can be translated to IPA
* Decide whether asterisk `*` should be spoken when using `speak-url` or `speak-wikipedia`
* Decide what to do with `«` and `»` punctuation characters (guillemets) when parsing and playing
* Use VAD on the synthesized audio file to get more accurate sentence or word segmentation
* Try to remove reliance on `()` after `.` character hack in `EspeakTTS.synthesizeFragments`.
* eSpeak IPA output puts stress marks on vowels, not syllables - which is the standard for IPA. Consider how to make a conversion to and from these two approaches (possibly detect it automatically).
* Investigate if `espeak` can be made to correctly support phonemizing and pronouncing the dot character like in `object.key`
* Speaker-specific voice option
* Decide if `msspeech` engine should be selected if available. This would require attempting to load a matching voice, and falling back if it is not installed
* Option to disable alignment

### Synthesis / preprocessing
* Extend the heteronyms JSON document with more words
* Full date normalization (e.g. `21 August 2023`)
* Support custom lexicons. For example, a lexicon for general pronunciation corrections (for example `ee-lon` instead of `eh-lon`)
* Add support for capitalized only rules, and possibly also all uppercase / all lowercase rules.
* Support normalizing to graphemes, not only phonemes
* Is it possible to pre-phonemize common words like "the" or is it a bad idea / not necessary?
* Add support for user-defined lexicons for VITS synthesis (or any other one that supports preprocessing)
* Add support for text normalization preprocessing for all engines that can benefit from it (possibly including cloud engines).
* Add SAPI pronunciation to lexicons (the information is already there for `en_US` and `en_GB`)
* Try to use entity recognition to detect years, dates, currencies etc., which would disambiguate cases where it is not clear, like "in 1993" in "She was born in 1993" and "It searched in 1993 websites"
* Option to add POS tags to timeline, if available
* Cache lexicons to avoid parsing the JSON each time it is loaded (this may not be needed for now since the existing one is relatively small)

### VITS
* Allow to limit how many models are cached in memory
* Custom model paths (decide how to implement)
* Pull voice list from JSON file based on URL? Is that a good idea?

### Recognition
* Add confidence to each recognized word, if available
* Show alternatives when playing in the CLI. Clear current line and rewrite already printed text for alternatives during the speech recognition process
* Look for good split points using VAD before performing recognition
* Option to split recognized audio to segments or sentences, as is done with synthesized audio

### Whisper
* When using `dtw-ra` alignment, pass the transcript as a prompt. Remove some of the initial transcript based on what has been detected (try to find the best matching initial segment between the transcript and recognized text, and remove it at each recognition window).
* During language detection, if file is more than 30s, run the detection over all the segments and average the resulting probability distributions, consider how to handle very short segments
* Timestamps extracted from cross-attention are still not as accurate as what the official Python implementation gets. Try to see if you can make them better.
* Cache last model
* Integrate speech language detection into the recognition itself, so it is done efficiently when the language is not known
* Bring back option to use eSpeak DTW based alignment on segments, as an alternative approach
* The segment output can be use to split to segment files, otherwise it is possible to try to guess using the pause lengths or voice activity detection
* Way to specify model size, such that the English-only/multilingual would be auto selection for sizes other than `tiny`?

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

## External bugs

* `espeak-ng`: 'Oh dear!”' is read as "oh dear exclamation mark", because of the special quote following the exclamation mark
* `espeak-ng`: [Marker right after sentence end is not reported as an event](https://github.com/espeak-ng/espeak-ng/issues/920)
* `espeak-ng`: On Japanese text, it says "Chinese character" or "Japanese character" for characters it doesn't know
* `wtf_wikipedia` Sometimes fails on `getResult.js` without throwing a humanly readable error
* `wtf_wikipedia` Sometimes captures markup like `.svg` etc.
* `msspeech`: Initialization fails on Chinese and Japanese voices (but not Korean)
* `compromise`: Slow initialization time. Currently it takes more than a second
* Chromium doesn't fire timer events when cursor is positioned over scrollbar or body margins

## Things to test

* Test that SSML works where it should
* Test synthesis, recognition and alignment with empty input. Do they still work?

## Future features and enhancements

### CLI
* Synthesize given subtitle file and try to preserve the existing timing of cues, or even align to existing speech
* Auto-generate options file, with comments, based on default options of the API
* Have the CLI launch a background worker (in a thread) to enable better parallelism
* Play back result audio while synthesis or recognition is still processing on the background (may require `worker_threads`)
* Navigate up down backward forward on file with timeline
* Auto-import project Gutenberg texts (by URL or from a file)
* `stdin` input support
* `stdout` output support
* Markdown file as text input?

### API
* Auto-install npm modules when needed using something like `npm-programmatic`

### Text enhancement
* Add capitalization and punctuation when to recognition outputs (Silero has a model for it for `en`, `de`, `ru`, `es`, but in `.pt` format only)

### Synthesis / preprocessing
* Extend preprocessing to other language versions of `compromise`. There are versions for French, German, Italian and Spanish

### Recognition
* Low latency recognition mode. Make the partial transcription available as fast as possible
* Live input / microphone recognition
* Live vosk alternatives events
* Implement beam search for Whisper decoder
* Implement beam search for Silero decoder

### Web
* Web based frontend UI to the server
* Adapt some WASM modules to also run on the web
* Investigate running in WebContainer

### Alignment
* Align audio file to audio file
* Alignment with speech translation assistance, which would enable multilingual subtitle replacement for translated captions
* Make `dtw` mode work with more speech synthesizers to produce its reference

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
* Predict timing for individual letters (graphemes) based on phoneme timestamps
