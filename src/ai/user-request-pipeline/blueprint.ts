import type {PipelineFallbackPolicy, PipelineStageName} from "./types.js";
import {PIPELINE_ATTACHMENT_LIMIT_BYTES} from "./types.js";

export const USER_REQUEST_PIPELINE_STAGES: readonly PipelineStageName[] = [
    "receive_request",
    "audit_start",
    "load_user_settings",
    "collect_conversation_context",
    "input_size_gate",
    "download_attachments",
    "normalize_attachments",
    "persist_input_attachments",
    "prepare_text_context",
    "build_system_prompt",
    "resolve_runtime",
    "speech_to_text",
    "document_rag",
    "map_provider_messages",
    "tool_rank",
    "filter_tools",
    "model_call",
    "tool_loop",
    "persist_output_artifacts",
    "output_size_gate",
    "text_to_speech",
    "send_response",
    "cleanup",
    "audit_finish",
];

export const USER_REQUEST_ATTACHMENT_LIMIT_BYTES = PIPELINE_ATTACHMENT_LIMIT_BYTES;

export const DEFAULT_PIPELINE_FALLBACK_POLICIES: readonly PipelineFallbackPolicy[] = [
    {
        stage: "input_size_gate",
        onUnavailable: "fail_request",
        onFailed: "notify_user",
    },
    {
        stage: "speech_to_text",
        onUnavailable: "continue_without_stage",
        onFailed: "continue_without_stage",
    },
    {
        stage: "document_rag",
        onUnavailable: "continue_without_stage",
        onFailed: "notify_user",
    },
    {
        stage: "tool_rank",
        onUnavailable: "use_alternate_target",
        onFailed: "use_alternate_target",
    },
    {
        stage: "tool_loop",
        onUnavailable: "continue_without_stage",
        onFailed: "notify_user",
    },
    {
        stage: "output_size_gate",
        onUnavailable: "fail_request",
        onFailed: "notify_user",
    },
    {
        stage: "text_to_speech",
        onUnavailable: "continue_without_stage",
        onFailed: "continue_without_stage",
    },
];

export function isPipelineStageName(value: string): value is PipelineStageName {
    return (USER_REQUEST_PIPELINE_STAGES as readonly string[]).includes(value);
}
