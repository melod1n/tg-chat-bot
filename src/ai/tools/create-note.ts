import {AiTool} from "../tool-types.js";
import path from "node:path";
import {readFile, writeFile} from "node:fs/promises";
import {NOTES_HEADER, notesDir, notesRootFile} from "../../index.js";
import {asNonEmptyString} from "./utils.js";
import fs from "node:fs";
import {toolsLogger} from "./tool-logger.js";
import {AiJsonObject} from "../tool-types.js";

const logger = toolsLogger.child("create-note");

export type CreateNoteResult =
    | { success: true; filePath: string }
    | { success: false; error: string };

export const createNoteTool = {
    type: "function",
    function: {
        name: "create_note",
        description: "Create a new Markdown note with a valid file name, optional title, and Markdown-formatted content.",
        parameters: {
            type: "object",
            properties: {
                fileName: {
                    type: "string",
                    description: "The valid file name for the note. It must be suitable for use as a file name and must not contain forbidden or unsafe characters such as /, \\, :, *, ?, \", <, >, |, or control characters. Use a clear, concise name based on the note topic. Include the .md extension if the user provides it or if Markdown files are expected."
                },
                title: {
                    type: "string",
                    description: "The title of the note. Use a concise, human-readable title based on the user's request or the note content."
                },
                content: {
                    type: "string",
                    description: "The full content of the note formatted as valid Markdown. Preserve existing Markdown formatting when provided. If the source content has little or no formatting, add appropriate Markdown structure such as headings, paragraphs, lists, links, code blocks, tables, or emphasis where useful, without changing the meaning."
                }
            },
            required: ["fileName", "content"],
        }
    }
} satisfies AiTool;

export async function createNote(
    args?: AiJsonObject
): Promise<CreateNoteResult> {
    const startedAt = Date.now();
    logger.debug("start", {args});

    const fileName = asNonEmptyString(args?.fileName) ?? "";
    if (!fileName.trim().length) {
        return {success: false, error: "No file name provided"};
    }
    const title = asNonEmptyString(args?.title) ?? fileName;

    const content = asNonEmptyString(args?.content) ?? "";
    if (!content.trim().length) {
        return {success: false, error: "No content provided"};
    }

    const newFilePath = path.join(notesDir, fileName.endsWith(".md") ? fileName : fileName + ".md");
    const linkMarkdown = `* [${title}](${path.relative(path.dirname(notesRootFile), newFilePath)})`;

    try {
        if (fs.existsSync(newFilePath)) {
            return {success: false, error: "File already exists"};
        }

        await writeFile(newFilePath, content, "utf-8");

        let rootContent: string;
        try {
            rootContent = await readFile(notesRootFile, "utf-8");
        } catch (e) {
            rootContent = "";
        }

        const notesHeaderIndex = rootContent.indexOf(NOTES_HEADER);
        if (notesHeaderIndex >= 0) {
            rootContent += "\n" + linkMarkdown;
        } else {
            rootContent = NOTES_HEADER + "\n" + linkMarkdown;
        }

        await writeFile(notesRootFile, rootContent, "utf-8");
        logger.debug("done", {fileName, filePath: newFilePath, duration: logger.duration(startedAt)});
        return {success: true, filePath: newFilePath};
    } catch (error) {
        logger.error("failed", {duration: logger.duration(startedAt), error: error instanceof Error ? error : String(error)});
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {success: false, error: `Failed to process files: ${errorMessage}`};
    }
}
