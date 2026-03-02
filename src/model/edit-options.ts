import {InlineKeyboardMarkup, Message, ParseMode} from "typescript-telegram-bot-api";
import {LinkPreviewOptions, MessageEntity} from "typescript-telegram-bot-api/dist/types";

export type EditOptions = ({
    message: Message
} | {
    chat_id: number;
    message_id: number;
}) & {
    text: string;
    parse_mode?: ParseMode;
    entities?: MessageEntity[];
    link_preview_options?: LinkPreviewOptions;
    reply_markup?: InlineKeyboardMarkup;
}