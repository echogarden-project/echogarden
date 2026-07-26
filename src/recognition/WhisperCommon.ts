import { getShortLanguageCode } from '../utilities/Locale.js'
import { loadPackage, LoadPackageCallbacks } from '../utilities/PackageManager.js'
import { joinPath } from '../utilities/PathUtilities.js'

export async function loadModelPackage(quantizedModelId: WhisperQuantizedModelId | undefined, languageCode: string | undefined, callbacks: LoadPackageCallbacks) {
	if (quantizedModelId === 'large') {
		quantizedModelId = 'large-v2'
	}

	if (quantizedModelId) {
		const modelName = getShortModelIdFromWhisperCppModelId(quantizedModelId)

		if (languageCode != 'en' && modelName.endsWith('.en')) {
			throw new Error(`The English-only model '${modelName}' cannot be used with a non-English language '${languageCode}'.`)
		}
	} else {
		if (languageCode) {
			const shortLanguageCode = getShortLanguageCode(languageCode)

			quantizedModelId = shortLanguageCode == 'en' ? 'base.en' : 'base'
		} else {
			quantizedModelId = 'base'
		}
	}

	const packageName = `whisper.cpp-${quantizedModelId}`
	const modelDir = await loadPackage(packageName, callbacks)
	const modelPath = joinPath(modelDir, `ggml-${quantizedModelId}.bin`)
	const modelId = getShortModelIdFromWhisperCppModelId(quantizedModelId)

	return { modelId, modelPath }
}

function getShortModelIdFromWhisperCppModelId(quantizedModelId: WhisperQuantizedModelId): WhisperModelId {
	if (quantizedModelId.startsWith('large-v1')) {
		return 'large-v1'
	}

	if (quantizedModelId.startsWith('large-v2')) {
		return 'large-v2'
	}

	if (quantizedModelId.startsWith('large-v3-turbo')) {
		return 'large-v3-turbo'
	}

	if (quantizedModelId.startsWith('large-v3')) {
		return 'large-v3'
	}

	const lastDashIndex = quantizedModelId.lastIndexOf('-')

	let modelName: string

	if (lastDashIndex >= 0) {
		modelName = quantizedModelId.substring(0, lastDashIndex) as WhisperModelId
	} else {
		modelName = quantizedModelId
	}

	return modelName as WhisperModelId
}

export type WhisperModelId =
	'tiny' |
	'tiny.en' |

	'base' |
	'base.en' |

	'small' |
	'small.en' |

	'medium' |
	'medium.en' |

	'large-v1' |
	'large-v2' |
	'large-v3' |
	'large-v3-turbo'

export type WhisperQuantizedModelId =
	'tiny' |
	'tiny-q5_1' |
	'tiny-q8_0' |

	'tiny.en' |
	'tiny.en-q5_1' |
	'tiny.en-q8_0' |

	'base' |
	'base-q5_1' |
	'base-q8_0' |

	'base.en' |
	'base.en-q5_1' |
	'base.en-q8_0' |

	'small' |
	'small-q5_1' |
	'small-q8_0' |

	'small.en' |
	'small.en-q5_1' |
	'small.en-q8_0' |

	'medium' |
	'medium-q5_0' |
	'medium-q8_0' |

	'medium.en' |
	'medium.en-q5_0' |
	'medium.en-q8_0' |

	'large' |

	'large-v1' |

	'large-v2' |
	'large-v2-q5_0' |
	'large-v2-q8_0' |

	'large-v3' |
	'large-v3-q5_0' |

	'large-v3-turbo' |
	'large-v3-turbo-q5_0' |
	'large-v3-turbo-q8_0'

export type WhisperTask = 'transcribe' | 'translate' | 'detect-language'
