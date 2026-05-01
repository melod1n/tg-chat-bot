import {FileOptions, InlineKeyboardMarkup, Message} from "typescript-telegram-bot-api";
import {bot} from "../index";
import {buildCancelledGenerationText, logError, replyToMessage} from "../util/utils";
import {Environment} from "../common/environment";
import {MessageStore} from "../common/message-store";
import {createQueuedFunction} from "../util/async-lock";
import {enqueueTelegramApiCall} from "../util/telegram-api-queue";
import fs from "node:fs";
import path from "node:path";
import {StoredAttachment, StoredAttachmentKind} from "../model/stored-attachment";
import {StoredMessage} from "../model/stored-message";
import {prepareTelegramMarkdownV2} from "../util/markdown-v2-renderer";
import {AiProvider} from "../model/ai-provider";
import {AI_IMAGE_OUTPUT_MODE_DOCUMENT, UserAiImageOutputMode} from "../common/user-ai-settings";
import {PIPELINE_ATTACHMENT_LIMIT_BYTES} from "./user-request-pipeline";

const TELEGRAM_LIMIT = 4096;
const TELEGRAM_CAPTION_LIMIT = 1024;
const TELEGRAM_PHOTO_LIMIT_BYTES = 10 * 1024 * 1024;
const EDIT_INTERVAL_MS = 4500;

export type TelegramArtifactFile = {
    kind: "image" | "file";
    path: string;
    fileName: string;
    mimeType?: string;
    sizeBytes: number;
};

export type TelegramToolExecutionRecord = {
    toolName: string;
    callId: string;
    argumentsText: string;
    resultChars: number;
    startedAt: string;
    finishedAt: string;
};

export type TelegramOutputAttachmentRecord = {
    artifactKind: "generated_file" | "tts_audio";
    fileName: string;
    mimeType?: string;
    sizeBytes?: number;
    messageId?: number;
};

export class TelegramStreamMessage {
    private waitMessage: Message | null = null;
    private timer: NodeJS.Timeout | null = null;
    private lastSent = "";
    private text = "";
    private status = "";
    private mediaMode = false;
    private cancelled = false;
    private cancelledProvider = "";
    private readonly sendImagesAsDocuments: boolean;
    private readonly startedAt = Date.now();
    private readonly enqueueEdit = createQueuedFunction();
    private readonly toolExecutions: TelegramToolExecutionRecord[] = [];
    private readonly outputAttachments: TelegramOutputAttachmentRecord[] = [];

    constructor(
        private readonly sourceMessage: Message,
        private readonly cancelRequestId: string,
        private readonly stream: boolean,
        private readonly regenerateCallbackData?: string,
        private readonly targetMessage?: Message,
        private readonly cancelProvider?: AiProvider,
        private readonly isGuest?: boolean,
        imageOutputMode: UserAiImageOutputMode = "photo",
    ) {
        this.sendImagesAsDocuments = imageOutputMode === AI_IMAGE_OUTPUT_MODE_DOCUMENT;
    }

    keyboard(): InlineKeyboardMarkup {
        return {
            inline_keyboard: [[{
                text: Environment.cancelText,
                callback_data: this.cancelProvider
                    ? `/cancel_ai ${this.cancelRequestId} ${this.cancelProvider}`
                    : `/cancel_ai ${this.cancelRequestId}`,
            }]],
        };
    }

    emptyKeyboard(): InlineKeyboardMarkup {
        return {inline_keyboard: []};
    }

    regenerateKeyboard(): InlineKeyboardMarkup | null {
        if (!this.regenerateCallbackData) return null;

        return {
            inline_keyboard: [[{
                text: Environment.regenerateText,
                callback_data: this.regenerateCallbackData,
            }]],
        };
    }

    private isMessageNotModified(message: string): boolean {
        return message.includes("message is not modified");
    }

