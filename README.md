# Echogarden

Echogarden is an easy-to-use speech toolset that includes a variety of speech processing tools.

* Easy to install, run, and update
* Runs on Windows (x64, ARM64), macOS (x64, ARM64) and Linux (x64, ARM64)
* Written in TypeScript, for the Node.js runtime
* Doesn't require Python, Docker, or other system-level dependencies
* Doesn't rely on essential platform-specific binaries. Engines are either ported via WebAssembly, imported using the [ONNX runtime](https://onnxruntime.ai/), or written in pure JavaScript

## Features

* **Text-to-speech** using the [VITS](https://github.com/jaywalnut310/vits) neural architecture, and [15 other offline and online engines](docs/Engines.md), including cloud services by [Google](https://cloud.google.com/text-to-speech), [Microsoft](https://azure.microsoft.com/en-us/products/ai-services/text-to-speech/), [Amazon](https://aws.amazon.com/polly/), [OpenAI](https://platform.openai.com/) and [Elevenlabs](https://elevenlabs.io/)
* **Speech-to-text** using a built-in JavaScript/ONNX port of the [OpenAI Whisper](https://openai.com/research/whisper) speech recognition architecture, [whisper.cpp](https://github.com/ggerganov/whisper.cpp), and [several other engines](docs/Engines.md), including cloud services by [Google](https://cloud.google.com/speech-to-text), [Microsoft](https://azure.microsoft.com/en-us/products/ai-services/speech-to-text/), [Amazon](https://aws.amazon.com/transcribe/) and [OpenAI](https://platform.openai.com/)
* **Speech-to-transcript alignment** using several variants of [dynamic time warping](https://en.wikipedia.org/wiki/Dynamic_time_warping) (DTW, DTW-RA), including support for multi-pass (hierarchical) processing, or via guided decoding using Whisper recognition models. Supports 100+ languages
* **Speech-to-text translation**, translates speech in any of the [98 languages](https://platform.openai.com/docs/guides/speech-to-text/supported-languages) supported by Whisper, to English, with near word-level timing for the translated transcript
* **Speech-to-translated-transcript alignment** synchronizes spoken audio in one language, to a provided English-translated transcript, using the Whisper engine
* **Speech-to-transcript-and-translation alignment** synchronizes spoken audio in one language, to a translation in a variety of other languages, given both a transcript and its translation
* **Text-to-text translation**, translates text between various languages. Supports cloud-based Google Translate engine
* **Language detection** identifies the language of a given audio or text. Includes Whisper or [Silero](https://github.com/snakers4/silero-vad/wiki/Other-Models) engines for spoken audio, and [TinyLD](https://www.npmjs.com/package/tinyld) or [FastText](https://github.com/facebookresearch/fastText) for text
* **Voice activity detection** attempts to identify segments of audio where voice is active or inactive. Includes [WebRTC VAD](https://github.com/dpirch/libfvad), [Silero VAD](https://github.com/snakers4/silero-vad), [RNNoise-based VAD](https://github.com/xiph/rnnoise) and a built-in Adaptive Gate algorithm
* **Speech denoising** attenuates background noise from spoken audio. Includes the [RNNoise](https://github.com/xiph/rnnoise) and [NSNet2](https://github.com/NeonGeckoCom/nsnet2-denoiser) engines
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

### Updating to latest version

```bash
npm update echogarden -g
```

## Using the command-line interface

A small sample of command lines:
```bash
echogarden speak "Hello World!"
echogarden speak-file story.txt
echogarden transcribe speech.mp3
echogarden align speech.opus transcript.txt
echogarden isolate speech.wav
```

See the [Command-line interface guide](docs/CLI.md) for more details on the operations supported, and the [configuration options reference](docs/Options.md) for a comprehensive list of all options supported.

**Note**: on `v2.0.0`, a [newly developed audio playback library](https://github.com/echogarden-project/audio-io) was integrated to the CLI interface. If you're having trouble hearing sound, or the sound is distorted, please [report this as an issue](https://github.com/echogarden-project/audio-io/issues). You can switch back to the older [SoX](https://sourceforge.net/projects/sox/) based player by adding `--player=sox` to the command-line. On macOS, you'll need to ensure SoX is installed in path by installing it with a system package manager like [Homebrew](https://brew.sh/) (`brew install sox`).

## Using the Node.js API

If you are a developer, you can also [import the package as a module](docs/API.md). The API operations and options closely mirror the CLI.

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
