import {CallbackCommand} from "../base/callback-command";
import {CallbackQuery} from "typescript-telegram-bot-api";
import {processYouTubeLink} from "../util/utils";

export class YtInfo extends CallbackCommand {
    data = "/ytinfo";
    text: string;

    async execute(query: CallbackQuery): Promise<void> {
        const videoUrl = query.data.split(" ")[1];
        if (!videoUrl) return;

        await processYouTubeLink(query.message, videoUrl);
    }
}