import {AiCapabilityInfo} from "./ai-capability-info";

export class AiModelCapabilities {
    chat: AiCapabilityInfo | undefined;
    vision: AiCapabilityInfo | undefined;
    ocr: AiCapabilityInfo | undefined;
    thinking: AiCapabilityInfo | undefined;
    extendedThinking: AiCapabilityInfo | undefined;
    tools: AiCapabilityInfo | undefined;
    toolRank: AiCapabilityInfo | undefined;
    audio: AiCapabilityInfo | undefined;
    documents: AiCapabilityInfo | undefined;
    outputImages: AiCapabilityInfo | undefined;
    speechToText: AiCapabilityInfo | undefined;
    textToSpeech: AiCapabilityInfo | undefined;
}
