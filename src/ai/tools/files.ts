import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {z} from "zod";

import {Environment} from "../../common/environment.js";
import {AiJsonObject, AiJsonValue, AiTool} from "../tool-types.js";
import {
    MAX_COPY_ENTRIES,
    MAX_COPY_TOTAL_BYTES,
    MAX_DIRECTORY_ENTRIES,
    MAX_FILE_ATTACHMENT_BYTES,
    MAX_FILE_READ_BYTES,
    MAX_FILE_SEARCH_CONTENT_BYTES,
    MAX_FILE_SEARCH_ENTRIES,
    MAX_FILE_SEARCH_RESULTS,
    MAX_FILE_SEARCH_SNIPPET_CHARS,
    MAX_FILE_WRITE_BYTES,
    MAX_FILE_WRITE_CHUNK_BYTES,
    MAX_PATCH_OPERATIONS,
    MAX_PATCH_PREVIEW_CHARS,
    MAX_PATCH_REPLACE_BYTES,
    MAX_PATCH_SEARCH_BYTES,
    MAX_STREAM_WRITE_IDLE_MS,
    MAX_STREAM_WRITE_SESSIONS,
} from "./limits.js";
import {asBoolean, asNonEmptyString, asPositiveInt, asString} from "./utils.js";

// =============================================================================
// Public types and schemas
// =============================================================================

export type LocalFileAttachment = {
    type: "local_file";
    fileName: string;
    relativePath: string;
    mimeType: string;
    sizeBytes: number;
};

export type SendFileAttachmentResult =
    | {
    success: true;
    attachment: LocalFileAttachment;
}
    | {
    success: false;
    error: string;
};

export const LocalFileAttachmentSchema = z.object({
    type: z.literal("local_file"),
    fileName: z.string(),
    relativePath: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number(),
});

export const SendFileAttachmentResultSchema = z.discriminatedUnion("success", [
    z.object({
        success: z.literal(true),
        attachment: LocalFileAttachmentSchema,
    }),
    z.object({
        success: z.literal(false),
        error: z.string(),
    }),
]);

type CopyPathStats = {
    entries: number;
    totalBytes: number;
};

type SearchResultType = "file" | "directory";

type FileSearchResult = {
    path: string;
    name: string;
    type: SearchResultType;
    sizeBytes: number | null;
    modifiedAt: string;
    matchedBy: {
        name: boolean;
        path: boolean;
        content: boolean;
    };
    contentMatch?: {
        line: number;
        column: number;
        snippet: string;
    };
};

const PATCH_OPERATION_TYPES = [
    "replace",
    "insert_before",
    "insert_after",
    "delete",
] as const;

type PatchOperationType = (typeof PATCH_OPERATION_TYPES)[number];

type ParsedPatchOperation = {
    type: PatchOperationType;
    search: string;
    replace: string;
};

type AppliedPatchOperation = {
    index: number;
    type: PatchOperationType;
    line: number;
    column: number;
    searchBytes: number;
    replaceBytes: number;
};

type FileWriteSession = {
    sessionId: string;
    targetAbsolutePath: string;
    targetRelativePath: string;
    tempAbsolutePath: string;
    tempRelativePath: string;
    overwrite: boolean;
    bytesWritten: number;
    nextChunkIndex: number;
    createdAtMs: number;
    updatedAtMs: number;
    rootDir: string;
    userId?: number | null;
};

const fileWriteSessions = new Map<string, FileWriteSession>();

// =============================================================================
// Tool declarations
// =============================================================================

export const readFileTool = {
    type: "function",
    function: {
        name: "read_file",
        description:
            "Read a UTF-8 text file inside the hardcoded root directory. Use only relative paths. Going up with ../ and absolute paths are forbidden.",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description:
                        "Relative file path inside the root directory, for example notes/task.txt.",
                },
                maxBytes: {
                    type: "number",
                    description: `Optional max bytes to read. Maximum allowed value is ${MAX_FILE_READ_BYTES}.`,
                },
            },
            required: ["path"],
        },
    },
} satisfies AiTool;

export const listDirectoryTool = {
    type: "function",
    function: {
        name: "list_directory",
        description:
            "List files and directories inside the hardcoded root directory. Use only relative paths. Going up with ../ and absolute paths are forbidden.",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description:
                        "Relative directory path inside the root directory. Use . for root.",
                },
            },
            required: [],
        },
    },
} satisfies AiTool;

export const searchFilesTool = {
    type: "function",
    function: {
        name: "search_files",
        description:
            "Search for files and optionally directories inside the hardcoded root directory. Can search by file name/path and optionally by exact text content. Use only relative paths. Going up with ../ and absolute paths are forbidden. Symlinks are forbidden.",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description:
                        "Relative directory path to search inside. Use . for root. Default is root.",
                },
                query: {
                    type: "string",
                    description:
                        "Case-insensitive substring to search in file/directory name and relative path. Optional if contentQuery is provided.",
                },
                contentQuery: {
                    type: "string",
                    description:
                        "Optional exact text substring to search inside UTF-8 text files. Binary files and large files are skipped.",
                },
                recursive: {
                    type: "boolean",
                    description: "Whether to search recursively. Default is true.",
                },
                caseSensitive: {
                    type: "boolean",
                    description:
                        "Whether query and contentQuery should be case-sensitive. Default is false.",
                },
                includeDirectories: {
                    type: "boolean",
                    description:
                        "Whether to include matching directories in results. Default is false.",
                },
                extensions: {
                    type: "array",
                    description:
                        'Optional list of file extensions to include, for example [".ts", ".json"]. Applies only to files.',
                    items: {
                        type: "string",
                    },
                },
                maxResults: {
                    type: "number",
                    description: `Optional max results. Maximum allowed value is ${MAX_FILE_SEARCH_RESULTS}.`,
                },
            },
            required: [],
        },
    },
} satisfies AiTool;

export const createFileTool = {
    type: "function",
    function: {
        name: "create_file",
        description:
            "Create a UTF-8 text file inside the hardcoded root directory. Use only relative paths. Going up with ../ and absolute paths are forbidden.",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "Relative file path inside the root directory.",
                },
                content: {
                    type: "string",
                    description: "File content.",
                },
                overwrite: {
                    type: "boolean",
                    description:
                        "Whether to overwrite the file if it already exists. Default is false.",
                },
                createParents: {
                    type: "boolean",
                    description:
                        "Whether to create parent directories automatically. Default is true.",
                },
            },
            required: ["path"],
        },
    },
} satisfies AiTool;

export const updateFileTool = {
    type: "function",
    function: {
        name: "update_file",
        description:
            "Update a UTF-8 text file inside the hardcoded root directory. Supports replace, append and prepend. Use only relative paths. Going up with ../ and absolute paths are forbidden.",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "Relative file path inside the root directory.",
                },
                content: {
                    type: "string",
                    description: "Content to write.",
                },
                mode: {
                    type: "string",
                    enum: ["replace", "append", "prepend"],
                    description: "Update mode. Default is replace.",
                },
                createIfMissing: {
                    type: "boolean",
                    description:
                        "Whether to create the file if it does not exist. Default is false.",
                },
            },
            required: ["path", "content"],
        },
    },
} satisfies AiTool;

export const editFilePatchTool = {
    type: "function",
    function: {
        name: "edit_file_patch",
        description:
            "Edit a UTF-8 text file inside the hardcoded root directory by applying exact-match patch operations. Use this instead of rewriting the whole file. Every search fragment must match exactly and must appear exactly once.",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "Relative file path inside the root directory.",
                },
                operations: {
                    type: "array",
                    minItems: 1,
                    maxItems: MAX_PATCH_OPERATIONS,
                    description:
                        "Patch operations applied sequentially. Each search fragment must match the current file content exactly and appear exactly once.",
                    items: {
                        type: "object",
                        properties: {
                            type: {
                                type: "string",
                                enum: ["replace", "insert_before", "insert_after", "delete"],
                                description: "Patch operation type.",
                            },
                            search: {
                                type: "string",
                                description:
                                    "Exact text fragment to find in the current file content. Must be copied exactly from read_file output.",
                            },
                            replace: {
                                type: "string",
                                description:
                                    "Replacement or inserted text. Required for replace, insert_before and insert_after. Ignored for delete.",
                            },
                        },
                        required: ["type", "search"],
                    },
                },
                dryRun: {
                    type: "boolean",
                    description:
                        "If true, validate and preview the patch without writing changes. Default is false.",
                },
                createBackup: {
                    type: "boolean",
                    description:
                        "If true, create a timestamped .bak file before writing changes. Ignored in dryRun mode. Default is false.",
                },
            },
            required: ["path", "operations"],
        },
    },
} satisfies AiTool;

