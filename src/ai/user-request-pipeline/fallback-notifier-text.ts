import type {PipelineFallbackAction, PipelineStageName} from "./types.js";

const DEFAULT_TEXT = "⚠️ I had to skip part of the request, but I can continue.";
const NOTIFY_TEXT = "⚠️ I hit a problem and need to continue with a fallback.";
const FAIL_TEXT = "⚠️ I could not finish this request.";
const RAG_TEXT = "⚠️ Document retrieval failed, so I will answer without RAG.";
const STT_TEXT = "⚠️ Speech transcription failed, so I will continue without the audio transcript.";
const TTS_TEXT = "⚠️ Text-to-speech failed, so I will continue without audio output.";
const TOOL_TEXT = "⚠️ Tool execution failed, so I will continue without that tool.";

export function resolvePipelineFallbackText(stage: PipelineStageName, action: PipelineFallbackAction): string | undefined {
    if (action === "continue_without_stage") return undefined;
    if (action === "fail_request") return FAIL_TEXT;

    switch (stage) {
        case "speech_to_text":
            return STT_TEXT;
        case "document_rag":
            return RAG_TEXT;
        case "tool_loop":
            return TOOL_TEXT;
        case "text_to_speech":
            return TTS_TEXT;
        default:
            return action === "notify_user" ? NOTIFY_TEXT : DEFAULT_TEXT;
    }
}
