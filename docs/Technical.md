# Technical overview and Q&A

* Echogarden is written in TypeScript and targets the Node.js platform.
* It uses ESM modules and latest ECMAScript and TypeScript features.
* It does not depend on essential binary executables. Instead, all of its engines either use pure JavaScript, WebAssembly, WASI, or the ONNX runtime, with some exceptions: the CLI does invoke a command line `ffmpeg` tool, auto-downloaded from internal packages. Using expansion packages simplifies the installation and ensures non-buggy version are used. Since SoX `v14.4.2` is broken on Windows, it bundles `v14.4.1`.
* It does not depend on essential native node.js modules requiring install-time compilation with `node-gyp`. This greatly simplifies the installation experience for end-users (the ONNX runtime bundles precompiled NAPI modules for all supported platforms - it doesn't require any compilation during its installation).

## Package system

Echogarden uses its own package system to download and install various components as needed. These components can be TTS voices, STT models, or other types of models and data.

Packages are downloaded as `.tar.gz` files, and are extracted to `[data-folder]/packages/[package-name]`. Each package has its own subdirectory.

`[data-folder]` is located at:
* `%AppData%\Local\echogarden` on Windows
* `Users/User/Library/Application Support/echogarden` on macOS
* `/home/user/.local/share/echogarden` on Linux

By using downloadable packages, the installed size is made significantly smaller and the installation faster. The total size of all available packages is currently about 50GB (may not be up-to-date).

The packages are currently hosted and downloaded from a dedicated [Hugging Face repository](https://huggingface.co/echogarden/echogarden-packages).

## Can the base install size be made smaller?

The base installed (uncompressed) size, including dependencies, is around 270MB. This is without any models or voices, which are downloaded as needed.

Currently, the largest contributors to the size are:

* `onnxruntime-node` (NAPI): 133MB
* `kuromoji` (JavaScript) 40MB
* `flite-wasi` (WASI): 20MB
* `espeak-ng-emscripten` (WASM): 18MB

`onnxruntime-node` is large because it bundles pre-compiled binaries for multiple platforms. `kuromoji` is large because of its dictionary files and some unessential test code it bundles. The other three packages include large WASM binaries.

So, yes, in the future it may be possible to reduce the core installed size by dynamically installing some of these dependencies, or using modified, "slimmed-down" versions of some packages.

## Since the code is almost all JavaScript and WASM, why can't it just run in a web browser?

It is technically possible, overall, since its core components: `espeak-ng` and `onnxruntime` both have WASM ports. Actually, `onnxruntime-web`, unlike `onnxruntime-node` can also make use of the GPU via WebGL and WebGPU, which may give a performance boost for some users.

However, it is a lot of work, and only a subset of the engines can be supported (no cloud engines, in particular). There are several reasons why the web may not be the most effective platform for Echogarden:

* Significantly slower inference when using CPU for ONNX models
* No cross-domain network connectivity - can't connect to Google Cloud, Microsoft, Amazon etc. without a proxy
* Large initial download size would make it too heavy and slow to load as part of a standard web page directly
* Large memory requirement for the VITS models, starting at about 800MB - 1GB, which is a bit too much for a browser
* Due to the high code complexity, data size, and memory consumption, it is unlikely that a browser extension, internally bundling some of the models, would be accepted to the Chrome and Firefox web stores
* Will require a virtual file system to store models and make use of downloadable packages
* Requires duplicating a lot of prior work, porting many node.js-only APIs, and increasing code complexity
* Possibly lots of issues with inconsistent browser support and browser security constraints
* Not future-proof. Due to changing restrictions of browsers, the runtime environment is not guaranteed be reliably reproducible in the future, meaning that it may need continuous maintenance to ensure it keeps working on the newest browsers

It remains to be seen if this sort of work would feel justified somehow. I designed the tool to make the local installation extremely easy and issue-free. I guess it could look "impressive" to be able to run it in a browser, and may become as a nice "toy" or "tech-demo", and could get some attention, but it may eventually turn out to be simpler and more practical to just install a local instance and connect to it from the browser via a WebSocket API.

A TTS-only browser extension is in development. It registers Echogarden's voices on the browser's Web Speech API using the [`chrome.ttsEngine`](https://developer.chrome.com/docs/extensions/reference/ttsEngine/) extension API and communicates with it using the WebSocket API

## Why can't I use `stdin` and `stdout` to pipe into and out from the CLI app?

I don't think that `stdin` and `stdout` are able to capture the type of complex, multi-message, bidirectional communication that is needed for a full speech processing service. When the WebSocket server is released, it will fulfill all these needs, and more. It would provide a uniform interface for all external clients, and would also be launched and used internally by the CLI itself. It would enable the CLI to do complex asynchronous and parallel operations it can't currently do, like transcribing a live input while text is written to the terminal and audio is played, processed and transmitted, all at the same time.

## Why does the CLI use `--option=value` and not `--option value` syntax?

I would have allowed `--option value` if I could. The reason `--option=value` syntax is used is because the options are defined using an auto-generated schema, which is different for each operation. This means I don't know ahead of time which options require an extra value, like `--voice Bob`, and which don't, like `--play`, at the time the command line is parsed. This makes it difficult to intersperse switches and inputs/outputs like `echogarden speak "Hello" --play output.mp3 --voice Bob`.

In order to support a syntax like `--option value` I will need to parse the command line separately for each operation, but then it would be difficult to share common options between all of them.

Also, `option=value` is more similar to the syntax used in the configuration file, which makes it more consistent, and since the CLI accepts arbitrary numbers of free arguments, it helps prevent confusion on whether an argument is related to an option or a free one.

## Code organization

* `src`: TypeScript source code
* `dist`: compiled JavaScript modules
* `data`: various data files, including phonetic lexicons and language code conversion tables. `data/schemas` stores JSON schemas for all configuration options, auto-generated using [`ts-json-schema-generator`](https://github.com/vega/ts-json-schema-generator) directly from the TypeScript code, and used by the CLI to parse and validate the options provided
* `docs`: documentation
