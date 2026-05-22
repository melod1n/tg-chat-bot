import {Message} from "typescript-telegram-bot-api";
import type {
    ResponseInputMessageContentList,
    ResponseOutputMessage,
    ResponseOutputText,
} from "openai/resources/responses/responses";
import {AiProvider} from "../model/ai-provider";
import {MessageStore} from "../common/message-store";
import {collectReplyChainText} from "../util/utils";
import type {AiDownloadedFile} from "./telegram-attachments";
import type {MessageAudioPart, MessageImagePart, MessagePart} from "../common/message-part";
import type {UserAiResponseLanguage} from "../common/user-ai-settings";
import {getResponseLanguageInstruction} from "../common/user-ai-settings";
import {pythonInterpreterToolPrompt} from "./tools/python-interpretator";
import type {AttachmentKind, AiRuntimeTarget, RuntimeConfigSnapshot} from "./unified-ai-runner.shared";
import type {OpenAIChatMessage} from "./openai-chat-message";
import type {MistralChatMessage} from "./mistral-chat-message";
import type {OllamaChatMessage} from "./ollama-chat-message";
import {buildUserMemoryPrompt} from "./tools/user-memory.js";

export type ConversationAttachment = {
    kind: AttachmentKind;
    data: string;
    mimeType: string;
    fileName?: string;
};

export type ConversationTurn = {
    bot: boolean;
    name?: string;
    langCode?: string;
    userName?: string;
    content: string;
    deletedByBotAt?: number | null;
    attachments: ConversationAttachment[];
    documentNames?: string[];
};

export type ConversationSnapshot = {
    turns: ConversationTurn[];
    imageCount: number;
    systemInstruction: string;
};

function buildAttachmentFromImage(image: MessageImagePart): ConversationAttachment {
    return {
        kind: "image",
        data: image.data,
        mimeType: image.mimeType || "image/jpeg",
        fileName: "image.jpg",
    };
}

function buildAttachmentFromAudio(audio: MessageAudioPart): ConversationAttachment {
    return {
        kind: "audio",
        data: audio.data,
        mimeType: audio.mimeType || "audio/mpeg",
        fileName: "audio.bin",
    };
}

function buildConversationAttachments(part: MessagePart): ConversationAttachment[] {
    const attachments: ConversationAttachment[] = [];

    for (const image of part.imageParts ?? []) {
        attachments.push(buildAttachmentFromImage(image));
    }

    for (const audio of part.audioParts ?? []) {
        attachments.push(buildAttachmentFromAudio(audio));
    }

    for (const document of part.documents ?? []) {
        attachments.push({
            kind: "document",
            data: document,
            mimeType: "application/octet-stream",
            fileName: "document.bin",
        });
    }

    for (const video of part.videos ?? []) {
        attachments.push({
            kind: "video",
            data: video,
            mimeType: "video/mp4",
            fileName: "video.mp4",
        });
    }

    for (const videoNote of part.videoNotes ?? []) {
        attachments.push({
            kind: "video-note",
            data: videoNote,
            mimeType: "video/mp4",
            fileName: "video-note.mp4",
        });
    }

    return attachments;
}

function attachmentCounts(attachments: ConversationAttachment[]): Record<AttachmentKind, number> {
    return attachments.reduce<Record<AttachmentKind, number>>((counts, attachment) => {
        counts[attachment.kind] += 1;
        return counts;
    }, {
        image: 0,
        document: 0,
        audio: 0,
        video: 0,
        "video-note": 0,
    });
}

function attachmentSummary(attachments: ConversationAttachment[]): string {
    const counts = attachmentCounts(attachments);
    const lines = Object.entries(counts)
        .filter(([, count]) => count > 0)
        .map(([kind, count]) => `- ${kind}: ${count}`);

    if (!lines.length) return "";

    return ["[attachments]:", ...lines].join("\n");
}

