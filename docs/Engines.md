
# Supported engines

## Text to speech

**Offline**:
* [VITS](https://github.com/jaywalnut310/vits) (`vits`): a high-quality end-to-end neural speech synthesis architecture. Available models were trained by Michael Hansen as part of his [Piper speech synthesis system](https://github.com/rhasspy/piper). Currently there are 83 voices, in a range of languages, including English (US, UK), Spanish (ES, MX), Brazilian Portuguese, Italian, French, German, Dutch (NL, BE), Swedish, Norwegian, Danish, Finnish, Polish, Greek, Russian, Ukrainian, Catalan, Icelandic, Swahili, Kazakh, Georgian, Nepali, Vietnamese and Chinese. You can listen to audio samples of all voices and languages in [Piper's samples page](https://rhasspy.github.io/piper-samples/).
* [SVOX Pico](https://github.com/naggety/picotts) (`pico`): a legacy diphone-based synthesis engine. Supports English (US, UK), Spanish, Italian, French, and German.
* [Flite](https://github.com/festvox/flite) (`flite`): a legacy diphone-based synthesis engine. Supports English (US, Scottish), and several Indic languages: Hindi, Bengali, Marathi, Telugu, Tamil, Gujarati, Kannada and Punjabi.
* [eSpeak-NG](https://github.com/espeak-ng/espeak-ng/) (`espeak`): a lightweight "robot" sounding formant-based synthesizer. Supports 100+ languages. Extensively used internally for speech alignment, phonemization, and other internal tasks.
* [SAM (Software Automatic Mouth)](https://github.com/discordier/sam) (`sam`): a classic "robot" speech synthesizer from 1982. English only.

**Offline, Windows only**:

* [SAPI](https://en.wikipedia.org/wiki/Microsoft_Speech_API) (`sapi`): Microsoft Speech API. Supports the system's language voices, as well as legacy voices produced by third-party vendors, like Ivona, NeoSpeech, Acapela, Cepstral, CereProc, Nuance, AT&T, Loquendo, ScanSoft and others (note that only 64-bit SAPI voices are supported, which makes it incompatible with a significant portion of older voices).

* [Microsoft Speech Platform](https://www.microsoft.com/en-us/download/details.aspx?id=27225) (`msspeech`): Microsoft Server Speech API. Requires [installing a runtime (2.6MB)](https://www.microsoft.com/en-us/download/details.aspx?id=27225). Supports 28 dialects, which can be individually downloaded via [freely available installers](https://www.microsoft.com/en-us/download/details.aspx?id=27224), or, for convenience, bundled as [a single 358MB zip file](https://drive.google.com/u/0/uc?id=1uQdFNxLzUxpaEwVVKhMawys8cIh3F21T&export=download). Has voices for English (US, UK, AU, CA), Spanish (ES, MX), Portuguese (BR, PT), German, French (FR, CA), Italian, Norwegian, Dutch, Russian, Swedish, Danish, Catalan, Finnish, Japanese, Korean and Chinese (ZH, HK, TW). All voices are female.

_Note_: both these engines require manually installing the [`winax` npm package](https://www.npmjs.com/package/winax) by running `npm install winax -g`.

`winax` is a native module which requires the Node.js Windows build tools to successfully install. If you have issues installing this package, please ensure that you've checked the "install necessary tools" checkbox during the installation of node.js.

**Client for remote or self-hosted servers**:
* [Coqui TTS](https://github.com/coqui-ai/TTS) server (`coqui-server`)

**Cloud services**:

These are commercial services that require a subscription and an API key to use:

* [Google Cloud](https://cloud.google.com/text-to-speech) (`google-cloud`)
* [Azure Cognitive Services](https://azure.microsoft.com/en-us/products/cognitive-services/text-to-speech/) (`microsoft-azure`)
* [Amazon Polly](https://aws.amazon.com/polly/) (`amazon-polly`)
* [Elevenlabs](https://elevenlabs.io/) (`elevenlabs`)

**Cloud services (unofficial)**:

These cloud-based engines connect to public-facing cloud APIs that are not officially publicized by their operators. They are included for educational purposes only, and may be removed in the future:

* Google Translate (`google-translate`): used by the [Google Translate web UI](https://translate.google.com/) to speak written text in any one of its supported languages. Offers a single voice for each language (usually female).
* Microsoft Edge (`microsoft-edge`): subset of the Azure Cognitive Services cloud TTS API used by the Microsoft Edge browser as part of its support for the [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) and its [Read Aloud](https://www.microsoft.com/en-us/edge/features/read-aloud?form=MT00D8) feature. Using this engine requires a special token, which should be passed via the `microsoftEdge.trustedClientToken` option.
* Streamlabs Polly (`streamlabs-polly`): a public REST API by Streamlabs, primarily intended for generating speech for TTS donations. It includes a few English (US, UK, AU, IN) voices, which are similar to some of the non-neural (Ivona-based) voices offered by Amazon Polly.

## Speech to text

**Offline**:
* [OpenAI Whisper](https://github.com/openai/whisper) (`whisper`): high accuracy transformer-based architecture. Supports 99 languages. There are several models of different sizes, some are multilingual, and some are English only (`.en`): `tiny`, `tiny.en`, `base`, `base.en`, `small`, `small.en`, `medium`, `medium.en`, `large`, `large-v1` and `large-v2`. _Note_: large models are not currently auto-downloaded as Echogarden packages, but may become available in the future.
* [Vosk](https://github.com/alphacep/vosk-api) (`vosk`): models available for 25+ languages. _Note_: the Vosk package is not included in the default installation, but you can add support for it using `npm install @echogarden/vosk -g`. You'll need to manually [download a model](https://alphacephei.com/vosk/models) and specify its directory path via the `vosk.modelPath` option.
* [Silero](https://github.com/snakers4/silero-models) (`silero`): models available for English, Spanish, German and Ukrainian. For [non-commercial use only](https://github.com/snakers4/silero-models/blob/master/LICENSE).

**Cloud services**:

These are commercial services that require a subscription and an API key to use:

* [Google Cloud](https://cloud.google.com/speech-to-text) (`google-cloud`)
* [Azure Cognitive Services](https://azure.microsoft.com/en-us/products/cognitive-services/speech-to-text/) (`microsoft-azure`)
* [Amazon Transcribe](https://aws.amazon.com/transcribe/) (`amazon-transcribe`)

## Speech to transcript alignment

These engines' goal is to match (or "align") a given spoken recording with a given transcript as closely as possible. They will annotate each word in the transcript with approximate start and end timestamps:

* Dynamic Time Warping (`dtw`): transcript is first synthesized using the eSpeak engine, then [DTW](https://en.wikipedia.org/wiki/Dynamic_time_warping) is applied to find the best mapping between the synthesized audio and the original audio.
* Dynamic Time Warping with Recognition Assist (`dtw-ra`): recognition is applied to the audio (any recognition engine can be used), then both the ground-truth transcript and the recognized transcript are synthesized using eSpeak. Then, the best mapping is found between the two synthesized audio sequences, and the result is mapped back to the original audio using the timing information produced by the recognizer.
* Whisper-based alignment (`whisper`): transcript is tokenized and decoded along with the audio using the Whisper model, then timestamps are extracted from the internal state of the model (_note_: currently, only supports audio inputs that are 30 seconds or less).

## Speech translation

* [Whisper](https://github.com/openai/whisper) (`whisper`): the Whisper model can transcribe speech in any one of its supported languages and output a transcript directly translated to English. Other languages are not supported as targets.

## Language detection

**Spoken language detection**:
* [Silero Language Classifier](https://github.com/snakers4/silero-vad/wiki/Other-Models) (`silero`): a speech language classification model by Silero.
* [Whisper](https://github.com/openai/whisper) (`whisper`): uses the language token produced by the `whisper` speech recognition model to generate a set of probabilities for the 99 languages it has been trained on (_note_: currently only uses the first 30 seconds of the audio).

**Text language detection**:
* [TinyLD](https://www.npmjs.com/package/tinyld) (`tinyld`): a simple language detection library.
* [FastText](https://github.com/facebookresearch/fastText) (`fasttext`): a library for word representations and sentence classification by Facebook research.

## Voice activity detection

* [WebRTC VAD](https://github.com/dpirch/libfvad) (`webrtc`): a voice activity detector. Originally from the Chromium browser source code.
* [Silero VAD](https://github.com/snakers4/silero-vad) (`silero`): a voice activity detection model by Silero.
* [RNNoise](https://github.com/xiph/rnnoise) (`rnnoise`): uses RNNoise's speech probabilities output for each audio frame as a VAD metric.

## Speech denoising

* [RNNoise](https://github.com/xiph/rnnoise) (`rnnoise`): a noise suppression library based on a recurrent neural network.