    private async updateKeyboard(replyMarkup: InlineKeyboardMarkup): Promise<void> {
        if (!this.waitMessage) return;

        try {
            await enqueueTelegramApiCall(
                () => bot.editMessageReplyMarkup({
                    chat_id: this.waitMessage!.chat.id,
                    message_id: this.waitMessage!.message_id,
                    reply_markup: replyMarkup,
                }),
                {
                    method: "editMessageReplyMarkup",
                    chatId: this.waitMessage.chat.id,
                    chatType: this.waitMessage.chat.type,
                }
            );
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            if (!this.isMessageNotModified(message)) logError(e instanceof Error ? e : message);
        }
    }

    private async removeKeyboard(): Promise<void> {
        await this.updateKeyboard(this.emptyKeyboard());
    }

    private startFlushTimer(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(() => this.flush().catch(logError), EDIT_INTERVAL_MS);
    }

    private visibleText(): string {
        const parts = [this.text, this.status].filter(v => v && v.trim().length);
        let value = parts.join("\n\n").trim() || Environment.waitThinkText;
        if (value.length > TELEGRAM_LIMIT) {
            value = value.substring(0, TELEGRAM_LIMIT - 1);
        }
        return value;
    }

    private visibleCaption(): string {
        let value = this.visibleText();
        if (value.length > TELEGRAM_CAPTION_LIMIT) {
            value = value.substring(0, TELEGRAM_CAPTION_LIMIT - 1);
        }
        return value;
    }

    async start(initialStatus: string): Promise<Message> {
        this.status = initialStatus;
        const rawText = this.visibleText();
        const formatted = prepareTelegramMarkdownV2(rawText, {mode: "draft"});

        if (this.targetMessage) {
            this.waitMessage = this.targetMessage;

            try {
                await MessageStore.put(this.targetMessage).catch(logError);
                const result = await enqueueTelegramApiCall(
                    () => bot.editMessageText({
                        chat_id: this.targetMessage!.chat.id,
                        message_id: this.targetMessage!.message_id,
                        text: formatted,
                        parse_mode: "MarkdownV2",
                        reply_markup: this.keyboard(),
                    }),
                    {
                        method: "editMessageText",
                        chatId: this.targetMessage.chat.id,
                        chatType: this.targetMessage.chat.type,
                    }
                );
                if (result && result !== true) this.waitMessage = result;
                this.mediaMode = false;
                this.lastSent = rawText;
                await this.store();
                this.startFlushTimer();
                return this.waitMessage;
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                if (this.isMessageNotModified(message)) {
                    this.lastSent = rawText;
                    await this.updateKeyboard(this.keyboard());
                    await this.store();
                    this.startFlushTimer();
                    return this.waitMessage;
                }

                logError(e instanceof Error ? e : message);
                this.waitMessage = null;
                this.mediaMode = false;
            }
        }

        this.waitMessage = await replyToMessage({
            message: this.sourceMessage,
            text: formatted,
            reply_markup: this.keyboard(),
            parse_mode: "MarkdownV2"
        });
        this.lastSent = rawText;
        this.startFlushTimer();
        return this.waitMessage;
    }

    setStatus(status: string): void {
        if (this.cancelled) return;
        this.status = status;
    }

    getStatus(): string {
        return this.status;
    }

    clearStatus(): void {
        if (this.cancelled) return;
        this.status = "";
    }

    append(delta: string): void {
        if (this.cancelled) return;
        if (!delta) return;
        this.text += delta;
    }

    replaceText(text: string): void {
        if (this.cancelled) return;
        this.text = text;
    }

    getText(): string {
        return this.text;
    }

    recordToolExecution(record: TelegramToolExecutionRecord): void {
        this.toolExecutions.push(record);
    }

    getToolExecutions(): TelegramToolExecutionRecord[] {
        return [...this.toolExecutions];
    }

    recordOutputAttachment(record: TelegramOutputAttachmentRecord): void {
        this.outputAttachments.push(record);
    }

    getOutputAttachments(): TelegramOutputAttachmentRecord[] {
        return [...this.outputAttachments];
    }

