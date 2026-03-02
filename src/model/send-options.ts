import {InlineKeyboardMarkup, Message, ParseMode} from "typescript-telegram-bot-api";
import {
    ForceReply,
    LinkPreviewOptions,
    MessageEntity, ReplyKeyboardMarkup, ReplyKeyboardRemove,
    ReplyParameters,
    SuggestedPostParameters
} from "typescript-telegram-bot-api/dist/types";

export type SendOptions = ({
    message: Message
} | {
    /**
     * Unique identifier for the target chat or username of the target channel (in the format `@channelusername`)
     */
    chat_id: number | string;
    message_id?: number;
}) & {
    /**
     * Unique identifier for the target message thread (topic) of the forum; for forum supergroups only
     */
    message_thread_id?: number;
    /**
     * Identifier of the direct messages topic to which the message will be sent; required if the message is sent to a
     * direct messages chat
     */
    direct_messages_topic_id?: number;
    /**
     * Text of the message to be sent, 1-4096 characters after entities parsing
     */
    text: string;
    /**
     * Mode for parsing entities in the message text. See formatting options for more details.
     */
    parse_mode?: ParseMode;
    /**
     * A JSON-serialized list of special entities that appear in message text, which can be specified instead of
     * parse_mode
     */
    entities?: MessageEntity[];
    /**
     * Link preview generation options for the message
     */
    link_preview_options?: LinkPreviewOptions;
    /**
     * Sends the message silently. Users will receive a notification with no sound.
     */
    disable_notification?: boolean;
    /**
     * Protects the contents of the sent message from forwarding and saving
     */
    protect_content?: boolean;
    /**
     * Pass True to allow up to 1000 messages per second, ignoring
     * [broadcasting limits](https://core.telegram.org/bots/faq#how-can-i-message-all-of-my-bot-39s-subscribers-at-once)
     * for a fee of 0.1 Telegram Stars per message. The relevant Stars will be withdrawn from the bot's balance
     */
    allow_paid_broadcast?: boolean;
    /**
     * Unique identifier of the message effect to be added to the message; for private chats only
     */
    message_effect_id?: string;
    /**
     * A JSON-serialized object containing the parameters of the suggested post to send; for direct messages chats only.
     * If the message is sent as a reply to another suggested post, then that suggested post is automatically declined.
     */
    suggested_post_parameters?: SuggestedPostParameters;
    /**
     * Description of the message to reply to
     */
    reply_parameters?: ReplyParameters;
    /**
     * Additional interface options. A JSON-serialized object for an inline keyboard, custom reply keyboard,
     * instructions to remove a reply keyboard or to force a reply from the user
     */
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
};