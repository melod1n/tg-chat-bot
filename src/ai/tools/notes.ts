import {AiTool} from "../tool-types.js";
import path from "node:path";
import {readdir, readFile, stat, unlink, writeFile} from "node:fs/promises";
import {notesDir, notesRootFile} from "../../index.js";
import {asNonEmptyString} from "./utils.js";
import {toolsLogger} from "./tool-logger.js";
import {z} from "zod";
import {AiJsonObject} from "../tool-types.js";

const logger = toolsLogger.child("notes");

export type NoteListItem = {
    fileName: string;
    filePath: string;
    relativePath: string;
    title: string;
};

export type ListNotesResult =
    | { success: true; notes: NoteListItem[] }
    | { success: false; error: string };

export type GetNoteContentResult =
    | {
    success: true;
    fileName: string;
    filePath: string;
    relativePath: string;
    title: string;
    content: string;
} | { success: false; error: string };

export const listNotesTool = {
    type: "function",
    function: {
        name: "list_notes",
        description: "Display all available Markdown notes from the notes directory.",
        parameters: {
            type: "object",
            properties: {},
            required: [],
        },
    },
} satisfies AiTool;

export const getNoteContentTool = {
    type: "function",
    function: {
        name: "get_note_content",
        description: "Get the full Markdown content of a specific note by its file name.",
        parameters: {
            type: "object",
            properties: {
                fileName: {
                    type: "string",
                    description:
                        "The file name of the note to read. It may be provided with or without the .md extension. Must not contain forbidden or unsafe characters such as /, \\, :, *, ?, \", <, >, |, or control characters.",
                },
            },
            required: ["fileName"],
        },
    },
} satisfies AiTool;

export async function listNotes(): Promise<ListNotesResult> {
    const startedAt = Date.now();
    logger.debug("list.start");

    try {
        const entries = await readdir(notesDir, {withFileTypes: true});

        const markdownFiles = entries
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name)
            .filter((fileName) => fileName.endsWith(".md") && !fileName.startsWith("index"));

        const notes: NoteListItem[] = await Promise.all(
            markdownFiles.map(async (fileName) => {
                const filePath = path.join(notesDir, fileName);
                const relativePath = path.relative(path.dirname(notesRootFile), filePath);

                let content = "";
                try {
                    content = await readFile(filePath, "utf-8");
                } catch {
                    // Ignore content read errors for individual files.
                }

                return {
                    fileName,
                    filePath,
                    relativePath,
                    title: extractNoteTitle(fileName, content),
                };
            }),
        );

        notes.sort((a, b) => a.title.localeCompare(b.title));

        logger.debug("list.done", {notes: notes.length, duration: logger.duration(startedAt)});
        return {success: true, notes};
    } catch (error) {
        logger.error("list.failed", {duration: logger.duration(startedAt), error: error instanceof Error ? error : String(error)});
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {success: false, error: `Failed to list notes: ${errorMessage}`};
    }
}

export async function getNoteContent(
    args?: AiJsonObject,
): Promise<GetNoteContentResult> {
    const startedAt = Date.now();
    logger.debug("get_content.start", {args});

    const fileName = asNonEmptyString(args?.fileName) ?? "";
    if (!fileName.trim().length) {
        return {success: false, error: "No file name provided"};
    }

    if (fileName.trim().includes("index")) {
        return {success: false, error: "It is forbidden to access `index.md`"};
    }

    const noteFilePath = buildSafeNoteFilePath(fileName);
    if (!noteFilePath) {
        return {success: false, error: "Invalid or unsafe file name provided"};
    }

    try {
        const content = await readFile(noteFilePath, "utf-8");
        const normalizedFileName = path.basename(noteFilePath);
        const relativePath = path.relative(path.dirname(notesRootFile), noteFilePath);

        logger.debug("get_content.done", {
            fileName: normalizedFileName,
            relativePath,
            chars: content.length,
            duration: logger.duration(startedAt)
        });
        return {
            success: true,
            fileName: normalizedFileName,
            filePath: noteFilePath,
            relativePath,
            title: extractNoteTitle(normalizedFileName, content),
            content,
        };
    } catch (error) {
        logger.error("list.failed", {duration: logger.duration(startedAt), error: error instanceof Error ? error : String(error)});
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {success: false, error: `Failed to read note: ${errorMessage}`};
    }
}

