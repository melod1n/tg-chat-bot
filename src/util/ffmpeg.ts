import {FfmpegCommand} from "fluent-ffmpeg";

export async function performFFmpeg(buildFFmpeg: () => FfmpegCommand): Promise<void> {
    return new Promise((resolve, reject) => {
        buildFFmpeg()
            .on("end", () => {
                resolve();
            })
            .on("error", reject);
    });
}