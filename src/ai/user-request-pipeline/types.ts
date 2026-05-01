import type {AiProvider} from "../../model/ai-provider";
import type {StoredAttachmentKind} from "../../model/stored-attachment";
import type {
    UserAiImageOutputMode,
    UserAiResponseLanguage,
    UserAiVoiceMode,
} from "../../common/user-ai-settings";

export const PIPELINE_ATTACHMENT_LIMIT_BYTES = 50 * 1024 * 1024;

export type PipelineStageName =
    | "receive_request"
    | "audit_start"
    | "load_user_settings"
    | "collect_conversation_context"
    | "input_size_gate"
    | "download_attachments"
    | "normalize_attachments"
    | "persist_input_attachments"
    | "prepare_text_context"
    | "build_system_prompt"
    | "resolve_runtime"
    | "speech_to_text"
    | "document_rag"
    | "map_provider_messages"
    | "tool_rank"
    | "filter_tools"
    | "model_call"
    | "tool_loop"
    | "persist_output_artifacts"
    | "output_size_gate"
    | "text_to_speech"
    | "send_response"
    | "cleanup"
    | "audit_finish";

export type PipelineStageStatus =
    | "pending"
    | "running"
    | "succeeded"
    | "skipped"
    | "failed"
    | "fallback";

export type PipelineFallbackAction =
    | "ignore"
    | "notify_user"
    | "continue_without_stage"
    | "use_alternate_target"
    | "fail_request";

export type PipelineFallbackPolicy = {
    stage: PipelineStageName;
    onUnavailable: PipelineFallbackAction;
    onFailed: PipelineFallbackAction;
};

export type PipelineUserSettings = {
    provider: AiProvider;
    responseLanguage: UserAiResponseLanguage;
    contextSize?: number;
    voiceMode: UserAiVoiceMode;
    imageOutputMode: UserAiImageOutputMode;
};

export type PipelineRuntimeTarget = {
    provider: AiProvider;
    purpose:
        | "chat"
        | "toolRank"
        | "documents"
        | "speechToText"
        | "textToSpeech"
        | "outputImages"
        | "tools";
    model: string;
    baseUrl?: string;
};

export type PipelineRuntimePlan = {
    chat: PipelineRuntimeTarget;
    toolRank?: PipelineRuntimeTarget;
    documents?: PipelineRuntimeTarget;
    speechToText?: PipelineRuntimeTarget;
    textToSpeech?: PipelineRuntimeTarget;
    outputImages?: PipelineRuntimeTarget;
    tools?: PipelineRuntimeTarget;
};

export type PipelineAttachmentDirection = "input" | "output";

export type PersistentAttachment = {
    id?: string;
    direction: PipelineAttachmentDirection;
    kind: StoredAttachmentKind | "file";
    fileId?: string;
    fileUniqueId?: string;
    fileName: string;
    mimeType?: string;
    sizeBytes: number;
    cachePath?: string;
    sha256?: string;
    sourceChatId?: number;
    sourceMessageId?: number;
};

export type PipelineArtifactKind =
    | "transcript"
    | "rag"
    | "tool_result"
    | "generated_file"
    | "tts_audio"
    | "final_text"
    | "error";

export type PipelineArtifactBase = {
    id?: string;
    kind: PipelineArtifactKind;
    stage: PipelineStageName;
    requestId?: string;
    messageChatId?: number;
    messageId?: number;
    createdAt: string;
};

export type TranscriptArtifact = PipelineArtifactBase & {
    kind: "transcript";
    text: string;
    sourceAttachmentIds: string[];
    model?: string;
};

export type RagArtifact = PipelineArtifactBase & {
    kind: "rag";
    sourceAttachmentIds: string[];
    provider: AiProvider;
    extractedText?: string;
    chunks?: Array<{
        id: string;
        sourceName: string;
        text: string;
        score?: number;
    }>;
    providerState?: {
        vectorStoreIds?: string[];
        libraryId?: string;
        documentIds?: string[];
    };
};

export type ToolResultArtifact = PipelineArtifactBase & {
    kind: "tool_result";
    toolName: string;
    callId: string;
    resultText: string;
    outputAttachmentIds?: string[];
};

export type GeneratedFileArtifact = PipelineArtifactBase & {
    kind: "generated_file" | "tts_audio";
    attachmentId: string;
};

export type FinalTextArtifact = PipelineArtifactBase & {
    kind: "final_text";
    text: string;
};

export type ErrorArtifact = PipelineArtifactBase & {
    kind: "error";
    errorCode?: string;
    message: string;
    recoverable: boolean;
};

export type PipelineArtifact =
    | TranscriptArtifact
    | RagArtifact
    | ToolResultArtifact
    | GeneratedFileArtifact
    | FinalTextArtifact
    | ErrorArtifact;

export type PipelineAuditEvent = {
    stage: PipelineStageName;
    status: PipelineStageStatus;
    startedAt?: string;
    finishedAt?: string;
    durationMs?: number;
    provider?: AiProvider;
    model?: string;
    details?: Record<string, unknown>;
    error?: string;
};

export type ToolRankDecision = {
    provider: AiProvider;
    round: number;
    availableTools: string[];
    selectedTools: string[];
    usedRanker: boolean;
};

export type UserRequestPipelineState = {
    requestId: string;
    chatId: number;
    messageId: number;
    replyToMessageId?: number;
    fromId: number;
    receivedAt: string;
    text: string;
    settings: PipelineUserSettings;
    runtime?: PipelineRuntimePlan;
    inputAttachments: PersistentAttachment[];
    outputAttachments: PersistentAttachment[];
    artifacts: PipelineArtifact[];
    toolRankDecisions: ToolRankDecision[];
    audit: PipelineAuditEvent[];
};

export type PipelineStageResult = {
    stage: PipelineStageName;
    status: PipelineStageStatus;
    artifacts?: PipelineArtifact[];
    attachments?: PersistentAttachment[];
    details?: Record<string, unknown>;
    fallbackAction?: PipelineFallbackAction;
};

export interface UserRequestPipelineStage {
    readonly name: PipelineStageName;
    run(state: UserRequestPipelineState, signal: AbortSignal): Promise<PipelineStageResult>;
}
