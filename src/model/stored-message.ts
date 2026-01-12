export type StoredMessage = {
    chatId: number;
    messageId: number;
    replyToMessageId?: number | null;
    fromId: number;
    text: string;
    date: number;
};