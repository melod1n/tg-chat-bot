import {logError} from "./utils";
import fs from "node:fs";
import path from "node:path";
import {appLogger} from "../logging/logger";

const logger = appLogger.child("files");

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
                logError(e instanceof Error ? e : String(e));
            }
        });

        logger.debug("cleanup.candidates", {folder, recursive, count: filenamesToDelete.length, filenamesToDelete});
        if (filenamesToDelete.length) {
            filenamesToDelete.forEach((filename) => {
                fs.rm(filename, (e) => {
                    if (e) {
                        logger.error("cleanup.delete_failed", {filename, error: e instanceof Error ? e : String(e)});
                        logError(e instanceof Error ? e : String(e));
                    } else {
                        logger.debug("cleanup.deleted", {filename});
                    }
                });
            });
        }
    });
}