    sourceChatId(): number {
        return this.sourceMessage.chat.id;
    }

    sourceMessageId(): number {
        return this.sourceMessage.message_id;
    }

    async flush(replyMarkup: InlineKeyboardMarkup | null = this.keyboard(), end?: boolean): Promise<void> {
        return this.enqueueEdit(() => this.flushUnsafe(replyMarkup, end));
    }

    private async flushUnsafe(replyMarkup: InlineKeyboardMarkup | null = this.keyboard(), end?: boolean): Promise<void> {
        if (!this.waitMessage && this.stream) return;

        const next = this.mediaMode ? this.visibleCaption() : this.visibleText();
        const shouldRemoveKeyboard = replyMarkup === null;
        if (next === this.lastSent && shouldRemoveKeyboard) {
            await this.removeKeyboard();
            return;
        }

        const formatted = prepareTelegramMarkdownV2(next, {mode: end ? "final" : "draft"});

        if (next === this.lastSent && replyMarkup !== null) {
            if (end) await this.updateKeyboard(replyMarkup);
            return;
        }

        try {
            if (!this.stream && end && !this.waitMessage) {
                if (this.isGuest) {
                    // await enqueueTelegramApiCall(() => bot.answerGuestQuery({
                    //         guest_query_id: this.sourceMessage.guest_query_id ?? "",
                    //         result: {}
                    //     }),
                    //     {});
                } else {
                    await replyToMessage({
                        message: this.sourceMessage,
                        text: formatted,
                        parse_mode: "MarkdownV2",
                    });
                }
            } else {
                if (this.waitMessage) {
                    const result = this.mediaMode
                        ? await enqueueTelegramApiCall(
                            () => bot.editMessageCaption({
                                chat_id: this.waitMessage!.chat.id,
                                message_id: this.waitMessage!.message_id,
                                caption: formatted,
                                parse_mode: "MarkdownV2",
                                reply_markup: replyMarkup ?? this.emptyKeyboard(),
                            }),
                            {
                                method: "editMessageCaption",
                                chatId: this.waitMessage.chat.id,
                                chatType: this.waitMessage.chat.type,
                            }
                        )
                        : await enqueueTelegramApiCall(
                            () => bot.editMessageText({
                                chat_id: this.waitMessage!.chat.id,
                                message_id: this.waitMessage!.message_id,
                                text: formatted,
                                parse_mode: "MarkdownV2",
                                reply_markup: replyMarkup ?? this.emptyKeyboard(),
                            }),
                            {
                                method: "editMessageText",
                                chatId: this.waitMessage.chat.id,
                                chatType: this.waitMessage.chat.type,
                            }
                        );
                    if (result && result !== true) this.waitMessage = result;
                }
            }
            if (shouldRemoveKeyboard) await this.removeKeyboard();
            this.lastSent = next;
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            if (shouldRemoveKeyboard && this.isMessageNotModified(message)) {
                await this.removeKeyboard();
                this.lastSent = next;
                return;
            }
            if (!this.isMessageNotModified(message)) logError(e instanceof Error ? e : message);
        }
    }

    async cancel(provider: string): Promise<void> {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.cancelled = true;
        this.cancelledProvider = provider;
        this.status = "";
        this.text = buildCancelledGenerationText(this.text, this.cancelledProvider, this.mediaMode ? TELEGRAM_CAPTION_LIMIT : TELEGRAM_LIMIT);
        await this.flush(this.regenerateKeyboard(), true);
        await this.store();
    }

    async showImage(image: Buffer, attachment?: StoredAttachment): Promise<void> {
        return this.enqueueEdit(() => this.showImageUnsafe(image, attachment));
    }

    async sendArtifact(file: TelegramArtifactFile): Promise<Message | null> {
        return this.enqueueEdit(() => this.sendArtifactUnsafe(file));
    }

