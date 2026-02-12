import {logError} from "./utils";
import fs from "node:fs";
import path from "node:path";

export function clearUpFolderFromOldFiles(folder: string) {
    fs.readdir(folder, (err, files) => {
        if (err) {
            logError(err);
            return;
        }

        const filenamesToDelete: string[] = [];

        files.forEach((filename, index) => {
            fs.stat(path.join(folder, filename), (err, stats) => {
                if (err) {
                    logError(err);
                } else {
                    const then = stats.mtime.getTime() / 1000;
                    const now = Date.now() / 1000;
                    const diff = Math.abs(now - then);
                    const moreThanOneDay = diff >= 60 * 60 * 24;
                    if (moreThanOneDay) {
                        filenamesToDelete.push(filename);
                    }

                    if (index === files.length - 1) {
                        console.log("filenamesToDelete", filenamesToDelete);
                        if (filenamesToDelete.length) {
                            filenamesToDelete.forEach((filename) => {
                                const fullPath = path.join(folder, filename);
                                fs.rm(fullPath, (e) => {
                                    if (e) logError(e);
                                });
                            });
                        }
                    }
                }
            });
        });
    });
}