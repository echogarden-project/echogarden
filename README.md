# Echogarden

An integrated speech toolbox designed with end-users in mind.

* Written in TypeScript, for the Node.js platform
* Easy to install, run and update
* Runs on Windows (x64), macOS (x64, ARM64) and Linux (x64)
* Does not require Python, Docker, or any other system-level dependencies
* No essential platform-specific binary executables. Engines are ported via WebAssembly or the [ONNX runtime](https://onnxruntime.ai/)

## Feature highlights

* Fast, high-quality offline text-to-speech voices based on the [VITS](https://github.com/jaywalnut310/vits) neural architecture
* Accurate offline speech recognition using [OpenAI Whisper](https://openai.com/research/whisper) models
* Supports synthesis and recognition via major cloud providers, including Google, Microsoft and Amazon
* Word-level timestamps for all synthesis and recognition outputs
* Speech-to-transcript alignment using dynamic time warping (DTW), and dynamic time warping with recognition assist (DTW-RA) methods
* Advanced subtitle generation, accounting for sentence and phrase boundaries
* Can transcribe speech in any one of 98 languages, translated directly to English, and produce near word-level synchronized subtitles
* Uses NLP for improving TTS pronunciation accuracy on a few engines and languages: adds text normalization (e.g. idiomatic date and currency pronunciation), heteronym disambiguation (based on POS tagging) and user-customizable phonetic lexicons
* Internal package system to auto-download and install voices, models and other resources, as needed
* Other features include: language detection (both for audio and text), voice activity detection and speech denoising

### Planned, but not yet

* Real-time, streaming speech recognition
* WebSocket server API
* Web-based GUI frontend
* Browser port for a subset of the API (in particular for the offline TTS models and their dependencies)

## Installation

Ensure you have [Node.js](https://nodejs.org/) `v16.0.0` or later installed.

then:
```bash
npm install echogarden -g
```

Additional tools:
* [`sox`](https://sourceforge.net/projects/sox/): used for audio playback and recording only. Auto-installed via an expansion package on Windows and Intel macOS. On Linux and ARM64 macOS, it is recommended to install it via platform package managers like `apt` and `brew`.
* [`ffmpeg`](https://ffmpeg.org/download.html): used for codec conversions. Auto-installed via an expansion package on Windows, Intel macOS, and x64 Linux. On ARM64 macOS, it is recommended to install it via platform package manager like `brew`, otherwise, much slower `ffmpeg-wasm` would be used.

(hopefully in the future all platforms would be covered using expansion packages)

### Updating to latest version

```bash
npm update echogarden -g
```

## Next steps

* [Using the command line interface](docs/CLI.md)
* [Options reference](docs/Options.md)
* [Full list of supported engines](docs/Engines.md)
* [Technical overview and Q&A](docs/Technical.md)
* [Roadmap](docs/Roadmap.md)
* [How to help](docs/Development.md)

## Credits

This project consolidates and builds upon the work of [many different individuals and companies](docs/Licenses.md).

Designed and developed by Rotem Dan.

## License

GNU General Public License v3
