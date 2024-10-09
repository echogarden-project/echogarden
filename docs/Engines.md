
# Supported engines

## Text-to-speech

**Offline**:

* [VITS](https://github.com/jaywalnut310/vits) (`vits`): end-to-end neural speech synthesis architecture. Available models were trained by Michael Hansen as part of his [Piper speech synthesis system](https://github.com/rhasspy/piper). Currently, there are 123 voices, in a range of languages, including English (US, UK), Spanish (ES, MX), Portuguese (PT, BR), Italian, French, German, Dutch (NL, BE), Swedish, Norwegian, Danish, Finnish, Polish, Greek, Romanian, Serbian, Czech, Hungarian, Slovak, Slovenian, Turkish, Arabic, Farsi, Russian, Ukrainian, Catalan, Luxembourgish, Icelandic, Swahili, Kazakh, Georgian, Nepali, Vietnamese and Chinese. You can listen to audio samples of all voices and languages in [Piper's samples page](https://rhasspy.github.io/piper-samples/)
* [SVOX Pico](https://github.com/naggety/picotts) (`pico`): a legacy diphone-based synthesis engine. Supports English (US, UK), Spanish, Italian, French, and German
* [Flite](https://github.com/festvox/flite) (`flite`): a legacy diphone-based synthesis engine. Supports English (US, Scottish), and several Indic languages: Hindi, Bengali, Marathi, Telugu, Tamil, Gujarati, Kannada and Punjabi
* [eSpeak-NG](https://github.com/espeak-ng/espeak-ng/) (`espeak`): a lightweight "robot" sounding formant-based synthesizer. Supports 100+ languages. Used internally for speech alignment, phonemization, and other internal tasks
* [SAM (Software Automatic Mouth)](https://github.com/discordier/sam) (`sam`): a classic "robot" speech synthesizer from 1982. English only

**Offline, Windows only**:

* [SAPI](https://en.wikipedia.org/wiki/Microsoft_Speech_API) (`sapi`): Microsoft Speech API. Supports the system's language voices, as well as legacy voices produced by third-party vendors, like Ivona, NeoSpeech, Acapela, Cepstral, CereProc, Nuance, AT&T, Loquendo, ScanSoft and others (note that only 64-bit SAPI voices are supported, which makes it incompatible with a significant portion of older voices)

* [Microsoft Speech Platform](https://www.microsoft.com/en-us/download/details.aspx?id=27225) (`msspeech`): Microsoft Server Speech API. Requires [installing a runtime (2.6MB)](https://www.microsoft.com/en-us/download/details.aspx?id=27225). Supports 28 dialects, which can be individually downloaded via [freely available installers](https://www.microsoft.com/en-us/download/details.aspx?id=27224), or, for convenience, bundled as [a single 358MB zip file](https://drive.google.com/u/0/uc?id=1uQdFNxLzUxpaEwVVKhMawys8cIh3F21T&export=download). Has voices for English (US, UK, AU, CA), Spanish (ES, MX), Portuguese (BR, PT), German, French (FR, CA), Italian, Norwegian, Dutch, Russian, Swedish, Danish, Catalan, Finnish, Japanese, Korean and Chinese (ZH, HK, TW). All voices are female

**Note**: both these engines require manually installing the [`winax` npm package](https://www.npmjs.com/package/winax) by running `npm install winax -g`.

`winax` is a native module which requires the Node.js Windows build tools to successfully install. If you have issues installing this package, please ensure that you've checked the "install necessary tools" checkbox during the installation of Node.js.

**Client for self-hosted or remote servers**:

* [Coqui TTS](https://github.com/coqui-ai/TTS) server (`coqui-server`)

**Cloud services**:

These are commercial services that require a subscription and an API key to use:

* [Google Cloud](https://cloud.google.com/text-to-speech) (`google-cloud`)
* [Azure Cognitive Services](https://azure.microsoft.com/en-us/products/ai-services/text-to-speech/) (`microsoft-azure`)
* [Amazon Polly](https://aws.amazon.com/polly/) (`amazon-polly`)
* [OpenAI Cloud Platform](https://platform.openai.com/) (`openai-cloud`)
* [Elevenlabs](https://elevenlabs.io/) (`elevenlabs`)

**Cloud services (unofficial)**:

These cloud-based engines connect to public cloud APIs that are not officially publicized by their operators. They are included for educational purposes only, and may be removed in the future:

* Google Translate (`google-translate`): used by the [Google Translate web UI](https://translate.google.com/) to speak written text in any one of its supported languages. Offers a single voice for each language (usually female)
* Microsoft Edge (`microsoft-edge`): subset of the Azure Cognitive Services cloud TTS API used by the Microsoft Edge browser as part of its support for the [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) and its [Read Aloud](https://www.microsoft.com/en-us/edge/features/read-aloud?form=MT00D8) feature. Using this engine requires a special token, which should be passed via the `microsoftEdge.trustedClientToken` option
* Streamlabs Polly (`streamlabs-polly`): a public REST API by Streamlabs, primarily intended for generating speech for TTS donations. It includes a few English (US, UK, AU, IN) voices, which are similar to some of the non-neural (Ivona-based) voices offered by Amazon Polly (**Note**: as of April 2024, the public Streamlabs Polly REST API doesn't seem to be accessible anymore)

## Speech-to-text

**Offline**:
* [OpenAI Whisper](https://github.com/openai/whisper) (`whisper`): high-accuracy transformer-based speech recognition architecture. TypeScript implementation, with inference done via the [ONNX runtime](https://onnxruntime.ai/). Supports [98 languages](https://platform.openai.com/docs/guides/speech-to-text/supported-languages). There are several models of different sizes, some are multilingual, and some are English only: `tiny`, `tiny.en`, `base`, `base.en`, `small`, `small.en`, `medium`, `medium.en`, `large`, `large-v1` and `large-v2`, `large-v3`. **Note**: large models are not currently supported by `onnxruntime-node` due to model size restrictions
* [Whisper.cpp](https://github.com/ggerganov/whisper.cpp) (`whisper.cpp`): a C++ port of the Whisper architecture by Georgi Gerganov. Supports all Whisper models, including several quantized ones (see full model list in the [options reference](docs/Options.md)). Has various builds, including CUDA and OpenCL for GPU support
* [Vosk](https://github.com/alphacep/vosk-api) (`vosk`): models available for 25+ languages. **Note**: the Vosk package is not included in the default installation, but you can add support for it using `npm install @echogarden/vosk -g`. Then, you'll need to manually [download a model](https://alphacephei.com/vosk/models) and specify its directory path via the `vosk.modelPath` option
* [Silero](https://github.com/snakers4/silero-models) (`silero`): models available for English, Spanish, German and Ukrainian. For [non-commercial use only](https://github.com/snakers4/silero-models/blob/master/LICENSE)

**Cloud services**:

These are commercial services that require a subscription and an API key to use:

* [Google Cloud](https://cloud.google.com/speech-to-text) (`google-cloud`)
* [Azure Cognitive Services](https://azure.microsoft.com/en-us/products/ai-services/speech-to-text/) (`microsoft-azure`)
* [Amazon Transcribe](https://aws.amazon.com/transcribe/) (`amazon-transcribe`)
* [OpenAI Cloud Platform](https://platform.openai.com/) (`openai-cloud`): runs the `large-v2` Whisper model on the cloud. Allows setting a custom provider, like [Groq](https://console.groq.com/docs/api-reference#audio), to request from any OpenAI-compatible provider

## Speech-to-transcript alignment

These engines' goal is to match (or "align") a given spoken recording with a given transcript as closely as possible. They will annotate each word in the transcript with approximate start and end timestamps:

* Dynamic Time Warping (`dtw`): transcript is first synthesized using the eSpeak engine, then the [DTW](https://en.wikipedia.org/wiki/Dynamic_time_warping) sequence alignment algorithm is applied to find the best mapping between the synthesized and original audio frames
* Dynamic Time Warping with Recognition Assist (`dtw-ra`): recognition is applied to the audio (any recognition engine can be used), then both the ground-truth transcript and the recognized transcript are synthesized using eSpeak. Then, the best mapping is found between the two synthesized waveforms, using the DTW algorithm, and the result is remapped back to the original audio using the timing information produced by the recognizer
* Whisper-based alignment (`whisper`): transcript is first tokenized, then, its tokens are decoded, in order, with a guided approach, using the Whisper model. The resulting token timestamps are then used to derive the timing for each word

## Speech-to-text translation

**Offline**:
* [Whisper](https://github.com/openai/whisper) (`whisper`): the Whisper model can recognize speech in any one of its supported languages and output a transcript directly translated to English. Other languages are not supported as targets
* [Whisper.cpp](https://github.com/ggerganov/whisper.cpp) (`whisper.cpp`): supports translation to English

**Cloud services**:
* [OpenAI Cloud Platform](https://platform.openai.com/) (`openai-cloud`): runs the `large-v2` Whisper model on the cloud. Only supports English as target

## Text-to-text translation

**Cloud services (unofficial)**:

* Google Translate (`google-translate`): uses the [Google Translate mobile web UI](https://translate.google.com/m) to translate text from and to any one of its 243 supported languages.

## Speech-to-translated-transcript alignment

The goal here is to match (or "align") a given spoken recording in one language, with a given translated transcript in a different language, as closely as possible.

* `whisper`: given a spoken recording in any of the [98 languages](https://platform.openai.com/docs/guides/speech-to-text/supported-languages) supported by Whisper, and an English translation of its transcript, the translated transcript is tokenized and then decoded, in order, using a guided approach, with any multilingual Whisper model, set to its `translate` task mode. In this way, the approximate mapping between the spoken audio and each word of the translation is estimated

## Speech-to-transcript-and-translation alignment

This is a two-stage approach for translation alignment, that can accept about 100 source and target languages:

1. First, the spoken audio is aligned with the native language transcript
2. Then, the resulting timeline is aligned with the translated text using semantic text-to-text alignment

This approach is potentially faster than the single-stage one, because the first stage can use any alignment approach, including the default synthesis-based `dtw` engine, which is much faster than running a full speech recognition engine like Whisper.

The second stage uses a multilingual text embedding model (currently defaults to [multilingual E5](https://huggingface.co/intfloat/multilingual-e5-base)) to produce a vector representation of both the transcript and the translated text tokens. Then, it applies DTW over the two vector sequences to align the tokens of the two languages. Since this stage works on tokens only (the audio is not involved), it is generally fast.

In terms of accuracy, the two-stage approach can be more accurate than the alignment derived from the Whisper model in the one-stage approach, especially when compared to using the smaller Whisper models like `tiny` or `base`, and for source languages that Whisper generally isn't very good at, like Chinese, Japanese, and less common languages.

For a non-English target language, this approach is currently the only one that can be used.

## Timeline-to-translation alignment

Aligns a timeline with a translation of its text. Does not involve the spoken audio itself.

This is used for the second stage of the two-stage approach described above. It can also be used independently. It allows to reuse the same timeline to align with multiple translations, in different languages, without needing to redo the native-language alignment each time.

Another use case it to take a timeline produced as part of synthesized or recognized speech and then align it with one or more translations of its text.

* [`E5`](https://huggingface.co/intfloat/multilingual-e5-base) (`e5`): E5 is a multilingual text embedding model by Microsoft, supporting 100 languages. This model encodes sequences of text tokens to vectors, in such a way that words with similar meanings in different languages are mapped to similar vectors. This cross-language semantic vector encoding is then used for aligning the tokens between the timeline and the translation. Then, the translated words are mapped to the timestamps of the corresponding words in the timeline.

## Language detection

**Spoken language detection**:
* [Whisper](https://github.com/openai/whisper) (`whisper`): uses the language token produced by the `whisper` speech recognition model to generate a set of probabilities for the [98 languages](https://platform.openai.com/docs/guides/speech-to-text/supported-languages) it has been trained on
* [Silero Language Classifier](https://github.com/snakers4/silero-vad/wiki/Other-Models) (`silero`): a speech language classification model by Silero

**Text language detection**:
* [TinyLD](https://www.npmjs.com/package/tinyld) (`tinyld`): a simple language detection library
* [FastText](https://github.com/facebookresearch/fastText) (`fasttext`): a library for word representations and sentence classification by Facebook research

## Voice activity detection

* [WebRTC VAD](https://github.com/dpirch/libfvad) (`webrtc`): a voice activity detector. Originally from the Chromium browser source code
* [Silero VAD](https://github.com/snakers4/silero-vad) (`silero`): a voice activity detection model by Silero.
* [RNNoise](https://github.com/xiph/rnnoise) (`rnnoise`): uses RNNoise's speech probabilities output for each audio frame as a VAD metric
* Adaptive Gate (`adaptive-gate`): uses a band-limited adaptive gate to identify activity in the lower voice frequencies. Reliable, but will often pass non-vocal sounds if they are loud enough. Good for clean speech and a cappella singing, where most non-vocal segments are quiet

## Speech denoising

* [RNNoise](https://github.com/xiph/rnnoise) (`rnnoise`): a noise suppression library based on a recurrent neural network

## Source separation

* [MDX-NET](https://github.com/kuielab/mdx-net) (`mdx-net`): deep learning source separation architecture by [KUIELAB (Korea University)](https://kuielab.github.io/)
