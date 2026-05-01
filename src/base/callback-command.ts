/* eslint-disable no-unused-vars */
import {CallbackQuery, InlineKeyboardButton} from "typescript-telegram-bot-api";
import {Requirements} from "./requirements";
import {bot} from "../index";
import {logError} from "../util/utils";
import {enqueueTelegramApiCall} from "../util/telegram-api-queue";

export abstract class CallbackCommand {

    abstract text: string;
    abstract data: string;
    requirements?: Requirements | null = null;

    abstract execute(query: CallbackQuery): Promise<void>;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    afterExecute(_query: CallbackQuery): Promise<void> {
        return Promise.resolve();
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected getOptions(query: CallbackQuery): AnswerCallbackQueryOptions {
        return {callback_query_id: query.id};
    }

    async answerCallbackQuery(query: CallbackQuery): Promise<void> {
        enqueueTelegramApiCall(
            () => bot.answerCallbackQuery(this.getOptions(query)),
            {method: "answerCallbackQuery", skipPerChatLimit: true}
        ).catch(logError);
    }

    asButton(): InlineKeyboardButton {
        return {
            text: this.text,
            callback_data: this.data
        };
    }
}

export interface AnswerCallbackQueryOptions {
    callback_query_id: string;
    text?: string;
    show_alert?: boolean;
    url?: string;
    cache_time?: number;
}
