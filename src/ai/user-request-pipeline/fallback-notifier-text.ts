import {Localization} from "../../common/localization.js";
import type {PipelineFallbackAction, PipelineStageName} from "./types.js";

export function resolvePipelineFallbackText(
    stage: PipelineStageName,
    action: PipelineFallbackAction,
    locale?: string,
): string | undefined {
    if (action === "continue_without_stage") return undefined;
    if (action === "fail_request") return Localization.text("pipelineFallback.failRequest", {}, "⚠️ I could not finish this request.", locale);

    switch (stage) {
        case "speech_to_text":
            return Localization.text("pipelineFallback.speechToText", {}, "⚠️ Speech transcription failed, so I will continue without the audio transcript.", locale);
        case "document_rag":
            return Localization.text("pipelineFallback.documentRag", {}, "⚠️ Document retrieval failed, so I will answer without RAG.", locale);
        case "tool_loop":
            return Localization.text("pipelineFallback.toolLoop", {}, "⚠️ Tool execution failed, so I will continue without that tool.", locale);
        case "text_to_speech":
            return Localization.text("pipelineFallback.textToSpeech", {}, "⚠️ Text-to-speech failed, so I will continue without audio output.", locale);
        default:
            return action === "notify_user"
                ? Localization.text("pipelineFallback.notifyUser", {}, "⚠️ I hit a problem and need to continue with a fallback.", locale)
                : Localization.text("pipelineFallback.generic", {}, "⚠️ I had to skip part of the request, but I can continue.", locale);
    }
}
