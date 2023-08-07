# Echogarden

Echogarden is an integrated speech system that provides a range of synthesis, recognition, alignment, and other processing tools, designed to be directly accessible to end-users:

* Written in TypeScript, for the Node.js runtime
* Easy to install, run and update
* Runs on Windows (x64), macOS (x64, ARM64) and Linux (x64)
* Doesn't require Python, Docker, or similar system-level dependencies
* Doesn't rely on any essential platform-specific binaries. Engines are either ported via WebAssembly, imported using the [ONNX runtime](https://onnxruntime.ai/), or written in pure JavaScript

## Feature highlights

* Fast, high-quality offline text-to-speech voices based on the [VITS](https://github.com/jaywalnut310/vits) neural architecture
* Accurate offline speech recognition using [OpenAI Whisper](https://openai.com/research/whisper) models
* Provides synthesis and recognition via a [variety of offline and cloud engines](docs/Engines.md), including services by Google, Microsoft, Amazon and others
* Word-level timestamps for all synthesis and recognition outputs
* Speech-to-transcript alignment using dynamic time warping (DTW), and dynamic time warping with recognition assist (DTW-RA) methods
* Advanced subtitle generation, accounting for sentence and phrase boundaries
* Can translate speech in any one of 98 languages, transcribe it directly to English, and produce near word-level synchronized subtitles for the translated transcript
* Attempts to improve TTS pronunciation accuracy: adds text normalization (e.g. idiomatic date and currency pronunciation), heteronym disambiguation (based on a rule-based model) and user-customizable pronunciation lexicons (_note_: normalization, as well as a built-in heteronym lexicon are currently only available for English dialects)
* Internal package system that auto-downloads and installs voices, models and other resources, as needed
* Other features include: language detection (for both audio and text), voice activity detection, and speech denoising

## Installation

Ensure you have [Node.js](https://nodejs.org/) `v16.0.0` or later installed.

then:
```bash
npm install echogarden -g
```

Additional required tools:
* [`ffmpeg`](https://ffmpeg.org/download.html): used for codec conversions
* [`sox`](https://sourceforge.net/projects/sox/): used for the CLI's audio playback and recording

Both tools are auto-downloaded as internal packages on Windows and Linux.

On macOS, they are not currently auto-downloaded, due to various security issues with untrusted binaries. It is recommended to install them via a platform package manager like `brew`, and make them available on the system path.

### Updating to latest version

```bash
npm update echogarden -g
```

## Interfacing with the system

Currently, the software is operated mainly through a [command-line interface](docs/CLI.md), which enables powerful customization and is especially useful for long-running bulk operations.

Development of more graphical and interactive tooling is currently ongoing. A general roadmap is shown further down below.

If you are a developer, you can also [import the package as a library](docs/API.md) or [use it via a WebSocket service](docs/Server.md).

## Guides and resource pages

* [Using the command-line interface](docs/CLI.md)
* [Options reference](docs/Options.md)
* [Full list of supported engines](docs/Engines.md)
* [Developer API reference](docs/API.md)
* [Starting and interfacing with a WebSocket server](docs/Server.md)
* [Technical overview and Q&A](docs/Technical.md)
* [Developer's task list](docs/Tasklist.md)
* [How to help](docs/Development.md)

## Development roadmap

_(For much more detailed information, see the [developer task list](docs/Tasklist.md))_.

### In development

* (**70**%) Browser extension, acting as a bridge to a local or self-hosted server. Includes integration with the Web Speech API, and real-time narration of page content, with live word highlighting
* (**60**%) New, high-accuracy text language identification model (own work)

### Planned, but not yet started

* Web-based UI frontend
* Real-time, streaming speech recognition

### Future (maybe)

* Browser port for a subset of the API (in particular for the offline TTS models and their dependencies)

## Credits

This project consolidates, and builds upon the effort of many different individuals and companies, as well as contributing a number of original works.

Designed and developed by Rotem Dan.

## License

GNU General Public License v3

Licenses for components, models and other dependencies are detailed on [this page](docs/Licenses.md).
