# Using the command line interface

All CLI command lines have the general structure:

```bash
echogarden [command] [one or more inputs..] [one or more outputs...] [options...]
```

Here's a quick tour of the main operations available via the CLI.

Each command can accept one or more options, in the form `--[optionName]=[value]` (The `=` is required). A detailed reference of all the available options can be found [here](Options.md).

**Keyboard shortcuts**:
* While the program is running, you can press `esc` to exit immediately
* When audio is playing, you can press `enter` to skip it

## Text to speech

**Task**: given a text file, synthesize spoken audio for it.

This would synthesize "Hello World" and play the result in the terminal:
```bash
echogarden speak "Hello world!"
```

If no language is specified, it would attempt to detect it. This usually works better for longer texts, and may misidentify shorter ones. To ensure the right language is selected, you can specify the language explicitly:
```bash
echogarden speak "Hello world!" --language=en
```

This would save the resulting audio to `result.mp3`:
```bash
echogarden speak "Hello world!" result.mp3 --language=en
```

`speak-file` synthesizes text loaded from a textual file, which can have the extensions `txt`, `html`, `xml`, `ssml`, `srt`, `vtt`:
```bash
echogarden speak-file text.txt result.mp3 --language=en
```

You can specify an engine using the `--engine` option (a full list of engines can be found [here](Engines.md)). This would set the synthesis engine to `pico` (SVOX Pico):
 ```bash
 echogarden speak-file text.txt result.mp3 --language=en --engine=pico
 ```

The CLI supports multiple output files. This would synthesize a text file, and save the resulting audio in both `result.mp3` and `result.wav`, as well as subtitles in `result.srt`:
```bash
echogarden speak-file text.txt result.mp3 result.wav result.srt --engine=vits --speed=1.1
```

Synthesize a web page (it will try to extract its main article parts and omit the rest):
```bash
echogarden speak-url https://example.com/hola
```

Synthesize a Wikipedia article, in any of its language editions:
```bash
echogarden speak-wikipedia "Psychologie" --language=fr
```

## Speech to text

**Task**: given an audio recording containing speech, find a textual transcription that best matches it.

This would transcribe the audio file `speech.mp3`, and then play the audio, along with the recognized text, in the terminal:
```bash
echogarden transcribe speech.mp3
```

This would transcribe the audio file `speech.mp3` and store the resulting transcription in `result.txt`, subtitles in `result.srt`, and a full timeline tree in `result.json`:
```bash
echogarden transcribe speech.mp3 result.txt result.srt result.json
```

## Speech to transcript alignment

**Task**: given an audio file and its transcript, try to approximate the timing of the start and end of each spoken word (and its subparts).

This would align the audio file `speech.mp3` with the transcript provided in `transcript.txt`, and would play the synchronized result in the terminal:
```bash
echogarden align speech.mp3 transcript.txt
```

This would align the audio file `speech.mp3` with the transcript provided in `transcript.txt`, and store the resulting subtitles in `result.srt`, and a full timeline tree in `result.json`:
```bash
echogarden speak-file text.txt transcript.txt result.srt result.json
```

## Speech translation

**Task**: given an audio file containing speech in one language, transcribe it to a second language. The translated transcript should be generated directly from the speech itself, without an intermediate textual translation step.

This will detect the spoken language, apply speech translation to English, and play the original audio, synced with the translated transcript:
```bash
echogarden translate-speech speech.mp3
```

To specify the source and target languages explicitly, use the `sourceLanguage` and `targetLanguage` options:
```bash
echogarden translate-speech speech.mp3 translation.txt --sourceLanguage=es --targetLanguage=en
```

**Note**: currently, only English is supported as target language. This is a limitation of the `whisper` Engine, which is the only one used for speech translation, at this time.

## Using output templates to split the output to multiple files

Echogarden can split the output to multiple parts based on the segment boundaries detected. For example:

```bash
echogarden speak text.txt parts/[segment].opus
```

The `[segment]` placeholder would cause multiple files to be created, one for each text segment (segments would be determined according to paragraph or line breaks, in this case). The placeholder would be replaced by the index and initial text of the segment, producing an output file with a name like `parts/001 Hello world how are you doing ... .opus`.

