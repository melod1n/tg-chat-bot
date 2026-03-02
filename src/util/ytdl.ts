import fs from "node:fs";
import path from "node:path";
import {videoDir, videoTempDir} from "../index";
import ffmpeg from "fluent-ffmpeg";
import Innertube, {Platform, Types} from "youtubei.js";
import {Readable} from "node:stream";
import {logError} from "./utils";
import {performFFmpeg} from "./ffmpeg";
import VideoInfo from "youtubei.js/dist/src/parser/youtube/VideoInfo";

let innertube: Innertube | null = null;

export async function getYT(): Promise<Innertube> {
    if (innertube) {
        return innertube;
    } else {
        innertube = await Innertube.create({
            generate_session_locally: true,
            retrieve_player: true
        });
        return innertube;
    }
}

export function getYouTubeVideoId(url: string): string {
    const regex = /(?:(?:youtube\.com|music\.youtube\.com)\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts|clip)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i;
    const match = url.match(regex);
    if (!match || !match[1]) throw new Error("Invalid YouTube or Shorts URL");
    return match[1];
}

export async function getYouTubeVideoInfo(videoId: string): Promise<VideoInfo> {
    try {
        return (await getYT()).getInfo(videoId, {client: "ANDROID"});
    } catch (e) {
        logError(e);
    }
}

export function isVideoExists(options: DownloadOptions): boolean {
    const videoId = "videoId" in options ? options.videoId : getYouTubeVideoId(options.url);
    const filePath = path.join(videoDir, `${videoId}.mp4`);
    return fs.existsSync(filePath);
}

export function getVideoFromCache(videoId: string): Buffer | null {
    if (!isVideoExists({videoId: videoId})) return null;

    const filePath = path.join(videoDir, `${videoId}.mp4`);
    return Buffer.from(fs.readFileSync(filePath));
}

export type DownloadOptions = {
    url: string
} | {
    videoId: string;
}

export async function downloadVideoFromYouTube(options: DownloadOptions): Promise<{
    time: number,
    exists?: boolean,
    buffer: Buffer | null
}> {
    const start = Date.now();
    let buffer: Buffer | null = null;

    try {
        const videoId = "videoId" in options ? options.videoId : getYouTubeVideoId(options.url);
        const filePath = path.join(videoDir, `${videoId}.mp4`);
        if (fs.existsSync(filePath)) {
            const buffer = Buffer.from(fs.readFileSync(filePath));
            return {
                time: Date.now() - start,
                exists: true,
                buffer: buffer
            };
        }

        Platform.shim.eval = async (data: Types.BuildScriptResult, env: Record<string, Types.VMPrimative>) => {
            const properties = [];
            if (env.n) properties.push(`n: exportedVars.nFunction("${env.n}")`);
            if (env.sig) properties.push(`sig: exportedVars.sigFunction("${env.sig}")`);

            const code = `${data.output}\nreturn { ${properties.join(", ")} }`;
            return new Function(code)();
        };

        const yt = await getYT();

        const videoInfo = await yt.getInfo(videoId, {client: "ANDROID"});
        console.log("Video info", videoInfo);

        console.log(`Fetching metadata for: ${videoId}...`);

        const targetQuality = "360p";

        const videoFormat = videoInfo.streaming_data?.formats.find(f => f.quality_label.startsWith(targetQuality))
            || videoInfo.streaming_data?.adaptive_formats.find(f => f.quality_label.startsWith(targetQuality));

        const audioFormat = videoInfo.chooseFormat({type: "audio", quality: "best", language: "original"});

        console.log("Video format: ", videoFormat);
        console.log("Audio Format: ", audioFormat);

        if (!videoFormat) {
            console.log(`Quality ${targetQuality} not found. Falling back to best available.`);
        }

        const videoWebStream = await videoInfo.download({
            itag: videoFormat.itag,
            client: "ANDROID"
        });

        const audioWebStream = await videoInfo.download({
            itag: audioFormat.itag,
            client: "ANDROID"
        });

        const videoStream = Readable.fromWeb(videoWebStream as any);
        const audioStream = Readable.fromWeb(audioWebStream as any);

        const videoPath = path.join(videoTempDir, `temp_video_${videoId}.mp4`);
        const audioPath = path.join(videoTempDir, `temp_audio_${videoId}.mp4`);

        const writeStream = (stream: any, path: string) =>
            new Promise((resolve, reject) => {
                const file = fs.createWriteStream(path);
                stream.pipe(file);
                file.on("finish", resolve);
                file.on("error", reject);
            });

        await Promise.all([
            writeStream(videoStream, videoPath),
            writeStream(audioStream, audioPath)
        ]);

        await performFFmpeg(() =>
            ffmpeg()
                .input(videoPath)
                .input(audioPath)
                .videoCodec("copy")
                .audioCodec("copy")
                .save(filePath)
                .on("progress", (progress) => {
                    console.log("progress", progress);
                })
        ).catch(logError);

        fs.unlinkSync(videoPath);
        fs.unlinkSync(audioPath);

        buffer = fs.readFileSync(filePath);

        console.log(`✅ Saved to ${videoId}.mp4`);
    } catch (error) {
        console.error("❌ Download failed:", error instanceof Error ? error.message : error);
        throw error;
    }

    const end = Date.now();
    const diff = end - start;
    console.log(`Video downloaded.\ntook ${diff}ms`);

    return {
        time: diff,
        buffer: buffer,
    };
}