export const createDirectoryTool = {
    type: "function",
    function: {
        name: "create_directory",
        description:
            "Create a directory inside the hardcoded root directory. Use only relative paths. Going up with ../ and absolute paths are forbidden.",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "Relative directory path inside the root directory.",
                },
                recursive: {
                    type: "boolean",
                    description:
                        "Whether to create parent directories automatically. Default is true.",
                },
            },
            required: ["path"],
        },
    },
} satisfies AiTool;

export const copyPathTool = {
    type: "function",
    function: {
        name: "copy_path",
        description:
            "Copy a file or directory inside the hardcoded root directory. Use only relative paths. Going up with ../ and absolute paths are forbidden. Directory copy requires recursive=true. Symlinks are forbidden.",
        parameters: {
            type: "object",
            properties: {
                sourcePath: {
                    type: "string",
                    description:
                        "Relative source file or directory path inside the root directory.",
                },
                targetPath: {
                    type: "string",
                    description:
                        "Relative target file or directory path inside the root directory.",
                },
                recursive: {
                    type: "boolean",
                    description: "Required for copying directories. Default is false.",
                },
                overwrite: {
                    type: "boolean",
                    description:
                        "Whether to overwrite existing files. Directory merge is allowed, but existing directories are not deleted. Default is false.",
                },
                createParents: {
                    type: "boolean",
                    description:
                        "Whether to create target parent directories automatically. Default is true.",
                },
            },
            required: ["sourcePath", "targetPath"],
        },
    },
} satisfies AiTool;

export const renamePathTool = {
    type: "function",
    function: {
        name: "rename_path",
        description:
            "Rename or move a file/directory inside the hardcoded root directory. This is the main directory modification tool. Use only relative paths. Going up with ../ and absolute paths are forbidden.",
        parameters: {
            type: "object",
            properties: {
                sourcePath: {
                    type: "string",
                    description: "Relative source path inside the root directory.",
                },
                targetPath: {
                    type: "string",
                    description: "Relative target path inside the root directory.",
                },
                overwrite: {
                    type: "boolean",
                    description:
                        "Whether to overwrite an existing target file. Directory overwrite is not supported. Default is false.",
                },
                createParents: {
                    type: "boolean",
                    description:
                        "Whether to create target parent directories automatically. Default is false.",
                },
            },
            required: ["sourcePath", "targetPath"],
        },
    },
} satisfies AiTool;

export const deletePathTool = {
    type: "function",
    function: {
        name: "delete_path",
        description:
            "Delete a file or directory inside the hardcoded root directory. Use only relative paths. Going up with ../ and absolute paths are forbidden. Recursive deletion requires recursive=true.",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description:
                        "Relative file or directory path inside the root directory.",
                },
                recursive: {
                    type: "boolean",
                    description:
                        "Whether to delete non-empty directories recursively. Default is false.",
                },
            },
            required: ["path"],
        },
    },
} satisfies AiTool;

export const sendFileAsAttachmentTool = {
    type: "function",
    function: {
        name: "send_file_as_attachment",
        description:
            "Prepare a file inside the hardcoded root directory to be sent to the user as an attachment. Returns a local file descriptor that the host application should use to upload or send the file. Does not return file bytes or file content.",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description:
                        "Relative file path inside the root directory. Use only relative paths. Going up with ../ and absolute paths are forbidden.",
                },
                fileName: {
                    type: "string",
                    description:
                        'Optional attachment file name visible to the user. If omitted, the original file basename is used. Must not contain /, \\, :, *, ?, \", <, >, |, or control characters.',
                },
                maxBytes: {
                    type: "number",
                    description: `Optional max allowed file size. Maximum allowed value is ${MAX_FILE_ATTACHMENT_BYTES}.`,
                },
            },
            required: ["path"],
        },
    },
} satisfies AiTool;

export const beginFileWriteTool = {
    type: "function",
    function: {
        name: "begin_file_write",
        description:
            "Begin chunked creation of a UTF-8 text file inside the hardcoded root directory. Creates a temporary file and returns a sessionId. Use this for large files instead of create_file.",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "Relative target file path inside the root directory.",
                },
                overwrite: {
                    type: "boolean",
                    description:
                        "Whether to overwrite the target file if it already exists. Default is false.",
                },
                createParents: {
                    type: "boolean",
                    description:
                        "Whether to create parent directories automatically. Default is true.",
                },
            },
            required: ["path"],
        },
    },
} satisfies AiTool;

export const writeFileChunkTool = {
    type: "function",
    function: {
        name: "write_file_chunk",
        description:
            "Append one UTF-8 text chunk to an active chunked file write session. Chunks must be written sequentially by chunkIndex starting from 1.",
        parameters: {
            type: "object",
            properties: {
                sessionId: {
                    type: "string",
                    description: "Session id returned by begin_file_write.",
                },
                chunkIndex: {
                    type: "number",
                    description: "Sequential chunk number starting from 1.",
                },
                chunk: {
                    type: "string",
                    description: `UTF-8 text chunk. Maximum allowed size is ${MAX_FILE_WRITE_CHUNK_BYTES} bytes.`,
                },
            },
            required: ["sessionId", "chunkIndex", "chunk"],
        },
    },
} satisfies AiTool;

export const finishFileWriteTool = {
    type: "function",
    function: {
        name: "finish_file_write",
        description:
            "Finish an active chunked file write session by moving the temporary file to the final target path.",
        parameters: {
            type: "object",
            properties: {
                sessionId: {
                    type: "string",
                    description: "Session id returned by begin_file_write.",
                },
            },
            required: ["sessionId"],
        },
    },
} satisfies AiTool;

export const cancelFileWriteTool = {
    type: "function",
    function: {
        name: "cancel_file_write",
        description:
            "Cancel an active chunked file write session and delete the temporary file.",
        parameters: {
            type: "object",
            properties: {
                sessionId: {
                    type: "string",
                    description: "Session id returned by begin_file_write.",
                },
            },
            required: ["sessionId"],
        },
    },
} satisfies AiTool;

export const fileToolsToolPrompt = [
    "Filesystem tool rules:",
    "- You have access to filesystem tools working only inside the hardcoded root directory.",
    "- All filesystem paths must be relative to the root directory.",
    "- You may go into child directories.",
    "- You must never go up to parent directories.",
    "- Do not use ../ paths.",
    "- Do not use absolute paths.",
    "- Do not try to access symlinks.",
    "- Use search_files to find files by name, path or text content before reading or editing unfamiliar files.",
    "- Use read_file for reading files.",
    "- Use list_directory for reading directories.",
    "- Use create_file for creating small or medium files in one call.",
    "- Use begin_file_write, write_file_chunk and finish_file_write for large files.",
    "- For chunked file writing, chunkIndex starts from 1 and must increase by 1 on every write_file_chunk call.",
    "- If chunked file writing fails or is no longer needed, use cancel_file_write.",
    "- Use create_directory for creating directories.",
    "- Use update_file for replacing, appending or prepending file content.",
    "- Use edit_file_patch for small exact-match file edits instead of rewriting the whole file.",
    "- Before using edit_file_patch, read the relevant file or fragment first.",
    "- For edit_file_patch, search fragments must be copied exactly from current file content.",
    "- Do not guess patch context. If unsure, read the file first.",
    "- Use rename_path for renaming or moving files/directories inside the root.",
    "- Use delete_path for deleting files/directories inside the root.",
    "- Use send_file_as_attachment when the user asks to receive, download, export or upload a file as an attachment.",
    "- send_file_as_attachment returns only a local file descriptor. The host application must actually send the file.",
    "",
].join("\n");

