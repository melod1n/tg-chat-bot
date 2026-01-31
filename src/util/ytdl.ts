import Innertube, {Platform, Types, Utils} from "youtubei.js";
import fs, {createWriteStream} from "node:fs";
import path from "node:path";
import {Environment} from "../common/environment";

export function getYouTubeVideoId(url: string): string {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
    const match = url.match(regex);
    if (!match || !match[1]) throw new Error("Invalid YouTube or Shorts URL");
    return match[1];
}

export async function downloadVideoFromYouTube(url: string, targetQuality: string = "720p"): Promise<{
    time: number,
    exists?: boolean,
    buffer: Buffer | null
}> {
    const start = Date.now();
    let buffer: Buffer | null = null;

    try {
        const videoId = getYouTubeVideoId(url);
        const videoFolder = path.join(Environment.DATA_PATH, "video");
        if (!fs.existsSync(videoFolder)) {
            fs.mkdirSync(videoFolder);
        }

        const filePath = path.join(videoFolder, `${videoId}.mp4`);
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
        const yt = await Innertube.create({
            generate_session_locally: true,
            retrieve_player: true
        });

        const info = await yt.getInfo(videoId);

        console.log(`Fetching metadata for: ${videoId}...`);

        const format = info.streaming_data?.formats.find(f => f.quality_label === targetQuality)
            || info.streaming_data?.adaptive_formats.find(f => f.quality_label === targetQuality);

        if (!format) {
            console.log(`Quality ${targetQuality} not found. Falling back to best available.`);
        }

        const stream = await yt.download(videoId, {
            type: "video+audio",
            quality: "best",
            format: "mp4"
        });

        const file = createWriteStream(filePath);

        console.log("Downloading...");

        for await (const chunk of Utils.streamToIterable(stream)) {
            file.write(chunk);
        }

        file.end();

        buffer = fs.readFileSync(filePath);
        console.log(`✅ Saved to ${videoId}.mp4`);
    } catch (error) {
        console.error("❌ Download failed:", error instanceof Error ? error.message : error);
        throw error;
    }

    const end = Date.now();
    const diff = end - start;
    console.log(`Video downloaded. URL: ${url}\ntook ${diff}ms`);

    return {
        time: diff,
        buffer: buffer,
    };
}