Templates can also be used for multiple output files. For instance, the following would align `speech.mp3` with `transcript.txt` and then split the audio according to the segments found in the transcript, and store separate audio and subtitle files for each part.

```bash
echogarden align speech.mp3 transcript.txt parts/[segment].m4a parts/[segment].srt
```

### Splitting based on sentence boundaries (future)

Splitting based on sentences, using a `[sentence]` placeholder, is currently on the to-do list. Please let me know if you find this feature important and I'll prioritize it.

## Audio playback
By default, audio isn't played in the terminal when an output file is specified, you can override this behavior by adding `--play`:
```bash
echogarden speak-file text.txt result.mp3 --play
```

Or similarly prevent playback using `--no-play`:
```bash
echogarden transcribe speech.mp3 --no-play
```

## Loading configuration from a file

Since there are many possible configuration options, it may be more convenient to store them in a configuration file.

When a file named `echogarden.config` is found at the current directory, it will be loaded automatically and its content would be used as default options. You can also specify a particular configuration file path with the option `--config=path/to/your-config-file.config`.

The configuration file format is simple and has a dedicated section for each command (all `speak-` commands are grouped together under `speak`):

```conf
[speak]

# Engine for synthesis:
engine = vits

# Voice for synthesis (case-insensitive, can be a search pattern):
voice = amy

# Custom lexicon paths:
customLexiconPaths = ["lexicon1.json", "lexicon2.json"]

[transcribe]

# Engine for recognition:
engine = whisper

# Whisper model to use:
whisper.model = tiny
```

### JSON configuration file

You can also use a JSON configuration file format instead, if preferred.

Name your file `echogarden.config.json`:
```json
{
	"speak": {
		"engine": "vits",
		"voice": "amy",
		"customLexiconPaths": ["lexicon1.json", "lexicon2.json"]
	},

	"transcribe": {
		"engine": "whisper",
		"whisper": {
			"model": "tiny"
		}
	}
}
```

Flattened property names are also accepted:
```json
{
	"transcribe": {
		"engine": "whisper",
		"whisper.model": "tiny"
	}
}
```

## File overwriting behavior

By default, the CLI overwrites existing files.

Please be careful to not accidentally have an input file misidentified as an output file, as it may get rewritten without notice or confirmation.

To ensure files are never overwritten, you can pass the `--no-overwrite` option:

```bash
echogarden transcribe speech.mp3 transcript.txt --no-overwrite
```

## Other operations

### Language detection

**Task**: given audio or textual input, try to identify which language it is spoken or written in.

Try to identify the language of an audio file containing speech, and print the probabilities to the terminal:
```bash
echogarden detect-speech-language speech.mp3
```

Try to identify the language of a text file, and print the probabilities to the terminal:
```bash
echogarden detect-text-language story.txt
```

Try to identify the language of a text file, and store the detailed probabilities in a JSON file:
```bash
echogarden detect-text-language story.txt detection-results.json
```

### Voice activity detection

**Task**: given an audio file, try to classify which parts of the audio contain speech, and which don't.

This would apply VAD and play the audio, synchronized with `speech` and `nonspeech` indicators, printed to the terminal.
```bash
echogarden detect-voice-activity speech.mp3
```

This would apply VAD and store the results in a timeline JSON file.
```bash
echogarden detect-voice-activity speech.mp3 timeline.json
```

### Speech denoising

**Task**: try to reduce the amount of background noise in a spoken recording.

This would apply denoising and play the denoised audio:
```bash
echogarden denoise speech.mp3
```

This would apply denoising, and save the denoised audio to a file:
```bash
echogarden denoise speech.mp3 denoised-speech.mp3
```

## Information and lists

### `list-engines`

Shows a list of available engines for a given command:

```bash
echogarden list-engines speak
```

### `list-tts-voices`

Shows a list of available TTS voices for a given engine:

```bash
echogarden list-tts-voices google-cloud
```

Saves the voice list in a JSON file:
```bash
echogarden list-tts-voices google-cloud google-cloud-voices.json
```

## Internal package management

Manage the Echogarden packages that are locally installed

### `install`

Install one or more expansion packages

### `uninstall`

Uninstall one or more expansion packages

### `list-packages`

Show a list of installed expansion packages