// =============================================================================
// Exported tool implementations
// =============================================================================

export async function readFile(args?: AiJsonObject) {
    const {absolutePath, relativePath, rootDir} = resolveSafeToolPath(
        args?.path,
        ".",
        args?.userId,
    );

    await assertNoSymlinkInPath(absolutePath, rootDir);

    const stat = await fs.promises.lstat(absolutePath);

    if (!stat.isFile()) {
        throw new Error(`Path is not a file: ${relativePath}`);
    }

    const maxBytes = asPositiveInt(
        args?.maxBytes,
        MAX_FILE_READ_BYTES,
        MAX_FILE_READ_BYTES,
    );

    if (stat.size > maxBytes) {
        throw new Error(
            `File is too large: ${stat.size} bytes. Max allowed: ${maxBytes} bytes.`,
        );
    }

    const buffer = await fs.promises.readFile(absolutePath);

    if (buffer.includes(0)) {
        throw new Error("Binary files are not supported.");
    }

    return {
        ok: true,
        path: relativePath,
        sizeBytes: stat.size,
        content: buffer.toString("utf8"),
    };
}

export async function listDirectory(args?: AiJsonObject) {
    const {absolutePath, relativePath, rootDir} = resolveSafeToolPath(
        args?.path,
        ".",
        args?.userId,
    );

    await assertNoSymlinkInPath(absolutePath, rootDir);

    const stat = await fs.promises.lstat(absolutePath);

    if (!stat.isDirectory()) {
        throw new Error(`Path is not a directory: ${relativePath}`);
    }

    const dirEntries = await fs.promises.readdir(absolutePath, {
        withFileTypes: true,
    });

    const limitedEntries = dirEntries.slice(0, MAX_DIRECTORY_ENTRIES);

    const entries = await Promise.all(
        limitedEntries.map(async (entry) => {
            const entryAbsolutePath = path.join(absolutePath, entry.name);
            const entryRelativePath =
                relativePath === "." ? entry.name : path.join(relativePath, entry.name);

            const entryStat = await fs.promises.lstat(entryAbsolutePath);

            return {
                name: entry.name,
                path: entryRelativePath,
                type: getEntryType(entryStat),
                sizeBytes: entryStat.isFile() ? entryStat.size : null,
                modifiedAt: entryStat.mtime.toISOString(),
            };
        }),
    );

    return {
        ok: true,
        path: relativePath,
        entries,
        totalEntries: dirEntries.length,
        returnedEntries: entries.length,
        truncated: dirEntries.length > entries.length,
    };
}

export async function searchFiles(args?: AiJsonObject) {
    const start = resolveSafeToolPath(args?.path, ".", args?.userId);

    await assertNoSymlinkInPath(start.absolutePath, start.rootDir);

    const startStat = await fs.promises.lstat(start.absolutePath);

    if (!startStat.isDirectory()) {
        throw new Error(`Search path is not a directory: ${start.relativePath}`);
    }

    const query = asNonEmptyString(args?.query);
    const contentQuery = asNonEmptyString(args?.contentQuery);

    if (!query && !contentQuery) {
        throw new Error("Either query or contentQuery must be provided.");
    }

    const recursive = asBoolean(args?.recursive, true);
    const caseSensitive = asBoolean(args?.caseSensitive, false);
    const includeDirectories = asBoolean(args?.includeDirectories, false);
    const extensions = parseSearchExtensions(args?.extensions);
    const maxResults = asPositiveInt(
        args?.maxResults,
        MAX_FILE_SEARCH_RESULTS,
        MAX_FILE_SEARCH_RESULTS,
    );

    const normalizedQuery = query
        ? normalizeForSearch(query, caseSensitive)
        : null;

    const results: FileSearchResult[] = [];
    const pendingDirectories: Array<{
        absolutePath: string;
        relativePath: string;
    }> = [start];

    let scannedEntries = 0;
    let truncated = false;

    while (pendingDirectories.length > 0) {
        const current = pendingDirectories.shift();

        if (!current) {
            break;
        }

        const entries = await fs.promises.readdir(current.absolutePath, {
            withFileTypes: true,
        });

        for (const entry of entries) {
            scannedEntries++;

            if (scannedEntries > MAX_FILE_SEARCH_ENTRIES) {
                truncated = true;
                pendingDirectories.length = 0;
                break;
            }

            if (results.length >= maxResults) {
                truncated = true;
                pendingDirectories.length = 0;
                break;
            }

            const entryAbsolutePath = path.join(current.absolutePath, entry.name);
            const entryRelativePath =
                current.relativePath === "."
                    ? entry.name
                    : path.join(current.relativePath, entry.name);

            const entryStat = await fs.promises.lstat(entryAbsolutePath);

            if (entryStat.isSymbolicLink()) {
                continue;
            }

            const isDirectory = entryStat.isDirectory();
            const isFile = entryStat.isFile();

            if (!isDirectory && !isFile) {
                continue;
            }

            if (isDirectory && recursive) {
                pendingDirectories.push({
                    absolutePath: entryAbsolutePath,
                    relativePath: entryRelativePath,
                });
            }

            if (isFile && !matchesExtension(entryRelativePath, extensions)) {
                continue;
            }

            if (isDirectory && !includeDirectories) {
                continue;
            }

            const normalizedName = normalizeForSearch(entry.name, caseSensitive);
            const normalizedPath = normalizeForSearch(
                entryRelativePath,
                caseSensitive,
            );

            const matchedByName = normalizedQuery
                ? normalizedName.includes(normalizedQuery)
                : false;
            const matchedByPath = normalizedQuery
                ? normalizedPath.includes(normalizedQuery)
                : false;

            let contentMatch: FileSearchResult["contentMatch"] | undefined;

            if (isFile && contentQuery) {
                const match = await tryFindTextInFile({
                    absolutePath: entryAbsolutePath,
                    query: contentQuery,
                    caseSensitive,
                });

                if (match) {
                    contentMatch = match;
                }
            }

            const matchedByContent = Boolean(contentMatch);

            if (!matchedByName && !matchedByPath && !matchedByContent) {
                continue;
            }

            results.push({
                path: entryRelativePath,
                name: entry.name,
                type: isDirectory ? "directory" : "file",
                sizeBytes: isFile ? entryStat.size : null,
                modifiedAt: entryStat.mtime.toISOString(),
                matchedBy: {
                    name: matchedByName,
                    path: matchedByPath,
                    content: matchedByContent,
                },
                contentMatch,
            });
        }
    }

    return {
        ok: true,
        path: start.relativePath,
        query: query ?? null,
        contentQuery: contentQuery ?? null,
        recursive,
        caseSensitive,
        includeDirectories,
        extensions,
        scannedEntries,
        returnedResults: results.length,
        maxResults,
        truncated,
        results,
    };
}

export async function createFile(args?: AiJsonObject) {
    const {absolutePath, relativePath, rootDir} = resolveSafeToolPath(
        args?.path,
        ".",
        args?.userId,
    );

    assertNotRoot(relativePath);

    const content = asString(args?.content, "");
    const overwrite = asBoolean(args?.overwrite, false);
    const createParents = asBoolean(args?.createParents, true);

    const contentSizeBytes = Buffer.byteLength(content, "utf8");

    if (contentSizeBytes > MAX_FILE_WRITE_BYTES) {
        throw new Error(
            `Content is too large: ${contentSizeBytes} bytes. Max allowed: ${MAX_FILE_WRITE_BYTES} bytes.`,
        );
    }

    const parentPath = path.dirname(absolutePath);

    if (createParents) {
        await assertNoSymlinkInPath(parentPath, rootDir, {allowMissingTail: true});
        await fs.promises.mkdir(parentPath, {recursive: true});
    } else {
        await assertNoSymlinkInPath(parentPath, rootDir);
    }

    if (await pathExists(absolutePath)) {
        const stat = await fs.promises.lstat(absolutePath);

        if (stat.isSymbolicLink()) {
            throw new Error("Symlink targets are not allowed.");
        }

        if (stat.isDirectory()) {
            throw new Error(`Path is a directory, not a file: ${relativePath}`);
        }

        if (!overwrite) {
            throw new Error(`File already exists: ${relativePath}`);
        }
    }

    await fs.promises.writeFile(absolutePath, content, {
        encoding: "utf8",
        flag: overwrite ? "w" : "wx",
    });

    return {
        ok: true,
        path: relativePath,
        sizeBytes: contentSizeBytes,
        overwritten: overwrite,
    };
}