function namesSummary(kind: string, names: string[]): string {
    const filtered = names.map(name => name.trim()).filter(Boolean);
    if (!filtered.length) return "";

    return [`[${kind}]:`, ...filtered.map(name => `- ${name}`)].join("\n");
}

function supportedAttachmentKinds(provider: AiProvider, bot: boolean): Set<AttachmentKind> {
    if (bot) return new Set<AttachmentKind>();

    switch (provider) {
        case AiProvider.OPENAI:
            return new Set<AttachmentKind>(["image", "audio", "document", "video", "video-note"]);
        case AiProvider.MISTRAL:
            return new Set<AttachmentKind>(["image"]);
        case AiProvider.OLLAMA:
            return new Set<AttachmentKind>();
    }

    return new Set<AttachmentKind>();
}

function renderContentText(
    turn: ConversationTurn,
    provider: AiProvider,
    includeNames: boolean,
): string {
    const parts = [turn.content.trim()];
    const supported = supportedAttachmentKinds(provider, turn.bot);
    const unsupported = turn.attachments.filter(attachment => !supported.has(attachment.kind));

    if (includeNames && !turn.bot) {
        parts.unshift([
            "[user_info]:",
            `name: ${turn.name ?? ""}`.trimEnd(),
            `username: @${turn.userName ?? ""}`.trimEnd(),
            "",
        ].join("\n"));
    }

    if (turn.bot && turn.deletedByBotAt) {
        parts.push("[message_state]: deleted_by_bot");
    }

    if (turn.documentNames?.length) {
        parts.push(namesSummary("documents", turn.documentNames));
    }

    if (unsupported.length) {
        parts.push(attachmentSummary(unsupported));
    }

    return parts.filter(part => part.trim().length > 0).join("\n\n").trim();
}

function buildOpenAiOutputText(text: string): ResponseOutputText {
    return {
        type: "output_text",
        text,
        annotations: [],
    };
}

function buildOpenAiInputMessage(turn: ConversationTurn, provider: AiProvider, includeNames: boolean): OpenAIChatMessage {
    const text = renderContentText(turn, provider, includeNames);
    const content: ResponseInputMessageContentList = [
        {
            type: "input_text",
            text,
        },
    ];

    for (const attachment of turn.attachments.filter(item => item.kind === "image")) {
        content.push({
            type: "input_image",
            image_url: `data:${attachment.mimeType};base64,${attachment.data}`,
            detail: "auto",
        });
    }

    return {
        type: "message",
        role: "user",
        content,
    };
}

function buildOpenAiAssistantMessage(turn: ConversationTurn, provider: AiProvider, includeNames: boolean): ResponseOutputMessage {
    const text = renderContentText(turn, provider, includeNames);
    return {
        id: `msg_${Date.now()}`,
        type: "message",
        role: "assistant",
        status: "completed",
        phase: "final_answer",
        content: [buildOpenAiOutputText(text)],
    };
}

function buildOpenAiMessage(turn: ConversationTurn, provider: AiProvider, includeNames: boolean): OpenAIChatMessage {
    return turn.bot
        ? buildOpenAiAssistantMessage(turn, provider, includeNames)
        : buildOpenAiInputMessage(turn, provider, includeNames);
}

function buildMistralMessage(turn: ConversationTurn, provider: AiProvider, includeNames: boolean): MistralChatMessage {
    const text = renderContentText(turn, provider, includeNames);

    if (turn.bot) {
        return {
            role: "assistant",
            content: [{type: "text", text}],
        };
    }

    return {
        role: "user",
        content: [
            {type: "text", text},
            ...turn.attachments
                .filter(attachment => attachment.kind === "image")
                .map(attachment => ({
                    type: "image_url" as const,
                    imageUrl: `data:${attachment.mimeType};base64,${attachment.data}`,
                })),
        ],
    };
}

