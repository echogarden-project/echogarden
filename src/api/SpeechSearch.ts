import { AudioSourceParam } from "../audio/AudioUtilities.js";
import { OperationCallbacks } from "./Common.js";

export async function searchSpeech(inputAudio: AudioSourceParam, text: string, options: SpeechSearchOptions): Promise<SpeechSearchResult> {
	return {}
}

export interface SpeechSearchOptions extends OperationCallbacks {

}

export interface SpeechSearchResult {
}

export interface SpeechSearchCallbacks extends OperationCallbacks {

}