export async function updateFile(args?: AiJsonObject) {
    const {absolutePath, relativePath, rootDir} = resolveSafeToolPath(
        args?.path,
        ".",
        args?.userId,
    );

    assertNotRoot(relativePath);

    const content = asString(args?.content, "");
    const mode = (asNonEmptyString(args?.mode) ?? "replace").toLowerCase();
    const createIfMissing = asBoolean(args?.createIfMissing, false);

    if (!["replace", "append", "prepend"].includes(mode)) {
        throw new Error(`Unsupported update mode: ${mode}`);
    }

    const contentSizeBytes = Buffer.byteLength(content, "utf8");

    if (contentSizeBytes > MAX_FILE_WRITE_BYTES) {
        throw new Error(
            `Content is too large: ${contentSizeBytes} bytes. Max allowed: ${MAX_FILE_WRITE_BYTES} bytes.`,
        );
    }

    const parentPath = path.dirname(absolutePath);

    await assertNoSymlinkInPath(parentPath, rootDir);

    const exists = await pathExists(absolutePath);

    if (!exists && !createIfMissing) {
        throw new Error(`File does not exist: ${relativePath}`);
    }

    if (exists) {
        await assertNoSymlinkInPath(absolutePath, rootDir);

        const stat = await fs.promises.lstat(absolutePath);

        if (!stat.isFile()) {
            throw new Error(`Path is not a file: ${relativePath}`);
        }
    }

    if (mode === "replace") {
        await fs.promises.writeFile(absolutePath, content, {
            encoding: "utf8",
            flag: "w",
        });
    } else if (mode === "append") {
        await fs.promises.appendFile(absolutePath, content, {
            encoding: "utf8",
        });
    } else {
        const oldContent = exists
            ? await fs.promises.readFile(absolutePath, "utf8")
            : "";
        const resultSizeBytes = Buffer.byteLength(content + oldContent, "utf8");

        if (resultSizeBytes > MAX_FILE_WRITE_BYTES) {
            throw new Error(
                `Result file content is too large: ${resultSizeBytes} bytes. Max allowed: ${MAX_FILE_WRITE_BYTES} bytes.`,
            );
        }

        await fs.promises.writeFile(absolutePath, content + oldContent, {
            encoding: "utf8",
            flag: "w",
        });
    }

    const newStat = await fs.promises.stat(absolutePath);

    return {
        ok: true,
        path: relativePath,
        mode,
        sizeBytes: newStat.size,
        created: !exists,
    };
}

export async function editFilePatch(args?: AiJsonObject) {
    const {absolutePath, relativePath, rootDir} = resolveSafeToolPath(
        args?.path,
        ".",
        args?.userId,
    );

    assertNotRoot(relativePath);

    await assertNoSymlinkInPath(absolutePath, rootDir);

    const stat = await fs.promises.lstat(absolutePath);

    if (stat.isSymbolicLink()) {
        throw new Error("Symlink targets are not allowed.");
    }

    if (!stat.isFile()) {
        throw new Error(`Path is not a file: ${relativePath}`);
    }

    if (stat.size > MAX_FILE_READ_BYTES) {
        throw new Error(
            `File is too large to patch: ${stat.size} bytes. Max allowed: ${MAX_FILE_READ_BYTES} bytes.`,
        );
    }

    const operations = parsePatchOperations(args?.operations);
    const dryRun = asBoolean(args?.dryRun, false);
    const createBackup = asBoolean(args?.createBackup, false);

    const buffer = await fs.promises.readFile(absolutePath);

    if (buffer.includes(0)) {
        throw new Error("Binary files are not supported.");
    }

    const originalContent = buffer.toString("utf8");
    let content = originalContent;

    const appliedOperations: AppliedPatchOperation[] = [];

    for (const [index, operation] of operations.entries()) {
        const occurrences = findExactOccurrences(content, operation.search);

        if (occurrences.length === 0) {
            throw new Error(
                `Operation #${index} failed: search fragment was not found.`,
            );
        }

        if (occurrences.length > 1) {
            throw new Error(
                `Operation #${index} failed: search fragment is ambiguous and appears ${occurrences.length} times.`,
            );
        }

        const position = occurrences[0];
        const location = getLineColumn(content, position);
        const replacement = buildPatchReplacement(operation);

        content = replaceAt(
            content,
            position,
            operation.search.length,
            replacement,
        );

        const resultSizeBytes = Buffer.byteLength(content, "utf8");

        if (resultSizeBytes > MAX_FILE_WRITE_BYTES) {
            throw new Error(
                `Result file content is too large: ${resultSizeBytes} bytes. Max allowed: ${MAX_FILE_WRITE_BYTES} bytes.`,
            );
        }

        appliedOperations.push({
            index,
            type: operation.type,
            line: location.line,
            column: location.column,
            searchBytes: Buffer.byteLength(operation.search, "utf8"),
            replaceBytes: Buffer.byteLength(replacement, "utf8"),
        });
    }

    const changed = content !== originalContent;
    let backupPath: string | null = null;

    if (!dryRun && changed) {
        if (createBackup) {
            backupPath = await createPatchBackup(absolutePath, originalContent, rootDir);
        }

        await writeTextFileAtomic(absolutePath, content, rootDir);
    }

    return {
        ok: true,
        path: relativePath,
        dryRun,
        changed,
        backupPath,
        operationsApplied: appliedOperations,
        beforeSizeBytes: Buffer.byteLength(originalContent, "utf8"),
        afterSizeBytes: Buffer.byteLength(content, "utf8"),
        preview: dryRun ? buildPatchPreview(originalContent, content) : undefined,
    };
}

export async function createDirectory(args?: AiJsonObject) {
    const {absolutePath, relativePath, rootDir} = resolveSafeToolPath(
        args?.path,
        ".",
        args?.userId,
    );

    const recursive = asBoolean(args?.recursive, true);

    await assertNoSymlinkInPath(absolutePath, rootDir, {allowMissingTail: true});

    await fs.promises.mkdir(absolutePath, {
        recursive,
    });

    return {
        ok: true,
        path: relativePath,
        recursive,
    };
}

export async function copyPath(args?: AiJsonObject) {
    const source = resolveSafeToolPath(args?.sourcePath, undefined, args?.userId);
    const target = resolveSafeToolPath(args?.targetPath, undefined, args?.userId);

    assertNotRoot(source.relativePath);
    assertNotRoot(target.relativePath);

    await assertNoSymlinkInPath(source.absolutePath, source.rootDir);

    const sourceStat = await fs.promises.lstat(source.absolutePath);

    if (sourceStat.isSymbolicLink()) {
        throw new Error("Symlink sources are not allowed.");
    }

    const recursive = asBoolean(args?.recursive, false);
    const overwrite = asBoolean(args?.overwrite, false);
    const createParents = asBoolean(args?.createParents, true);

    if (sourceStat.isDirectory() && !recursive) {
        throw new Error(
            "Source is a directory. Set recursive=true to copy directories.",
        );
    }

    if (sourceStat.isDirectory()) {
        assertTargetIsNotInsideSource(source.absolutePath, target.absolutePath);
    }

    const targetParentPath = path.dirname(target.absolutePath);

    if (createParents) {
        await assertNoSymlinkInPath(targetParentPath, source.rootDir, {
            allowMissingTail: true,
        });

        await fs.promises.mkdir(targetParentPath, {
            recursive: true,
        });

        await assertNoSymlinkInPath(targetParentPath, source.rootDir);
    } else {
        await assertNoSymlinkInPath(targetParentPath, source.rootDir);
    }

    const stats: CopyPathStats = {
        entries: 0,
        totalBytes: 0,
    };

    await copyPathRecursive({
        sourceAbsolutePath: source.absolutePath,
        targetAbsolutePath: target.absolutePath,
        overwrite,
        stats,
        rootDir: source.rootDir
    });

    return {
        ok: true,
        from: source.relativePath,
        to: target.relativePath,
        recursive,
        overwrite,
        entriesCopied: stats.entries,
        bytesCopied: stats.totalBytes,
    };
}

