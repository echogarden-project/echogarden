# Echogarden

Echogarden is an integrated speech toolset that provides a variety of synthesis, recognition, alignment, and other processing tools, designed to be directly accessible to end-users:

* Easy to install, run, and update
* Runs on Windows (x64), macOS (x64, ARM64) and Linux (x64, ARM64)
* Written in TypeScript, for the Node.js runtime
* Doesn't require Python, Docker, or similar system-level dependencies
* Doesn't rely on any essential platform-specific binaries. Engines are either ported via WebAssembly, imported using the [ONNX runtime](https://onnxruntime.ai/), or written in pure JavaScript

## Feature highlights

* Fast, high-quality offline multilingual text-to-speech voices based on the [VITS](https://github.com/jaywalnut310/vits) neural architecture
* Accurate offline speech recognition using [OpenAI Whisper](https://openai.com/research/whisper) models
* Supports a [large variety of offline and cloud engines](docs/Engines.md), including services by Google, Microsoft, Amazon, OpenAI, Elevenlabs and others
* Word-level timestamps for all synthesis and recognition outputs
* Speech-to-transcript alignment using dynamic time warping (DTW), and dynamic time warping with recognition assist (DTW-RA) methods, including support for multi-pass (hierarchical) processing. Supports 100+ languages
* Advanced subtitle generation, accounting for sentence and phrase boundaries
* Can directly generate translated transcripts for 98 languages, transcribed directly to English, and produce near word-level timestamps for the translated transcript
* Attempts to improve TTS pronunciation accuracy on some engines: adds text normalization (e.g. idiomatic date and currency pronunciation), heteronym disambiguation (based on a rule-based model) and user-customizable pronunciation lexicons
* Internal package system that auto-downloads and installs voices, models and other resources, as needed
* Other features include: language detection (for both audio and text), voice activity detection, speech denoising and source separation

## Installation

Ensure you have [Node.js](https://nodejs.org/) `v18.0.0` or later installed.

then:
```bash
npm install echogarden -g
```

Additional required tools:
* [`ffmpeg`](https://ffmpeg.org/download.html): used for codec conversions
* [`sox`](https://sourceforge.net/projects/sox/): used for the CLI's audio playback

Both tools are auto-downloaded as internal packages on Windows and Linux.

On macOS, only `ffmpeg` is currently auto-downloaded. It is recommended to install `sox` via a system package manager like [Homebrew](https://brew.sh/) (`brew install sox`) to ensure it is available on the system path.

### Updating to latest version

```bash
npm update echogarden -g
```

## Interfacing with the system

Currently, tools are accessible mainly through a [command-line interface](docs/CLI.md), which enables powerful customization and is especially useful for long-running bulk operations.

Development of more graphical and interactive tooling is [planned](https://github.com/echogarden-project/echogarden/issues/28). A text-to-speech browser extension is under development (not released yet).

If you are a developer, you can also [import the package as a module](docs/API.md) or [interface with it via a local WebSocket service](docs/Server.md).

## Guides and resource pages

* [Using the command-line interface](docs/CLI.md)
* [Options reference](docs/Options.md)
* [Full list of supported engines](docs/Engines.md)
* [Developer API reference](docs/API.md)
* [Starting and interfacing with a WebSocket server](docs/Server.md)
* [Technical overview and Q&A](docs/Technical.md)
* [How to help](docs/Development.md)
* [Developer's task list](docs/Tasklist.md)
* [Release notes](docs/Releases.md)

## Credits

This project consolidates, and builds upon the effort of many different individuals and companies, as well as contributing a number of original works.

Developed by Rotem Dan (IPA: /ˈʁɒːtem ˈdän/).

## License

GNU General Public License v3

Licenses for components, models and other dependencies are detailed on [this page](docs/Licenses.md).