    private async showImageUnsafe(image: Buffer, attachment?: StoredAttachment): Promise<void> {
        if (this.cancelled) return;
        const next = this.visibleCaption();
        const useDocument = this.sendImagesAsDocuments;

        if (!this.waitMessage) {
            if (this.stream) return;

            const upload = useDocument ? this.createImageUpload(image, attachment) : null;
            try {
                this.waitMessage = useDocument
                    ? await this.sendImageAsDocument(upload!, next)
                    : await enqueueTelegramApiCall(
                        () => bot.sendPhoto({
                            chat_id: this.sourceMessage.chat.id,
                            photo: image,
                            caption: prepareTelegramMarkdownV2(next, {mode: "final"}),
                            parse_mode: "MarkdownV2",
                            reply_parameters: {message_id: this.sourceMessage.message_id},
                        }),
                        {
                            method: "sendPhoto",
                            chatId: this.sourceMessage.chat.id,
                            chatType: this.sourceMessage.chat.type,
                        }
                    );
            } finally {
                if (upload) this.destroyUpload(upload);
            }
            this.mediaMode = true;
            this.lastSent = next;
            await this.storeMediaMessage(this.waitMessage, attachment);
            return;
        }

        const upload = useDocument ? this.createImageUpload(image, attachment) : null;
        try {
            const result = await enqueueTelegramApiCall(
                () => bot.editMessageMedia({
                    chat_id: this.waitMessage!.chat.id,
                    message_id: this.waitMessage!.message_id,
                    media: useDocument
                        ? {
                            type: "document",
                            media: upload!,
                            caption: prepareTelegramMarkdownV2(next, {mode: "final"}),
                            parse_mode: "MarkdownV2",
                        }
                        : {
                            type: "photo",
                            media: image,
                            caption: prepareTelegramMarkdownV2(next, {mode: "final"}),
                            parse_mode: "MarkdownV2",
                        },
                    reply_markup: this.keyboard(),
                }),
                {
                    method: "editMessageMedia",
                    chatId: this.waitMessage.chat.id,
                    chatType: this.waitMessage.chat.type,
                }
            );
            if (result && result !== true) this.waitMessage = result;
            this.mediaMode = true;
            this.lastSent = next;
            await this.storeMediaMessage(this.waitMessage, attachment);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            if (useDocument) {
                try {
                    this.waitMessage = await this.sendImageAsDocument(upload!, next);
                    this.mediaMode = true;
                    this.lastSent = next;
                    await this.storeMediaMessage(this.waitMessage, attachment);
                    return;
                } catch (fallbackError) {
                    logError(fallbackError instanceof Error ? fallbackError : String(fallbackError));
                }
            }

            if (!message.includes("message is not modified")) logError(e instanceof Error ? e : message);
        } finally {
            if (upload) this.destroyUpload(upload);
        }
    }

    private async storeMediaMessage(sent: Message | null, attachment?: StoredAttachment): Promise<void> {
        if (!sent || !attachment) return;

        const stored: StoredMessage = {
            chatId: sent.chat.id,
            id: sent.message_id,
            replyToMessageId: sent.reply_to_message?.message_id ?? this.sourceMessage.message_id,
            fromId: sent.from?.id ?? 0,
            text: sent.caption ?? this.visibleText(),
            date: sent.date ?? Math.floor(Date.now() / 1000),
            attachments: [attachment],
        };

        await MessageStore.put(stored);
    }