export async function renamePath(args?: AiJsonObject) {
    const source = resolveSafeToolPath(args?.sourcePath, undefined, args?.userId);
    const target = resolveSafeToolPath(args?.targetPath, undefined, args?.userId);

    assertNotRoot(source.relativePath);
    assertNotRoot(target.relativePath);

    await assertNoSymlinkInPath(source.absolutePath, source.rootDir);

    const sourceStat = await fs.promises.lstat(source.absolutePath);

    if (sourceStat.isSymbolicLink()) {
        throw new Error("Symlink targets are not allowed.");
    }

    const relativeTargetInsideSource = path.relative(
        source.absolutePath,
        target.absolutePath,
    );

    if (
        relativeTargetInsideSource === "" ||
        (!relativeTargetInsideSource.startsWith("..") &&
            !path.isAbsolute(relativeTargetInsideSource))
    ) {
        throw new Error("Cannot move a directory into itself.");
    }

    const overwrite = asBoolean(args?.overwrite, false);
    const createParents = asBoolean(args?.createParents, false);

    const targetParentPath = path.dirname(target.absolutePath);

    if (createParents) {
        await assertNoSymlinkInPath(targetParentPath, target.rootDir, {allowMissingTail: true});
        await fs.promises.mkdir(targetParentPath, {recursive: true});
    } else {
        await assertNoSymlinkInPath(targetParentPath, target.rootDir);
    }

    if (await pathExists(target.absolutePath)) {
        const targetStat = await fs.promises.lstat(target.absolutePath);

        if (targetStat.isSymbolicLink()) {
            throw new Error("Symlink targets are not allowed.");
        }

        if (!overwrite) {
            throw new Error(`Target already exists: ${target.relativePath}`);
        }

        if (sourceStat.isDirectory() || targetStat.isDirectory()) {
            throw new Error("Overwrite for directories is not supported.");
        }

        await fs.promises.rm(target.absolutePath, {
            force: false,
        });
    }

    await fs.promises.rename(source.absolutePath, target.absolutePath);

    return {
        ok: true,
        from: source.relativePath,
        to: target.relativePath,
        overwrite,
    };
}

export async function deletePath(args?: AiJsonObject) {
    const {absolutePath, relativePath, rootDir} = resolveSafeToolPath(
        args?.path,
        ".",
        args?.userId,
    );

    assertNotRoot(relativePath);

    await assertNoSymlinkInPath(absolutePath, rootDir);

    const stat = await fs.promises.lstat(absolutePath);

    if (stat.isSymbolicLink()) {
        throw new Error("Symlink targets are not allowed.");
    }

    const recursive = asBoolean(args?.recursive, false);

    if (stat.isDirectory()) {
        if (recursive) {
            await fs.promises.rm(absolutePath, {
                recursive: true,
                force: false,
            });
        } else {
            await fs.promises.rmdir(absolutePath);
        }
    } else {
        await fs.promises.rm(absolutePath, {
            force: false,
        });
    }

    return {
        ok: true,
        path: relativePath,
        recursive,
        deleted: true,
    };
}

