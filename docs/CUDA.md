# How to enable the `cuda` ONNX execution provider

On Linux, or the Windows Subsystem for Linux (WSL), you can enable CUDA-based GPU acceleration for a number of engines, by selecting the `cuda` ONNX execution provider.

Engines where CUDA is supported include:
* `kokoro` (speech synthesis)
* `vits` (speech synthesis)
* `whisper` (speech recognition)
* `silero` (speech recognition)
* `mdx-net` (voice isolation)

## Steps
* Download and globally install [CUDA Toolkit 12.x](https://developer.nvidia.com/cuda-downloads) based on the instructions in the linked download page.
* Download and globally install [cuDNN 9.x](https://developer.nvidia.com/cudnn-downloads) based on the instructions in the linked download page.
* Reinstall Echogarden

Reinstallation is needed because the `onnxruntime-node` package runs a post-install script that attempts to detect the global installation of CUDA, and then conditionally downloads additional files required for it to work.
