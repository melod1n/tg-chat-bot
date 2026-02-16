import {logError} from "./utils";
import fs from "node:fs";
import path from "node:path";

export function clearUpFolderFromOldFiles(folder: string, recursive = true) {
    fs.readdir(folder, (err, files) => {
        if (err) {
            logError(err);
            return;
        }

        const filenamesToDelete: string[] = [];

        files.forEach(filename => {
            const fullPath = path.join(folder, filename);

            try {
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory() && recursive) {
                    clearUpFolderFromOldFiles(fullPath, recursive);
                } else {
                    const then = stats.mtime.getTime() / 1000;
                    const now = Date.now() / 1000;
                    const diff = Math.abs(now - then);
                    const moreThanOneDay = diff >= 60 * 60 * 24;

                    if (stats.isFile() && moreThanOneDay) {
                        filenamesToDelete.push(fullPath);
                    }
                }
            } catch (e) {
                logError(e);
            }
        });

        console.log("filenamesToDelete", filenamesToDelete);
        if (filenamesToDelete.length) {
            filenamesToDelete.forEach((filename) => {
                fs.rm(filename, (e) => {
                    if (e) logError(e);
                });
            });
        }
    });
}