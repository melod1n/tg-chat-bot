import {CallbackCommand} from "../base/callback-command";
import {CallbackQuery} from "typescript-telegram-bot-api";
import {processYouTubeLink} from "../util/utils";

export class YtInfo extends CallbackCommand {
    data = "/ytinfo";
    text: string;

    async execute(query: CallbackQuery): Promise<void> {
        const videoId = query.data.split(" ")[1];
        if (!videoId) return;

        await processYouTubeLink(query.message, null, videoId);
    }
}