function extractNoteTitle(fileName: string, content: string): string {
    const headingMatch = content.match(/^#\s+(.+)$/m);
    const heading = headingMatch?.[1]?.trim();

    if (heading) {
        return heading;
    }

    return path.basename(fileName, ".md");
}

export function buildSafeNoteFilePath(fileName: string): string | null {
    const normalizedFileName = fileName.endsWith(".md") ? fileName : `${fileName}.md`;

    if (!normalizedFileName.trim().length) {
        return null;
    }

    const unsafeFileNamePattern = /[/\\:*?"<>|\x00-\x1F]/;
    if (unsafeFileNamePattern.test(normalizedFileName)) {
        return null;
    }

    const resolvedNotesDir = path.resolve(notesDir);
    const resolvedFilePath = path.resolve(notesDir, normalizedFileName);

    if (!resolvedFilePath.startsWith(resolvedNotesDir + path.sep)) {
        return null;
    }

    return resolvedFilePath;
}

export type UpdateNoteContentResult =
    | { success: true; filePath: string }
    | { success: false; error: string };

export type DeleteNoteResult =
    | { success: true; filePath: string }
    | { success: false; error: string };

export const updateNoteContentTool = {
    type: "function",
    function: {
        name: "update_note_content",
        description: "Update the full Markdown content of an existing note by its file name.",
        parameters: {
            type: "object",
            properties: {
                fileName: {
                    type: "string",
                    description:
                        "The file name of the note to update. It may be provided with or without the .md extension. Must not contain forbidden or unsafe characters such as /, \\, :, *, ?, \", <, >, |, or control characters.",
                },
                content: {
                    type: "string",
                    description:
                        "The new full content of the note formatted as valid Markdown. This replaces the previous content completely.",
                },
            },
            required: ["fileName", "content"],
        },
    },
} satisfies AiTool;

export const deleteNoteTool = {
    type: "function",
    function: {
        name: "delete_note",
        description: "Delete an existing Markdown note by its file name and remove its link from the notes root file if present. It is forbidden to delete/edit/rename `index.md` note.",
        parameters: {
            type: "object",
            properties: {
                fileName: {
                    type: "string",
                    description:
                        "The file name of the note to delete. It may be provided with or without the .md extension. Must not contain forbidden or unsafe characters such as /, \\, :, *, ?, \", <, >, |, or control characters. It is forbidden to delete/edit/rename `index.md` note.",
                },
            },
            required: ["fileName"],
        },
    },
} satisfies AiTool;

export async function updateNoteContent(
    args?: AiJsonObject,
): Promise<UpdateNoteContentResult> {
    const startedAt = Date.now();
    logger.debug("update_content.start", {args});

    const fileName = asNonEmptyString(args?.fileName) ?? "";
    if (!fileName.trim().length) {
        return {success: false, error: "No file name provided"};
    }

    if (fileName.trim().includes("index")) {
        return {success: false, error: "It is forbidden to edit `index.md`"};
    }

    const content = asNonEmptyString(args?.content) ?? "";
    if (!content.trim().length) {
        return {success: false, error: "No content provided"};
    }

    const noteFilePath = buildSafeNoteFilePath(fileName);
    if (!noteFilePath) {
        return {success: false, error: "Invalid or unsafe file name provided"};
    }

    try {
        await readFile(noteFilePath, "utf-8");
        await writeFile(noteFilePath, content, "utf-8");
        logger.debug("update_content.done", {
            fileName,
            filePath: noteFilePath,
            chars: content.length,
            duration: logger.duration(startedAt)
        });

        return {success: true, filePath: noteFilePath};
    } catch (error) {
        logger.error("list.failed", {duration: logger.duration(startedAt), error: error instanceof Error ? error : String(error)});
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {success: false, error: `Failed to update note: ${errorMessage}`};
    }
}

export async function deleteNote(
    args?: AiJsonObject,
): Promise<DeleteNoteResult> {
    const startedAt = Date.now();
    logger.debug("delete.start", {args});

    const fileName = asNonEmptyString(args?.fileName) ?? "";
    if (!fileName.trim().length) {
        return {success: false, error: "No file name provided"};
    }

    if (fileName.trim().includes("index")) {
        return {success: false, error: "It is forbidden to delete `index.md`"};
    }

    const noteFilePath = buildSafeNoteFilePath(fileName);
    if (!noteFilePath) {
        return {success: false, error: "Invalid or unsafe file name provided"};
    }

    try {
        await unlink(noteFilePath);
        await removeNoteLinkFromRoot(noteFilePath);
        logger.debug("delete.done", {fileName, filePath: noteFilePath, duration: logger.duration(startedAt)});

        return {success: true, filePath: noteFilePath};
    } catch (error) {
        logger.error("list.failed", {duration: logger.duration(startedAt), error: error instanceof Error ? error : String(error)});
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {success: false, error: `Failed to delete note: ${errorMessage}`};
    }
}

async function removeNoteLinkFromRoot(noteFilePath: string): Promise<void> {
    let rootContent: string;

    try {
        rootContent = await readFile(notesRootFile, "utf-8");
    } catch {
        return;
    }

    const relativePath = path.relative(path.dirname(notesRootFile), noteFilePath);
    const normalizedRelativePath = relativePath.replaceAll("\\", "\\\\");

    const escapedRelativePath = escapeRegExp(normalizedRelativePath);
    const linkLinePattern = new RegExp(
        `^\\s*[-*]\\s+\\[[^\\]]+]\\(${escapedRelativePath}\\)\\s*$\\n?`,
        "gm",
    );

    const updatedRootContent = rootContent.replace(linkLinePattern, "");

    if (updatedRootContent !== rootContent) {
        await writeFile(notesRootFile, updatedRootContent.trimEnd() + "\n", "utf-8");
    }
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type NoteFileAttachment = {
    type: "local_file";
    fileName: string;
    // filePath: string;
    relativePath: string;
    mimeType: "text/markdown";
    sizeBytes: number;
};

export type GetNoteFileResult =
    | {
    success: true;
    attachment: NoteFileAttachment;
} | { success: false; error: string };

export const NoteFileAttachmentSchema = z.object({
    type: z.literal("local_file"),
    fileName: z.string(),
    // filePath: z.string(),
    relativePath: z.string(),
    mimeType: z.literal("text/markdown"),
    sizeBytes: z.number(),
});

export const GetNoteFileResultSchema = z.discriminatedUnion("success", [
    z.object({
        success: z.literal(true),
        attachment: NoteFileAttachmentSchema,
    }),
    z.object({
        success: z.literal(false),
        error: z.string(),
    }),
]);

export const sendNoteAsFileTool = {
    type: "function",
    function: {
        name: "send_note_as_file",
        description:
            "Prepare a Markdown note file to be sent to the user as a .md attachment. Returns a local file descriptor that the host application should use to upload or send the file.",
        parameters: {
            type: "object",
            properties: {
                fileName: {
                    type: "string",
                    description:
                        "The file name of the note to send. It may be provided with or without the .md extension. Must not contain forbidden or unsafe characters such as /, \\, :, *, ?, \", <, >, |, or control characters.",
                },
            },
            required: ["fileName"],
        },
    },
} satisfies AiTool;

export async function sendNoteAsFile(
    args?: AiJsonObject,
): Promise<GetNoteFileResult> {
    logger.debug("start", {args});

    const fileName = asNonEmptyString(args?.fileName) ?? "";
    if (!fileName.trim().length) {
        return {success: false, error: "No file name provided"};
    }

    const noteFilePath = buildSafeNoteFilePath(fileName);
    if (!noteFilePath) {
        return {success: false, error: "Invalid or unsafe file name provided"};
    }

    try {
        // Проверяем, что файл существует и действительно читается.
        await readFile(noteFilePath, "utf-8");

        const fileStat = await stat(noteFilePath);
        if (!fileStat.isFile()) {
            return {success: false, error: "Note path is not a file"};
        }

        const normalizedFileName = path.basename(noteFilePath);
        const relativePath = path.relative(path.dirname(notesRootFile), noteFilePath);

        const result: GetNoteFileResult = {
            success: true,
            attachment: {
                type: "local_file",
                fileName: normalizedFileName,
                // filePath: noteFilePath,
                relativePath,
                mimeType: "text/markdown",
                sizeBytes: fileStat.size,
            },
        };

        logger.debug("done", {
            fileName: result.attachment.fileName,
            relativePath: result.attachment.relativePath,
            sizeBytes: result.attachment.sizeBytes
        });

        return result;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {success: false, error: `Failed to prepare note file: ${errorMessage}`};
    }
}