    private async sendArtifactUnsafe(file: TelegramArtifactFile): Promise<Message | null> {
        if (this.cancelled) return null;

        if (file.sizeBytes > PIPELINE_ATTACHMENT_LIMIT_BYTES) {
            throw new Error(Environment.getTelegramFileTooLargeText(
                file.fileName,
                PIPELINE_ATTACHMENT_LIMIT_BYTES / 1024 / 1024,
            ));
        }

        const caption = file.fileName.slice(0, TELEGRAM_CAPTION_LIMIT);
        const isPhoto = this.isPhotoArtifact(file);

        await enqueueTelegramApiCall(
            () => bot.sendChatAction({
                chat_id: this.sourceMessage.chat.id,
                action: isPhoto ? "upload_photo" : "upload_document",
            }),
            {
                method: "sendChatAction",
                chatId: this.sourceMessage.chat.id,
                chatType: this.sourceMessage.chat.type,
            }
        ).catch(logError);

        let sent: Message;
        if (isPhoto) {
            try {
                sent = await enqueueTelegramApiCall(
                    async () => {
                        const upload = this.createArtifactUpload(file);
                        try {
                            return await bot.sendPhoto({
                                chat_id: this.sourceMessage.chat.id,
                                photo: upload,
                                caption,
                                reply_parameters: {message_id: this.sourceMessage.message_id},
                            });
                        } finally {
                            this.destroyUpload(upload);
                        }
                    },
                    {
                        method: "sendPhoto",
                        chatId: this.sourceMessage.chat.id,
                        chatType: this.sourceMessage.chat.type,
                    }
                );
            } catch (e) {
                logError(e instanceof Error ? e : String(e));
                sent = await this.sendArtifactAsDocument(file, caption);
            }
        } else {
            sent = await this.sendArtifactAsDocument(file, caption);
        }

        await this.storeArtifactMessage(sent, file);
        this.recordOutputAttachment({
            artifactKind: "generated_file",
            fileName: file.fileName,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            messageId: sent.message_id,
        });
        return sent;
    }

    private isPhotoArtifact(file: TelegramArtifactFile): boolean {
        if (this.sendImagesAsDocuments) return false;
        return file.kind === "image"
            && file.sizeBytes <= TELEGRAM_PHOTO_LIMIT_BYTES
            && ["image/jpeg", "image/png", "image/webp"].includes((file.mimeType || "").toLowerCase());
    }

    private createImageUpload(image: Buffer, attachment?: StoredAttachment): FileOptions {
        if (attachment?.cachePath && fs.existsSync(attachment.cachePath)) {
            return new FileOptions(fs.createReadStream(attachment.cachePath), {
                filename: attachment.fileName || path.basename(attachment.cachePath),
                contentType: attachment.mimeType || "application/octet-stream",
            });
        }

        return new FileOptions(image, {
            filename: attachment?.fileName ?? `image_${Date.now()}.png`,
            contentType: attachment?.mimeType || "image/png",
        });
    }

    private createArtifactUpload(file: TelegramArtifactFile): FileOptions {
        return new FileOptions(fs.createReadStream(file.path), {
            filename: file.fileName,
            contentType: file.mimeType || "application/octet-stream",
        });
    }

    private destroyUpload(upload: FileOptions): void {
        if ("destroy" in upload.file && typeof upload.file.destroy === "function") {
            upload.file.destroy();
        }
    }

    private async sendImageAsDocument(upload: FileOptions, caption: string): Promise<Message> {
        return enqueueTelegramApiCall(
            () => bot.sendDocument({
                chat_id: this.sourceMessage.chat.id,
                document: upload,
                caption: prepareTelegramMarkdownV2(caption, {mode: "final"}),
                parse_mode: "MarkdownV2",
                reply_parameters: {message_id: this.sourceMessage.message_id},
            }),
            {
                method: "sendDocument",
                chatId: this.sourceMessage.chat.id,
                chatType: this.sourceMessage.chat.type,
            }
        );
    }

    private async sendArtifactAsDocument(file: TelegramArtifactFile, caption: string): Promise<Message> {
        return enqueueTelegramApiCall(
            async () => {
                const upload = this.createArtifactUpload(file);
                try {
                    return await bot.sendDocument({
                        chat_id: this.sourceMessage.chat.id,
                        document: upload,
                        caption,
                        reply_parameters: {message_id: this.sourceMessage.message_id},
                    });
                } finally {
                    this.destroyUpload(upload);
                }
            },
            {
                method: "sendDocument",
                chatId: this.sourceMessage.chat.id,
                chatType: this.sourceMessage.chat.type,
            }
        );
    }