function buildOllamaMessage(turn: ConversationTurn, provider: AiProvider, includeNames: boolean): OllamaChatMessage {
    const text = renderContentText(turn, provider, includeNames);
    return {
        role: turn.bot ? "assistant" : "user",
        content: text,
        images: turn.bot ? undefined : turn.attachments.filter(attachment => attachment.kind === "image").map(attachment => attachment.data),
    };
}

function buildSystemInstruction(
    config: RuntimeConfigSnapshot,
    responseLanguage: UserAiResponseLanguage,
    includePythonToolPrompt: boolean,
    additions?: string | null,
    memoryInstruction?: string | null,
): string {
    return [
        config.useSystemPrompt ? getResponseLanguageInstruction(responseLanguage) : null,
        config.systemPrompt && config.useSystemPrompt ? config.systemPrompt : null,
        additions?.trim() ? additions.trim() : null,
        memoryInstruction?.trim() ? memoryInstruction.trim() : null,
        includePythonToolPrompt ? pythonInterpreterToolPrompt : null,
    ].filter(Boolean).join("\n\n");
}

export async function buildConversationSnapshot(
    msg: Message,
    textOverride: string,
    downloads: AiDownloadedFile[],
    config: RuntimeConfigSnapshot,
    runtimeTarget: AiRuntimeTarget,
    responseLanguage: UserAiResponseLanguage,
    includePythonToolPrompt: boolean,
): Promise<ConversationSnapshot> {
    const storedMsg = await MessageStore.get(msg.chat.id, msg.message_id);
    const messageParts = await collectReplyChainText({triggerMsg: storedMsg ?? msg, downloads});

    if (messageParts.length && textOverride.trim()) {
        const latest = messageParts[0];
        if (!latest.bot) latest.content = textOverride.trim();
    }

    const turns = messageParts
        .reverse()
        .map(part => ({
            bot: part.bot,
            name: part.name,
            langCode: part.langCode,
            userName: part.userName,
            content: part.content,
            deletedByBotAt: part.deletedByBotAt,
            attachments: buildConversationAttachments(part),
            documentNames: part.documentNames,
        }));

    const imageCount = turns.reduce((sum, turn) => {
        if (turn.bot) return sum;
        return sum + turn.attachments.filter(attachment => attachment.kind === "image").length;
    }, 0);
    const memoryInstruction = await buildUserMemoryPrompt(msg.from?.id);

    return {
        turns,
        imageCount,
        systemInstruction: buildSystemInstruction(config, responseLanguage, includePythonToolPrompt, runtimeTarget.systemPromptAdditions, memoryInstruction),
    };
}

export function serializeConversationSnapshot(
    snapshot: ConversationSnapshot,
    provider: AiProvider,
    includeNames: boolean,
): { chatMessages: Array<OpenAIChatMessage | MistralChatMessage | OllamaChatMessage>; imageCount: number } {
    switch (provider) {
        case AiProvider.OPENAI: {
            const messages = snapshot.turns.map(turn => buildOpenAiMessage(turn, provider, includeNames));
            if (snapshot.systemInstruction) {
                messages.unshift({role: "system", content: snapshot.systemInstruction, type: "message"});
            }

            return {chatMessages: messages, imageCount: snapshot.imageCount};
        }
        case AiProvider.MISTRAL: {
            const messages = snapshot.turns.map(turn => buildMistralMessage(turn, provider, includeNames));
            if (snapshot.systemInstruction) {
                messages.unshift({role: "system", content: snapshot.systemInstruction});
            }

            return {chatMessages: messages, imageCount: snapshot.imageCount};
        }
        case AiProvider.OLLAMA: {
            const messages = snapshot.turns.map(turn => buildOllamaMessage(turn, provider, includeNames));
            if (snapshot.systemInstruction) {
                messages.unshift({role: "system", content: snapshot.systemInstruction});
            }

            return {chatMessages: messages, imageCount: snapshot.imageCount};
        }
    }

    return {chatMessages: [], imageCount: snapshot.imageCount};
}