export async function sendFileAsAttachment(
    args?: AiJsonObject,
): Promise<SendFileAttachmentResult> {
    try {
        const target = resolveSafeToolPath(args?.path, undefined, args?.userId);

        assertNotRoot(target.relativePath);

        await assertNoSymlinkInPath(target.absolutePath, target.rootDir);

        const stat = await fs.promises.lstat(target.absolutePath);

        if (stat.isSymbolicLink()) {
            return {
                success: false,
                error: "Symlink targets are not allowed.",
            };
        }

        if (!stat.isFile()) {
            return {
                success: false,
                error: `Path is not a file: ${target.relativePath}`,
            };
        }

        const maxBytes = asPositiveInt(
            args?.maxBytes,
            MAX_FILE_ATTACHMENT_BYTES,
            MAX_FILE_ATTACHMENT_BYTES,
        );

        if (stat.size > maxBytes) {
            return {
                success: false,
                error: `File is too large: ${stat.size} bytes. Max allowed: ${maxBytes} bytes.`,
            };
        }

        const requestedFileName = asNonEmptyString(args?.fileName);
        const fileName =
            requestedFileName?.trim() || path.basename(target.relativePath);

        if (!isSafeAttachmentFileName(fileName)) {
            return {
                success: false,
                error: "Invalid or unsafe attachment file name provided.",
            };
        }

        return {
            success: true,
            attachment: {
                type: "local_file",
                fileName,
                relativePath: target.relativePath,
                mimeType: guessMimeType(fileName),
                sizeBytes: stat.size,
            },
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        return {
            success: false,
            error: `Failed to prepare file attachment: ${errorMessage}`,
        };
    }
}

export async function beginFileWrite(args?: AiJsonObject) {
    await cleanupExpiredFileWriteSessions();

    if (fileWriteSessions.size >= MAX_STREAM_WRITE_SESSIONS) {
        throw new Error(
            `Too many active file write sessions. Max allowed: ${MAX_STREAM_WRITE_SESSIONS}.`,
        );
    }

    const target = resolveSafeToolPath(args?.path, undefined, args?.userId);

    assertNotRoot(target.relativePath);

    const overwrite = asBoolean(args?.overwrite, false);
    const createParents = asBoolean(args?.createParents, true);

    const targetParentPath = path.dirname(target.absolutePath);

    if (createParents) {
        await assertNoSymlinkInPath(targetParentPath, target.rootDir, {
            allowMissingTail: true,
        });

        await fs.promises.mkdir(targetParentPath, {
            recursive: true,
        });

        await assertNoSymlinkInPath(targetParentPath, target.rootDir);
    } else {
        await assertNoSymlinkInPath(targetParentPath, target.rootDir);
    }

    if (await pathExists(target.absolutePath)) {
        const targetStat = await fs.promises.lstat(target.absolutePath);

        if (targetStat.isSymbolicLink()) {
            throw new Error("Symlink targets are not allowed.");
        }

        if (targetStat.isDirectory()) {
            throw new Error(
                `Path is a directory, not a file: ${target.relativePath}`,
            );
        }

        if (!overwrite) {
            throw new Error(`File already exists: ${target.relativePath}`);
        }
    }

    const sessionId = crypto.randomUUID();
    const tempAbsolutePath = path.join(
        targetParentPath,
        `.${path.basename(target.absolutePath)}.${sessionId}.tmp`,
    );
    const tempRelativePath = path.relative(target.rootDir, tempAbsolutePath);

    await fs.promises.writeFile(tempAbsolutePath, "", {
        encoding: "utf8",
        flag: "wx",
    });

    const now = Date.now();
    const session: FileWriteSession = {
        sessionId,
        targetAbsolutePath: target.absolutePath,
        targetRelativePath: target.relativePath,
        tempAbsolutePath,
        tempRelativePath,
        overwrite,
        bytesWritten: 0,
        nextChunkIndex: 1,
        createdAtMs: now,
        updatedAtMs: now,
        rootDir: target.rootDir,
        userId: parseTelegramUserId(args?.userId)
    };

    fileWriteSessions.set(sessionId, session);

    return {
        ok: true,
        sessionId,
        path: target.relativePath,
        tempPath: tempRelativePath,
        overwrite,
        nextChunkIndex: session.nextChunkIndex,
        bytesWritten: session.bytesWritten,
    };
}

export async function writeFileChunk(args?: AiJsonObject) {
    await cleanupExpiredFileWriteSessions();

    const session = getFileWriteSession(args?.sessionId);
    const chunkIndex = parsePositiveInteger(args?.chunkIndex, "chunkIndex");

    if (chunkIndex !== session.nextChunkIndex) {
        throw new Error(
            `Invalid chunkIndex. Expected ${session.nextChunkIndex}, got ${chunkIndex}.`,
        );
    }

    const chunk = asString(args?.chunk, "");

    if (chunk.includes("\0")) {
        throw new Error("Binary content is not supported.");
    }

    const chunkSizeBytes = Buffer.byteLength(chunk, "utf8");

    if (chunkSizeBytes > MAX_FILE_WRITE_CHUNK_BYTES) {
        throw new Error(
            `Chunk is too large: ${chunkSizeBytes} bytes. Max allowed: ${MAX_FILE_WRITE_CHUNK_BYTES} bytes.`,
        );
    }

    const resultSizeBytes = session.bytesWritten + chunkSizeBytes;

    if (resultSizeBytes > MAX_FILE_WRITE_BYTES) {
        throw new Error(
            `Result file content is too large: ${resultSizeBytes} bytes. Max allowed: ${MAX_FILE_WRITE_BYTES} bytes.`,
        );
    }

    await assertNoSymlinkInPath(session.tempAbsolutePath, session.rootDir);

    const tempStat = await fs.promises.lstat(session.tempAbsolutePath);

    if (!tempStat.isFile()) {
        throw new Error("Temporary write path is not a file.");
    }

    if (tempStat.isSymbolicLink()) {
        throw new Error("Symlink temporary files are not allowed.");
    }

    await fs.promises.appendFile(session.tempAbsolutePath, chunk, {
        encoding: "utf8",
    });

    session.bytesWritten = resultSizeBytes;
    session.nextChunkIndex++;
    session.updatedAtMs = Date.now();

    return {
        ok: true,
        sessionId: session.sessionId,
        path: session.targetRelativePath,
        acceptedChunkIndex: chunkIndex,
        chunkSizeBytes,
        bytesWritten: session.bytesWritten,
        nextChunkIndex: session.nextChunkIndex,
    };
}

export async function finishFileWrite(args?: AiJsonObject) {
    await cleanupExpiredFileWriteSessions();

    const session = getFileWriteSession(args?.sessionId);

    await assertNoSymlinkInPath(path.dirname(session.targetAbsolutePath), session.rootDir);
    await assertNoSymlinkInPath(session.tempAbsolutePath, session.rootDir);

    const tempStat = await fs.promises.lstat(session.tempAbsolutePath);

    if (!tempStat.isFile()) {
        throw new Error("Temporary write path is not a file.");
    }

    if (tempStat.isSymbolicLink()) {
        throw new Error("Symlink temporary files are not allowed.");
    }

    if (await pathExists(session.targetAbsolutePath)) {
        const targetStat = await fs.promises.lstat(session.targetAbsolutePath);

        if (targetStat.isSymbolicLink()) {
            throw new Error("Symlink targets are not allowed.");
        }

        if (targetStat.isDirectory()) {
            throw new Error(
                `Path is a directory, not a file: ${session.targetRelativePath}`,
            );
        }

        if (!session.overwrite) {
            throw new Error(`File already exists: ${session.targetRelativePath}`);
        }

        await fs.promises.rm(session.targetAbsolutePath, {
            force: false,
        });
    }

    await fs.promises.rename(
        session.tempAbsolutePath,
        session.targetAbsolutePath,
    );

    fileWriteSessions.delete(session.sessionId);

    const finalStat = await fs.promises.stat(session.targetAbsolutePath);

    return {
        ok: true,
        sessionId: session.sessionId,
        path: session.targetRelativePath,
        sizeBytes: finalStat.size,
        chunksWritten: session.nextChunkIndex - 1,
        overwritten: session.overwrite,
    };
}

export async function cancelFileWrite(args?: AiJsonObject) {
    const session = getFileWriteSession(args?.sessionId);

    fileWriteSessions.delete(session.sessionId);

    await fs.promises.rm(session.tempAbsolutePath, {
        force: true,
    });

    return {
        ok: true,
        sessionId: session.sessionId,
        path: session.targetRelativePath,
        cancelled: true,
        bytesWritten: session.bytesWritten,
        chunksWritten: session.nextChunkIndex - 1,
    };
}

// =============================================================================
// Path and filesystem helpers
// =============================================================================

function parseTelegramUserId(input: AiJsonValue | null | undefined): number | null {
    if (input === null || input === undefined) {
        return null;
    }

    if (
        typeof input !== "number" ||
        !Number.isSafeInteger(input) ||
        input <= 0
    ) {
        throw new Error("userId must be a positive safe integer.");
    }

    return input;
}

function requireFileToolsRootDir(userIdInput?: AiJsonValue | null | undefined): string {
    const baseRootDir = Environment.FILE_TOOLS_ROOT_DIR as string;
    const userId = parseTelegramUserId(userIdInput);

    if (userId === null) {
        return baseRootDir;
    }

    return path.join(baseRootDir, String(userId));
}

async function ensureFileToolsRootExists(rootDir: string): Promise<void> {
    await fs.promises.mkdir(rootDir, {recursive: true});

    const stat = await fs.promises.stat(rootDir);

    if (!stat.isDirectory()) {
        throw new Error(`File tools root is not a directory: ${rootDir}`);
    }
}

function resolveSafeToolPath(
    inputPath: AiJsonValue | null | undefined,
    fallback = ".",
    userIdInput?: AiJsonValue | null | undefined,
): {
    absolutePath: string;
    relativePath: string;
    rootDir: string;
} {
    const rootDir = requireFileToolsRootDir(userIdInput);
    const rawPath = asNonEmptyString(inputPath) ?? fallback;

    if (rawPath.includes("\0")) {
        throw new Error("Path must not contain null bytes.");
    }

    if (
        path.isAbsolute(rawPath) ||
        path.win32.isAbsolute(rawPath) ||
        path.posix.isAbsolute(rawPath)
    ) {
        throw new Error(
            "Absolute paths are not allowed. Use only relative paths inside the root directory.",
        );
    }

    const normalizedInputPath = rawPath.replace(/[\\/]+/g, path.sep);
    const absolutePath = path.resolve(rootDir, normalizedInputPath);
    const relativePath = path.relative(rootDir, absolutePath);

    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error(
            "Path escapes the root directory. Going up is not allowed.",
        );
    }

    return {
        absolutePath,
        relativePath: relativePath || ".",
        rootDir,
    };
}

function assertNotRoot(relativePath: string): void {
    if (relativePath === ".") {
        throw new Error("Operation on the root directory itself is not allowed.");
    }
}

function assertTargetIsNotInsideSource(
    sourceAbsolutePath: string,
    targetAbsolutePath: string,
): void {
    const relative = path.relative(sourceAbsolutePath, targetAbsolutePath);

    if (
        relative === "" ||
        (!relative.startsWith("..") && !path.isAbsolute(relative))
    ) {
        throw new Error("Cannot copy a directory into itself.");
    }
}

async function assertNoSymlinkInPath(
    absolutePath: string,
    rootDir: string,
    options?: {
        allowMissingTail?: boolean;
    },
): Promise<void> {
    await ensureFileToolsRootExists(rootDir);

    const relativePath = path.relative(rootDir, absolutePath);

    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error("Path escapes the root directory.");
    }

    if (!relativePath || relativePath === ".") {
        return;
    }

    const parts = relativePath.split(path.sep).filter(Boolean);
    let currentPath = rootDir;

    for (const part of parts) {
        currentPath = path.join(currentPath, part);

        try {
            const stat = await fs.promises.lstat(currentPath);

            if (stat.isSymbolicLink()) {
                throw new Error("Symlinks are not allowed in file tool paths.");
            }
        } catch (error) {
            if (error instanceof Error && "code" in error && (error as {code?: string}).code === "ENOENT" && options?.allowMissingTail) {
                return;
            }

            throw error;
        }
    }
}

