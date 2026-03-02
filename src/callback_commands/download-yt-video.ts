import {CallbackCommand} from "../base/callback-command";
import {CallbackQuery} from "typescript-telegram-bot-api";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {commands} from "../index";
import {YouTubeDownload} from "../commands/youtube-download";

const downloadText = " 📥 Скачать";
const getFromCacheText = "📥 Загрузить из кэша";

export class DownloadYtVideo extends CallbackCommand {
    data = "/ytdl";
    text = " 📥 Скачать";

    requirements = Requirements.Build(Requirement.SAME_USER);

    constructor(text?: string, data?: string) {
        super();

        this.text = text || this.text;
        this.data = data || this.data;
    }

    static withData(inCache?: boolean, data?: string): DownloadYtVideo {
        return new DownloadYtVideo(inCache ? getFromCacheText : downloadText, data);
    }

    async execute(query: CallbackQuery): Promise<void> {
        const videoId = query.data.split(" ")[1];
        if (!videoId) return;

        const yt = commands.find(c => c instanceof YouTubeDownload);
        if (!yt) return;
        await yt.downloadYouTubeVideo(query.message, {videoId: videoId});
    }
}