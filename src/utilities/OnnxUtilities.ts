import type * as Onnx from 'onnxruntime-node'

export function getOnnxSessionOptions(options: OnnxSessionOptions) {
	const onnxOptions: Onnx.InferenceSession.SessionOptions = {
		executionProviders: ['cpu'],
		logSeverityLevel: 3,
	}

	if (options) {
		if (options.executionProviders != null) {
			let executionProviders = options.executionProviders.filter(provider => {
				if (!provider) {
					return false
				}

				if (provider === 'dml' && !dmlProviderAvailable()) {
					return false
				}

				return true
			})

			if (!executionProviders.includes('cpu')) {
				executionProviders.push('cpu')
			}

			executionProviders = Array.from(new Set(executionProviders))

			onnxOptions.executionProviders = executionProviders as any
		} else if (options.enableGPU === true && dmlProviderAvailable()) {
			onnxOptions.executionProviders = ['dml', 'cpu']
		}

		if (options.logSeverityLevel != null) {
			onnxOptions.logSeverityLevel = options.logSeverityLevel
		}
	}

	return onnxOptions
}

export function makeOnnxLikeFloat32Tensor(onnxTensor: Onnx.Tensor): OnnxLikeFloat32Tensor {
	return {
		data: (onnxTensor.data as Float32Array).slice(),
		dims: onnxTensor.dims.slice()
	}
}

export function dmlProviderAvailable() {
	const platform = process.platform
	const arch = process.arch

	return platform === 'win32' && arch === 'x64'
}

export interface OnnxLikeFloat32Tensor {
	readonly data: Float32Array
	readonly dims: number[]
}

export interface OnnxSessionOptions {
	enableGPU?: boolean
	executionProviders?: OnnxExecutionProvider[]
	logSeverityLevel?: 0 | 1 | 2 | 3 | 4
}

export type OnnxExecutionProvider = 'cpu' | 'dml' | 'cuda'