async function pathExists(absolutePath: string): Promise<boolean> {
    try {
        await fs.promises.lstat(absolutePath);
        return true;
    } catch (error) {
        if (error instanceof Error && "code" in error && (error as {code?: string}).code === "ENOENT") {
            return false;
        }

        throw error;
    }
}

async function writeTextFileAtomic(
    absolutePath: string,
    content: string,
    rootDir: string
): Promise<void> {
    const directory = path.dirname(absolutePath);
    const basename = path.basename(absolutePath);
    const tempPath = path.join(
        directory,
        `.${basename}.${process.pid}.${Date.now()}.tmp`,
    );

    try {
        await fs.promises.writeFile(tempPath, content, {
            encoding: "utf8",
            flag: "wx",
        });

        await assertNoSymlinkInPath(absolutePath, rootDir);

        const targetStat = await fs.promises.lstat(absolutePath);

        if (!targetStat.isFile()) {
            throw new Error(
                "Target path stopped being a regular file during patch write.",
            );
        }

        if (targetStat.isSymbolicLink()) {
            throw new Error("Symlink targets are not allowed.");
        }

        await fs.promises.rename(tempPath, absolutePath);
    } catch (error) {
        await fs.promises.rm(tempPath, {
            force: true,
        });

        throw error;
    }
}

async function createPatchBackup(
    absolutePath: string,
    originalContent: string,
    rootDir: string,
): Promise<string> {
    const safeTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupAbsolutePath = `${absolutePath}.bak.${safeTimestamp}`;

    await fs.promises.writeFile(backupAbsolutePath, originalContent, {
        encoding: "utf8",
        flag: "wx",
    });

    return path.relative(rootDir, backupAbsolutePath);
}

function getEntryType(
    stat: fs.Stats,
): "file" | "directory" | "symlink" | "other" {
    if (stat.isSymbolicLink()) return "symlink";
    if (stat.isFile()) return "file";
    if (stat.isDirectory()) return "directory";
    return "other";
}

// =============================================================================
// Copy helpers
// =============================================================================

async function copyPathRecursive(params: {
    sourceAbsolutePath: string;
    targetAbsolutePath: string;
    overwrite: boolean;
    stats: CopyPathStats;
    rootDir: string;
}): Promise<void> {
    const {sourceAbsolutePath, targetAbsolutePath, overwrite, stats} = params;

    if (stats.entries >= MAX_COPY_ENTRIES) {
        throw new Error(
            `Too many entries to copy. Max allowed: ${MAX_COPY_ENTRIES}.`,
        );
    }

    stats.entries++;

    const sourceStat = await fs.promises.lstat(sourceAbsolutePath);

    if (sourceStat.isSymbolicLink()) {
        throw new Error("Symlinks are not allowed in copied paths.");
    }

    if (sourceStat.isFile()) {
        stats.totalBytes += sourceStat.size;

        if (stats.totalBytes > MAX_COPY_TOTAL_BYTES) {
            throw new Error(
                `Copied data is too large. Max allowed: ${MAX_COPY_TOTAL_BYTES} bytes.`,
            );
        }

        if (await pathExists(targetAbsolutePath)) {
            const targetStat = await fs.promises.lstat(targetAbsolutePath);

            if (targetStat.isSymbolicLink()) {
                throw new Error("Symlink targets are not allowed.");
            }

            if (targetStat.isDirectory()) {
                throw new Error("Cannot overwrite a directory with a file.");
            }

            if (!overwrite) {
                throw new Error(
                    `Target file already exists: ${path.relative(params.rootDir, targetAbsolutePath)}`,
                );
            }
        }

        await fs.promises.copyFile(
            sourceAbsolutePath,
            targetAbsolutePath,
            overwrite ? 0 : fs.constants.COPYFILE_EXCL,
        );

        return;
    }

    if (sourceStat.isDirectory()) {
        if (await pathExists(targetAbsolutePath)) {
            const targetStat = await fs.promises.lstat(targetAbsolutePath);

            if (targetStat.isSymbolicLink()) {
                throw new Error("Symlink targets are not allowed.");
            }

            if (!targetStat.isDirectory()) {
                throw new Error("Cannot overwrite a file with a directory.");
            }
        } else {
            await fs.promises.mkdir(targetAbsolutePath);
        }

        const entries = await fs.promises.readdir(sourceAbsolutePath);

        for (const entry of entries) {
            const childSourcePath = path.join(sourceAbsolutePath, entry);
            const childTargetPath = path.join(targetAbsolutePath, entry);

            await copyPathRecursive({
                sourceAbsolutePath: childSourcePath,
                targetAbsolutePath: childTargetPath,
                overwrite,
                stats,
                rootDir: params.rootDir,
            });
        }

        return;
    }

    throw new Error("Only files and directories can be copied.");
}

// =============================================================================
// Patch helpers
// =============================================================================

function isPatchOperationType(value: string): value is PatchOperationType {
    return (PATCH_OPERATION_TYPES as readonly string[]).includes(value);
}

function parsePatchOperations(input: AiJsonValue | null | undefined): ParsedPatchOperation[] {
    if (!Array.isArray(input)) {
        throw new Error("operations must be an array.");
    }

    if (input.length === 0) {
        throw new Error("operations must not be empty.");
    }

    if (input.length > MAX_PATCH_OPERATIONS) {
        throw new Error(
            `Too many patch operations. Max allowed: ${MAX_PATCH_OPERATIONS}.`,
        );
    }

    return input.map((rawOperation, index) => {
        if (
            !rawOperation ||
            typeof rawOperation !== "object" ||
            Array.isArray(rawOperation)
        ) {
            throw new Error(`Operation #${index} must be an object.`);
        }

        const operation = rawOperation as AiJsonObject;
        const rawType = asNonEmptyString(operation.type)?.toLowerCase();

        if (!rawType || !isPatchOperationType(rawType)) {
            throw new Error(
                `Operation #${index} has unsupported type: ${String(operation.type)}.`,
            );
        }

        const search = asNonEmptyString(operation.search);

        if (!search) {
            throw new Error(
                `Operation #${index}: search must be a non-empty string.`,
            );
        }

        const searchBytes = Buffer.byteLength(search, "utf8");

        if (searchBytes > MAX_PATCH_SEARCH_BYTES) {
            throw new Error(
                `Operation #${index}: search fragment is too large: ${searchBytes} bytes. Max allowed: ${MAX_PATCH_SEARCH_BYTES} bytes.`,
            );
        }

        let replace = "";

        if (rawType !== "delete") {
            if (typeof operation.replace !== "string") {
                throw new Error(`Operation #${index}: replace must be a string.`);
            }

            replace = operation.replace;

            const replaceBytes = Buffer.byteLength(replace, "utf8");

            if (replaceBytes > MAX_PATCH_REPLACE_BYTES) {
                throw new Error(
                    `Operation #${index}: replace fragment is too large: ${replaceBytes} bytes. Max allowed: ${MAX_PATCH_REPLACE_BYTES} bytes.`,
                );
            }
        }

        return {
            type: rawType,
            search,
            replace,
        };
    });
}

function findExactOccurrences(content: string, search: string): number[] {
    const positions: number[] = [];
    let fromIndex = 0;

    while (true) {
        const index = content.indexOf(search, fromIndex);

        if (index === -1) {
            break;
        }

        positions.push(index);
        fromIndex = index + search.length;
    }

    return positions;
}

function getLineColumn(
    content: string,
    index: number,
): {
    line: number;
    column: number;
} {
    const before = content.slice(0, index);
    const lines = before.split("\n");

    return {
        line: lines.length,
        column: lines[lines.length - 1].length + 1,
    };
}