    private async storeArtifactMessage(sent: Message, file: TelegramArtifactFile): Promise<void> {
        const photo = sent.photo?.[sent.photo.length - 1];
        const attachmentKind: StoredAttachmentKind = file.kind === "image" ? "image" : "document";
        const attachment: StoredAttachment = {
            kind: attachmentKind,
            fileId: sent.document?.file_id ?? photo?.file_id ?? file.path,
            fileUniqueId: sent.document?.file_unique_id ?? photo?.file_unique_id,
            fileName: file.fileName,
            mimeType: file.mimeType,
            cachePath: file.path,
            sizeBytes: file.sizeBytes,
            scope: "bot_output",
            artifactKind: "generated_file",
        };

        const stored: StoredMessage = {
            chatId: sent.chat.id,
            id: sent.message_id,
            replyToMessageId: sent.reply_to_message?.message_id ?? this.sourceMessage.message_id,
            fromId: sent.from?.id ?? 0,
            text: sent.caption ?? file.fileName,
            date: sent.date ?? Math.floor(Date.now() / 1000),
            attachments: [attachment],
        };

        await MessageStore.put(stored);
    }

    async storeInternalAttachment(attachment: StoredAttachment): Promise<void> {
        if (!this.waitMessage) return;

        const stored = await MessageStore.get(this.waitMessage.chat.id, this.waitMessage.message_id);
        await MessageStore.put({
            chatId: this.waitMessage.chat.id,
            id: this.waitMessage.message_id,
            replyToMessageId: this.waitMessage.reply_to_message?.message_id ?? this.sourceMessage.message_id,
            fromId: this.waitMessage.from?.id ?? 0,
            text: this.visibleText(),
            date: this.waitMessage.date ?? Math.floor(Date.now() / 1000),
            attachments: [
                ...(stored?.attachments ?? []),
                attachment,
            ],
            pipelineAudit: stored?.pipelineAudit,
        });
    }

    async storePipelineAudit(events: StoredMessage["pipelineAudit"]): Promise<void> {
        if (!this.waitMessage || !events?.length) return;

        const stored = await MessageStore.get(this.waitMessage.chat.id, this.waitMessage.message_id);
        await MessageStore.put({
            chatId: this.waitMessage.chat.id,
            id: this.waitMessage.message_id,
            replyToMessageId: this.waitMessage.reply_to_message?.message_id ?? this.sourceMessage.message_id,
            fromId: this.waitMessage.from?.id ?? 0,
            text: this.visibleText(),
            date: this.waitMessage.date ?? Math.floor(Date.now() / 1000),
            attachments: stored?.attachments,
            pipelineAudit: [
                ...(stored?.pipelineAudit ?? []),
                ...events,
            ],
        });
    }

    async finish(removeKeyboard = true): Promise<void> {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;

        if (this.cancelled) {
            await this.flush(removeKeyboard ? this.regenerateKeyboard() : this.keyboard(), true);
            await this.store();
            return;
        }

        if (Environment.SEND_TIME_TOOK) {
            const diff = Date.now() - this.startedAt;
            if (this.text.length + 32 < TELEGRAM_LIMIT) this.text += `\n\n⏱️ ${diff}ms`;
        }

        this.clearStatus();
        await this.flush(removeKeyboard ? this.regenerateKeyboard() : this.keyboard(), true);

        await this.store();
    }

    async fail(error: Error | string | object | null | undefined): Promise<void> {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.status = "";
        this.text = `${Environment.errorText}\n${error instanceof Error ? error.message : String(error)}`;
        await this.flush(this.regenerateKeyboard(), true);
    }

    private async store(): Promise<void> {
        if (!this.waitMessage) return;
        try {
            await MessageStore.put({...this.waitMessage, text: this.visibleText()} as Message);
        } catch (e) {
            logError(e instanceof Error ? e : String(e));
        }
    }
}
