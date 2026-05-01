export type StoredAttachmentKind = "image" | "document" | "audio" | "video" | "video-note";

export type StoredAttachment = {
    kind: StoredAttachmentKind;
    fileId: string;
    fileUniqueId?: string;
    fileName: string;
    mimeType?: string;
    cachePath: string;
    sizeBytes?: number;
    sha256?: string;
    scope?: "user_input" | "bot_output" | "internal_artifact";
    artifactKind?: "rag" | "transcript" | "tool_result" | "generated_file" | "tts_audio" | "final_text" | "error";
    metadata?: Record<string, unknown>;
};