function buildPatchReplacement(operation: ParsedPatchOperation): string {
    if (operation.type === "replace") {
        return operation.replace;
    }

    if (operation.type === "insert_before") {
        return operation.replace + operation.search;
    }

    if (operation.type === "insert_after") {
        return operation.search + operation.replace;
    }

    return "";
}

function replaceAt(
    content: string,
    startIndex: number,
    searchLength: number,
    replacement: string,
): string {
    return (
        content.slice(0, startIndex) +
        replacement +
        content.slice(startIndex + searchLength)
    );
}

function buildPatchPreview(before: string, after: string): string {
    if (before === after) {
        return "No content changes.";
    }

    let prefixLength = 0;

    while (
        prefixLength < before.length &&
        prefixLength < after.length &&
        before[prefixLength] === after[prefixLength]
        ) {
        prefixLength++;
    }

    let suffixLength = 0;

    while (
        suffixLength < before.length - prefixLength &&
        suffixLength < after.length - prefixLength &&
        before[before.length - 1 - suffixLength] ===
        after[after.length - 1 - suffixLength]
        ) {
        suffixLength++;
    }

    const contextChars = Math.floor(MAX_PATCH_PREVIEW_CHARS / 4);
    const beforeChangedStart = Math.max(0, prefixLength - contextChars);
    const beforeChangedEnd = Math.min(
        before.length,
        before.length - suffixLength + contextChars,
    );
    const afterChangedStart = Math.max(0, prefixLength - contextChars);
    const afterChangedEnd = Math.min(
        after.length,
        after.length - suffixLength + contextChars,
    );

    const beforeSnippet = before.slice(beforeChangedStart, beforeChangedEnd);
    const afterSnippet = after.slice(afterChangedStart, afterChangedEnd);

    const preview = [
        "--- BEFORE ---",
        beforeChangedStart > 0 ? "... truncated ..." : "",
        beforeSnippet,
        beforeChangedEnd < before.length ? "... truncated ..." : "",
        "--- AFTER ---",
        afterChangedStart > 0 ? "... truncated ..." : "",
        afterSnippet,
        afterChangedEnd < after.length ? "... truncated ..." : "",
    ]
        .filter(Boolean)
        .join("\n");

    if (preview.length <= MAX_PATCH_PREVIEW_CHARS) {
        return preview;
    }

    return `${preview.slice(0, MAX_PATCH_PREVIEW_CHARS)}\n... preview truncated ...`;
}

// =============================================================================
// Search helpers
// =============================================================================

function normalizeForSearch(value: string, caseSensitive: boolean): string {
    return caseSensitive ? value : value.toLowerCase();
}

function parseSearchExtensions(input: AiJsonValue | null | undefined): string[] | null {
    if (input === undefined || input === null) {
        return null;
    }

    if (!Array.isArray(input)) {
        throw new Error("extensions must be an array of strings.");
    }

    const extensions = input
        .map((value) => asNonEmptyString(value))
        .filter((value): value is string => Boolean(value))
        .map((value) => {
            const trimmed = value.trim();
            return trimmed.startsWith(".")
                ? trimmed.toLowerCase()
                : `.${trimmed.toLowerCase()}`;
        });

    return extensions.length > 0 ? [...new Set(extensions)] : null;
}

function matchesExtension(
    relativePath: string,
    extensions: string[] | null,
): boolean {
    if (!extensions) {
        return true;
    }

    return extensions.includes(path.extname(relativePath).toLowerCase());
}

function findContentMatch(params: {
    content: string;
    query: string;
    caseSensitive: boolean;
}): {
    line: number;
    column: number;
    snippet: string;
} | null {
    const normalizedContent = normalizeForSearch(
        params.content,
        params.caseSensitive,
    );
    const normalizedQuery = normalizeForSearch(
        params.query,
        params.caseSensitive,
    );

    const index = normalizedContent.indexOf(normalizedQuery);

    if (index === -1) {
        return null;
    }

    const before = params.content.slice(0, index);
    const lines = before.split("\n");

    const line = lines.length;
    const column = lines[lines.length - 1].length + 1;

    const snippetStart = Math.max(
        0,
        index - Math.floor(MAX_FILE_SEARCH_SNIPPET_CHARS / 2),
    );
    const snippetEnd = Math.min(
        params.content.length,
        index + params.query.length + Math.floor(MAX_FILE_SEARCH_SNIPPET_CHARS / 2),
    );

    const snippet = [
        snippetStart > 0 ? "... " : "",
        params.content.slice(snippetStart, snippetEnd),
        snippetEnd < params.content.length ? " ..." : "",
    ].join("");

    return {
        line,
        column,
        snippet,
    };
}

async function tryFindTextInFile(params: {
    absolutePath: string;
    query: string;
    caseSensitive: boolean;
}): Promise<{
    line: number;
    column: number;
    snippet: string;
} | null> {
    const stat = await fs.promises.lstat(params.absolutePath);

    if (!stat.isFile()) {
        return null;
    }

    if (stat.size > MAX_FILE_SEARCH_CONTENT_BYTES) {
        return null;
    }

    const buffer = await fs.promises.readFile(params.absolutePath);

    if (buffer.includes(0)) {
        return null;
    }

    const content = buffer.toString("utf8");

    return findContentMatch({
        content,
        query: params.query,
        caseSensitive: params.caseSensitive,
    });
}

// =============================================================================
// Attachment helpers
// =============================================================================

function isSafeAttachmentFileName(fileName: string): boolean {
    if (!fileName.trim()) {
        return false;
    }

    if (fileName !== path.basename(fileName)) {
        return false;
    }

    if (/[\0-\x1f<>:"/\\|?*]/.test(fileName)) {
        return false;
    }

    if (fileName === "." || fileName === "..") {
        return false;
    }

    return true;
}

function guessMimeType(fileName: string): string {
    const extension = path.extname(fileName).toLowerCase();

    const mimeTypes: Record<string, string> = {
        ".txt": "text/plain",
        ".md": "text/markdown",
        ".markdown": "text/markdown",
        ".json": "application/json",
        ".jsonl": "application/x-ndjson",
        ".csv": "text/csv",
        ".html": "text/html",
        ".htm": "text/html",
        ".xml": "application/xml",
        ".yaml": "application/yaml",
        ".yml": "application/yaml",

        ".pdf": "application/pdf",
        ".zip": "application/zip",
        ".tar": "application/x-tar",
        ".gz": "application/gzip",
        ".7z": "application/x-7z-compressed",

        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",

        ".mp3": "audio/mpeg",
        ".flac": "audio/flac",
        ".wav": "audio/wav",
        ".ogg": "audio/ogg",
        ".m4a": "audio/mp4",

        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mkv": "video/x-matroska",
    };

    return mimeTypes[extension] ?? "application/octet-stream";
}

// =============================================================================
// Chunked write helpers
// =============================================================================

function parsePositiveInteger(value: AiJsonValue | null | undefined, fieldName: string): number {
    const numberValue =
        typeof value === "number"
            ? value
            : typeof value === "string"
                ? Number(value)
                : NaN;

    if (!Number.isSafeInteger(numberValue) || numberValue < 1) {
        throw new Error(`${fieldName} must be a positive integer.`);
    }

    return numberValue;
}

function getFileWriteSession(sessionIdInput: AiJsonValue | null | undefined): FileWriteSession {
    const sessionId = asNonEmptyString(sessionIdInput);

    if (!sessionId) {
        throw new Error("sessionId is required.");
    }

    const session = fileWriteSessions.get(sessionId);

    if (!session) {
        throw new Error(`File write session not found or expired: ${sessionId}`);
    }

    return session;
}

async function cleanupExpiredFileWriteSessions(): Promise<void> {
    const now = Date.now();

    for (const [sessionId, session] of fileWriteSessions.entries()) {
        if (now - session.updatedAtMs <= MAX_STREAM_WRITE_IDLE_MS) {
            continue;
        }

        fileWriteSessions.delete(sessionId);

        await fs.promises.rm(session.tempAbsolutePath, {
            force: true,
        });
    }
}
