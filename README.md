# Echogarden

Echogarden is an easy-to-use speech toolset that includes a variety of speech processing tools.

* Easy to install, run, and update
* Runs on Windows (x64), macOS (x64, ARM64) and Linux (x64, ARM64)
* Written in TypeScript, for the Node.js runtime
* Doesn't require Python, Docker, or other system-level dependencies
* Doesn't rely on essential platform-specific binaries. Engines are either ported via WebAssembly, imported using the [ONNX runtime](https://onnxruntime.ai/), or written in pure JavaScript

## Features

* **Text-to-speech** using the [VITS](https://github.com/jaywalnut310/vits) neural architecture, and [15 other offline and online engines](docs/Engines.md), including cloud services by [Google](https://cloud.google.com/text-to-speech), [Microsoft](https://azure.microsoft.com/en-us/products/ai-services/text-to-speech/), [Amazon](https://aws.amazon.com/polly/), [OpenAI](https://platform.openai.com/) and [Elevenlabs](https://elevenlabs.io/)
* **Speech-to-text** using [OpenAI Whisper](https://openai.com/research/whisper), and [several other engines](docs/Engines.md), including cloud services by [Google](https://cloud.google.com/speech-to-text), [Microsoft](https://azure.microsoft.com/en-us/products/ai-services/speech-to-text/), [Amazon](https://aws.amazon.com/transcribe/) and [OpenAI](https://platform.openai.com/)
* **Speech-to-transcript alignment** using several variants of [dynamic time warping](https://en.wikipedia.org/wiki/Dynamic_time_warping) (DTW, DTW-RA), including support for multi-pass (hierarchical) processing, or via guided decoding using Whisper recognition models. Supports 100+ languages
* **Speech-to-text translation**, translates speech in any of the [98 languages](https://platform.openai.com/docs/guides/speech-to-text/supported-languages) supported by Whisper, to English, with near word-level timing for the translated transcript
* **Speech-to-translated-transcript alignment** attempts to synchronize spoken audio in one language, to a provided English-translated transcript, using the Whisper engine
* **Language detection** identifies the language of a given audio or text. Provides Whisper or [Silero](https://github.com/snakers4/silero-vad/wiki/Other-Models) engines for audio, and [TinyLD](https://www.npmjs.com/package/tinyld) or [FastText](https://github.com/facebookresearch/fastText) for text
* **Voice activity detection** attempts to identify segments of audio where voice is active or inactive. Includes [WebRTC VAD](https://github.com/dpirch/libfvad), [Silero VAD](https://github.com/snakers4/silero-vad), [RNNoise-based VAD](https://github.com/xiph/rnnoise) and a custom Adaptive Gate
* **Speech denoising** attenuates background noise from spoken audio. Includes the [RNNoise](https://github.com/xiph/rnnoise) engine
* **Source separation** isolates voice from any music or background ambience. Supports the [MDX-NET](https://github.com/kuielab/mdx-net) deep learning architecture
* **Word-level timestamps** for all recognition, synthesis, alignment and translation outputs
* Advanced **subtitle generation**, accounting for sentence and phrase boundaries
* For the VITS and eSpeak-NG synthesis engines, includes **enhancements to improve TTS pronunciation accuracy**: adds text normalization (e.g. idiomatic date and currency pronunciation), heteronym disambiguation (based on a rule-based model) and user-customizable pronunciation lexicons
* **Internal package system** that auto-downloads and installs voices, models and other resources, as needed

## Installation

Ensure you have [Node.js](https://nodejs.org/) `v18.16.0` or later installed.

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

## Using the toolset

Tools are accessible via a [command-line interface](docs/CLI.md), which enables powerful customization and is especially useful for long-running bulk operations.

Development of more graphical and interactive tooling is [planned](https://github.com/echogarden-project/echogarden/issues/28). A text-to-speech browser extension is currently under development (but not released yet).

If you are a developer, you can also [import the package as a module](docs/API.md) or [interface with it via a local WebSocket service](docs/Server.md) (currently experimental).

## Documentation

* [Quick guide to the command-line interface](docs/CLI.md)
* [Options reference](docs/Options.md)
* [Full list of supported engines](docs/Engines.md)
* [Node.js API reference](docs/API.md)
* [Technical overview and Q&A](docs/Technical.md)
* [How to help](docs/Contributing.md)
* [Setting up a development environment](docs/Development.md)
* [Developer's task list](docs/Tasklist.md)
* [Release notes (for releases up to `1.0.0`)](docs/Releases.md)

## Credits

This project consolidates, and builds upon the effort of many different individuals and companies, as well as contributing a number of original works.

Developed by Rotem Dan (IPA: /ˈʁɒːtem ˈdän/).

## License

GNU General Public License v3

Licenses for components, models and other dependencies are detailed on [this page](docs/Licenses.md).
