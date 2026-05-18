import {spawn} from "node:child_process";
import {copyFile, lstat, mkdir, readdir, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {AiTool} from "../tool-types.js";
import {Environment} from "../../common/environment.js";
import {toolsLogger} from "./tool-logger.js";
import {randomUUID} from "node:crypto";
import {AiJsonObject} from "../tool-types.js";

const logger = toolsLogger.child("python-interpreter");

export const PYTHON_INTERPRETER_TOOL_NAME = "python_interpreter";

export type PythonInterpreterArgs = {
    /**
     * Full Python 3 script.
     * The model should use print(...) to expose useful output.
     */
    code: string;

    /**
     * Optional stdin passed to the Python process.
     */
    stdin?: string;

    /**
     * Optional timeout override.
     */
    timeoutMs?: number;
};

export type PythonInterpreterOptions = {
    pythonBinary?: string;
    syntaxTimeoutMs?: number;
    executionTimeoutMs?: number;
    maxCodeChars?: number;
    maxOutputChars?: number;
    maxArtifactBytes?: number;
    maxArtifactCount?: number;
    inputFiles?: PythonInterpreterInputFile[];
};

type ProcessRunResult = {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    outputTruncated: boolean;
    durationMs: number;
};

export type PythonInterpreterInputFile = {
    kind?: string;
    path: string;
    fileName: string;
    mimeType?: string;
};

export type PythonInterpreterRuntimeInputFile = PythonInterpreterInputFile & {
    index: number;
    path: string;
    sourcePath: string;
    relativePath: string;
    sizeBytes: number;
};

export type PythonInterpreterArtifact = {
    kind: "image" | "file";
    path: string;
    relativePath: string;
    fileName: string;
    mimeType?: string;
    sizeBytes: number;
};

export type PythonInterpreterSkippedArtifact = {
    path: string;
    relativePath: string;
    fileName: string;
    sizeBytes?: number;
    reason: string;
    maxSizeBytes?: number;
};

export type PythonToolResult =
    | {
    ok: true;
    phase: "execution";
    stdout: string;
    stderr: string;
    exitCode: number | null;
    durationMs: number;
    outputTruncated: boolean;
    inputDir?: string;
    outputDir?: string;
    inputFiles?: PythonInterpreterRuntimeInputFile[];
    artifacts?: PythonInterpreterArtifact[];
    skippedArtifacts?: PythonInterpreterSkippedArtifact[];
}
    | {
    ok: false;
    phase: "syntax" | "execution" | "internal";
    error: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
    signal?: NodeJS.Signals | null;
    timedOut?: boolean;
    durationMs?: number;
    outputTruncated?: boolean;
};

const DEFAULT_PYTHON_BINARY = process.platform === "win32" ? "python" : "python3";
const DEFAULT_SYNTAX_TIMEOUT_MS = 3_000;
const DEFAULT_EXECUTION_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_CODE_CHARS = 100_000;
const DEFAULT_MAX_OUTPUT_CHARS = 20_000;
export const PYTHON_INTERPRETER_MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_ARTIFACT_COUNT = 20;
const PYTHON_INPUTS_DIR_NAME = "inputs";
const PYTHON_OUTPUTS_DIR_NAME = "outputs";
const PYTHON_ATTACHMENTS_FILE_NAME = "attachments.json";
const PYTHON_USER_CODE_FILE_NAME = "user_code.py";
const PYTHON_RUNNER_FILE_NAME = "main.py";

const PYTHON_CODE_TEMPLATE = [
    "from pathlib import Path",
    "import json",
    "",
    "# These globals are predefined by the python_interpreter runtime:",
    "# INPUT_DIR = Path('inputs')",
    "# OUTPUT_DIR = Path('outputs')",
    "# ATTACHMENTS_FILE = Path('attachments.json')",
    "",
    "attachments = load_attachments()",
    "# Read attached files from INPUT_DIR, for example:",
    "# text = (INPUT_DIR/attachments[0]['fileName']).read_text(encoding='utf-8')",
    "",
    "# Save every user-visible generated file into outputs.",
    "# Example:",
    "# (OUTPUT_DIR/'result.txt').write_text('done', encoding='utf-8')",
    "",
    "print('done')",
].join("\n");

export const pythonInterpreterToolPrompt = [
    "Python interpreter rules:",
    "- You have access to the `python_interpreter` tool for Python 3 code.",
    "- Each Python run starts in a temporary workspace.",
    "- Incoming user files are always in `inputs/`.",
    "- Outgoing user-visible files must always be saved into `outputs/`.",
    "- Attachment metadata is always in `attachments.json`.",
    "- The runtime predefines these globals in executed code: `INPUT_DIR`, `OUTPUT_DIR`, `ATTACHMENTS_FILE`, `WORK_DIR`, `input_path(name)`, `output_path(name)`, and `load_attachments()`.",
    "- Use `input_path(filename)` for reading incoming files.",
    "- Use `output_path(filename)` for files that should be returned to the user.",
    "- Do not invent other directories for user attachments or generated artifacts.",
    "- Prefer this template:",
    "```python",
    PYTHON_CODE_TEMPLATE,
    "```",
    "",
].join("\n");

export const pythonInterpreterTool = {
    type: "function",
    function: {
        name: PYTHON_INTERPRETER_TOOL_NAME,
        description:
            "Validate and execute short Python 3 code. Use for calculations, data transformations, parsing, chart rendering, and image/file processing. The code must print useful text results. The runtime always creates hardcoded directories `inputs/` and `outputs/` in the current working directory. User attachments are copied into `inputs/` and described in `attachments.json`. The executed code has predefined globals: INPUT_DIR, OUTPUT_DIR, ATTACHMENTS_FILE, WORK_DIR, input_path(name), output_path(name), and load_attachments(). Put every user-visible output image or file into `outputs/`; every regular file there up to 50 MB will be returned by the tool and sent to the user.",
        parameters: {
            type: "object",
            required: ["code"],
            properties: {
                code: {
                    type: "string",
                    description:
                        `Complete Python 3 script to execute. Use print(...) for the final answer. Do not use markdown fences. Read incoming files only from INPUT_DIR / "file" or input_path("file"). Save charts/images/files intended for the user only into OUTPUT_DIR / "file" or output_path("file"). You can inspect attachments via load_attachments(). Template:\n${PYTHON_CODE_TEMPLATE}`,
                },
                stdin: {
                    type: "string",
                    description: "Optional stdin passed to the Python script.",
                },
                timeoutMs: {
                    type: "integer",
                    description: "Optional execution timeout in milliseconds. Default is 8000.",
                },
            },
        },
    },
} satisfies AiTool;

export async function runPythonInterpreter(
    rawArgs: string | AiJsonObject | undefined,
    options: PythonInterpreterOptions = {},
): Promise<PythonToolResult> {
    let args: PythonInterpreterArgs;

    try {
        args = parsePythonInterpreterArgs(rawArgs, options);
    } catch (error) {
        return {
            ok: false,
            phase: "internal",
            error: errorToString(error instanceof Error ? error : String(error)),
        };
    }

    const syntaxStartedAt = Date.now();
    const syntax = await validatePythonSyntax(args.code, options);
    logger.debug("syntax.done", {duration: logger.duration(syntaxStartedAt), ok: syntax.ok});

    if (!syntax.ok) {
        return syntax;
    }

    const executionStartedAt = Date.now();
    const result = await executePythonCode(args, options);
    logger.debug("execution.done", {duration: logger.duration(executionStartedAt), ok: result.ok, phase: result.phase});

    return result;
}

export async function validatePythonSyntax(
    code: string,
    options: PythonInterpreterOptions = {},
): Promise<PythonToolResult> {
    const pythonBinary = options.pythonBinary ?? DEFAULT_PYTHON_BINARY;
    const timeoutMs = options.syntaxTimeoutMs ?? DEFAULT_SYNTAX_TIMEOUT_MS;
    const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

    const syntaxCheckScript = `
import ast
import sys
source = sys.stdin.read()

try:
    ast.parse(source, filename="<llm_python>")
except SyntaxError as e:
    print(f"SyntaxError: {e.msg} at line {e.lineno}, column {e.offset}", file=sys.stderr)
    if e.text:
        print(e.text.rstrip(), file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"{type(e).__name__}: {e}", file=sys.stderr)
    sys.exit(1)
`.trim();

    const result = await runProcess({
        command: pythonBinary,
        args: ["-I", "-B", "-S", "-c", syntaxCheckScript],
        input: code,
        timeoutMs,
        maxOutputChars,
        env: buildSafeEnv(),
    });

    if (result.timedOut) {
        return {
            ok: false,
            phase: "syntax",
            error: `Python syntax check timed out after ${timeoutMs} ms.`,
            stderr: result.stderr,
            durationMs: result.durationMs,
            timedOut: true,
            outputTruncated: result.outputTruncated,
        };
    }

    if (result.exitCode !== 0) {
        return {
            ok: false,
            phase: "syntax",
            error: result.stderr.trim() || "Python syntax check failed.",
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            signal: result.signal,
            durationMs: result.durationMs,
            outputTruncated: result.outputTruncated,
        };
    }

    return {
        ok: true,
        phase: "execution",
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: result.durationMs,
        outputTruncated: result.outputTruncated,
    };
}

async function executePythonCode(
    args: PythonInterpreterArgs,
    options: PythonInterpreterOptions = {},
): Promise<PythonToolResult> {
    const startedAt = Date.now();
    logger.info("execute.start", {args, options});

    const pythonBinary =
        options.pythonBinary ?? process.env.PYTHON_INTERPRETER_BINARY ?? "python";

    const timeoutMs = args.timeoutMs ?? options.executionTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS;
    const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

    const tempDir = path.join(Environment.DATA_PATH, "cache", "python", "python-temp-" + randomUUID());
    const inputDir = path.join(tempDir, PYTHON_INPUTS_DIR_NAME);
    const outputDir = path.join(tempDir, PYTHON_OUTPUTS_DIR_NAME);
    const attachmentsPath = path.join(tempDir, PYTHON_ATTACHMENTS_FILE_NAME);
    await mkdir(tempDir, {recursive: true});
    await mkdir(inputDir, {recursive: true});
    await mkdir(outputDir, {recursive: true});
    const userScriptPath = path.join(tempDir, PYTHON_USER_CODE_FILE_NAME);
    const runnerPath = path.join(tempDir, PYTHON_RUNNER_FILE_NAME);

    try {
        const inputFiles = await prepareInputFiles(options.inputFiles ?? [], inputDir);
        await writeFile(attachmentsPath, JSON.stringify(inputFiles, null, 2), {
            encoding: "utf8",
            mode: 0o600,
        });

        await writeFile(userScriptPath, args.code, {
            encoding: "utf8",
            mode: 0o600,
        });

        await writeFile(runnerPath, buildPythonRunnerScript(), {
            encoding: "utf8",
            mode: 0o600,
        });

        logger.debug("script.written", {tempDir, userScriptPath, runnerPath, duration: logger.duration(startedAt)});

        const result = await runProcess({
            command: pythonBinary,
            args: ["-I", "-B", runnerPath],
            input: args.stdin ?? "",
            cwd: tempDir,
            timeoutMs,
            maxOutputChars,
            env: {
                ...buildSafeEnv(tempDir),
                PYTHON_INPUT_DIR: inputDir,
                PYTHON_OUTPUT_DIR: outputDir,
                PYTHON_ATTACHMENTS_FILE: attachmentsPath,
            },
        });

        logger.debug("process.done", {
            duration: logger.duration(startedAt),
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            outputTruncated: result.outputTruncated
        });

        if (result.timedOut) {
            logger.warn("process.timeout", {duration: logger.duration(startedAt)});
            return {
                ok: false,
                phase: "execution",
                error: `Python execution timed out after ${timeoutMs} ms.`,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
                signal: result.signal,
                timedOut: true,
                durationMs: result.durationMs,
                outputTruncated: result.outputTruncated,
            };
        }

        if (result.outputTruncated) {
            logger.warn("process.output_truncated", {
                duration: logger.duration(startedAt),
                stdoutChars: result.stdout.length,
                stderrChars: result.stderr.length
            });

            return {
                ok: false,
                phase: "execution",
                error: `Python output exceeded limit of ${maxOutputChars} characters.`,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
                signal: result.signal,
                timedOut: false,
                durationMs: result.durationMs,
                outputTruncated: true,
            };
        }

        if (result.exitCode !== 0) {
            logger.warn("process.non_zero_exit", {duration: logger.duration(startedAt), result});

            return {
                ok: false,
                phase: "execution",
                error: result.stderr.trim() || `Python exited with code ${result.exitCode}.`,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
                signal: result.signal,
                timedOut: false,
                durationMs: result.durationMs,
                outputTruncated: result.outputTruncated,
            };
        }

        logger.debug("process.ok", {duration: logger.duration(startedAt)});

        const {
            artifacts,
            skippedArtifacts
        } = await collectOutputArtifacts(outputDir, options);

        return {
            ok: true,
            phase: "execution",
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            outputTruncated: result.outputTruncated,
            inputDir,
            outputDir,
            inputFiles,
            artifacts,
            skippedArtifacts,
        };
    } catch (error) {
        logger.error("execute.failed", {duration: logger.duration(startedAt), error: error instanceof Error ? error : String(error)});
        return {
            ok: false,
            phase: "internal",
            error: errorToString(error instanceof Error ? error : String(error)),
        };
    } finally {
        await rm(tempDir, {
            recursive: true,
            force: true,
        });
    }
}

function buildPythonRunnerScript(): string {
    return `
import json
import runpy
from pathlib import Path

WORK_DIR = Path(__file__).resolve().parent
INPUT_DIR = WORK_DIR / ${JSON.stringify(PYTHON_INPUTS_DIR_NAME)}
OUTPUT_DIR = WORK_DIR / ${JSON.stringify(PYTHON_OUTPUTS_DIR_NAME)}
ATTACHMENTS_FILE = WORK_DIR / ${JSON.stringify(PYTHON_ATTACHMENTS_FILE_NAME)}
USER_CODE_FILE = WORK_DIR / ${JSON.stringify(PYTHON_USER_CODE_FILE_NAME)}

INPUT_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def input_path(name=""):
    return INPUT_DIR / name

def output_path(name=""):
    return OUTPUT_DIR / name

def load_attachments():
    if not ATTACHMENTS_FILE.exists():
        return []
    return json.loads(ATTACHMENTS_FILE.read_text(encoding="utf-8"))

runpy.run_path(
    str(USER_CODE_FILE),
    run_name="__main__",
    init_globals={
        "Path": Path,
        "WORK_DIR": WORK_DIR,
        "INPUT_DIR": INPUT_DIR,
        "OUTPUT_DIR": OUTPUT_DIR,
        "ATTACHMENTS_FILE": ATTACHMENTS_FILE,
        "input_path": input_path,
        "output_path": output_path,
        "load_attachments": load_attachments,
    },
)
`.trimStart();
}

async function prepareInputFiles(
    inputFiles: PythonInterpreterInputFile[],
    inputDir: string,
): Promise<PythonInterpreterRuntimeInputFile[]> {
    const prepared: PythonInterpreterRuntimeInputFile[] = [];

    for (const [index, file] of inputFiles.entries()) {
        const sourcePath = path.resolve(file.path);
        const info = await lstat(sourcePath).catch(() => null);
        if (!info?.isFile()) continue;

        const fileName = uniqueInputFileName(index, file.fileName || path.basename(sourcePath));
        const runtimePath = path.join(inputDir, fileName);
        await copyFile(sourcePath, runtimePath);

        prepared.push({
            ...file,
            index,
            path: runtimePath,
            sourcePath,
            relativePath: path.join(PYTHON_INPUTS_DIR_NAME, fileName).replace(/\\/g, "/"),
            sizeBytes: info.size,
            fileName,
        });
    }

    return prepared;
}

async function collectOutputArtifacts(
    outputDir: string,
    options: PythonInterpreterOptions,
): Promise<{
    artifacts: PythonInterpreterArtifact[];
    skippedArtifacts: PythonInterpreterSkippedArtifact[];
}> {
    const maxBytes = options.maxArtifactBytes ?? PYTHON_INTERPRETER_MAX_ARTIFACT_BYTES;
    const maxCount = options.maxArtifactCount ?? DEFAULT_MAX_ARTIFACT_COUNT;
    const artifacts: PythonInterpreterArtifact[] = [];
    const skippedArtifacts: PythonInterpreterSkippedArtifact[] = [];

    const walk = async (dir: string): Promise<void> => {
        const entries = await readdir(dir, {withFileTypes: true}).catch(() => []);

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const info = await lstat(fullPath).catch(() => null);
            if (!info) continue;

            const relativePath = path.relative(outputDir, fullPath).replace(/\\/g, "/");
            if (info.isSymbolicLink()) {
                skippedArtifacts.push({
                    path: fullPath,
                    relativePath,
                    fileName: safeFileName(entry.name),
                    reason: "Symbolic links are not returned.",
                });
                continue;
            }

            if (info.isDirectory()) {
                await walk(fullPath);
                continue;
            }

            if (!info.isFile()) continue;

            const fileName = safeFileName(entry.name);
            if (info.size > maxBytes) {
                skippedArtifacts.push({
                    path: fullPath,
                    relativePath,
                    fileName,
                    sizeBytes: info.size,
                    reason: `File exceeds the ${maxBytes} byte limit.`,
                    maxSizeBytes: maxBytes,
                });
                continue;
            }

            if (artifacts.length >= maxCount) {
                skippedArtifacts.push({
                    path: fullPath,
                    relativePath,
                    fileName,
                    sizeBytes: info.size,
                    reason: `Artifact count exceeds the ${maxCount} file limit.`,
                });
                continue;
            }

            const mimeType = mimeTypeFromPath(fullPath);
            if (mimeType) {
                artifacts.push({
                    kind: mimeType?.startsWith("image/") ? "image" : "file",
                    path: fullPath,
                    relativePath,
                    fileName,
                    mimeType,
                    sizeBytes: info.size,
                });
            } else {
                skippedArtifacts.push({
                    path: fullPath,
                    relativePath,
                    fileName,
                    sizeBytes: info.size,
                    reason: "Unsupported mimeType for extension " + path.extname(fullPath)
                });
            }
        }
    };

    await walk(outputDir);

    return {artifacts, skippedArtifacts};
}

function safeFileName(value: string): string {
    const sanitized = path.basename(value)
        .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_")
        .trim()
        .slice(0, 180);

    return sanitized || "file";
}

function uniqueInputFileName(index: number, value: string): string {
    const safe = safeFileName(value);
    const ext = path.extname(safe);
    const base = path.basename(safe, ext).slice(0, 140) || "input";
    return `${index + 1}_${base}${ext}`;
}

function mimeTypeFromPath(filePath: string): string | undefined {
    switch (path.extname(filePath).toLowerCase()) {
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".png":
            return "image/png";
        case ".webp":
            return "image/webp";
        case ".gif":
            return "image/gif";
        case ".bmp":
            return "image/bmp";
        case ".svg":
            return "image/svg+xml";
        case ".pdf":
            return "application/pdf";
        case ".txt":
            return "text/plain";
        case ".csv":
            return "text/csv";
        case ".json":
            return "application/json";
        case ".zip":
            return "application/zip";
        case ".mp3":
            return "audio/mpeg";
        case ".wav":
            return "audio/wav";
        case ".mp4":
            return "video/mp4";
        default:
            return undefined;
    }
}

function parsePythonInterpreterArgs(
    rawArgs: string | AiJsonObject | undefined,
    options: PythonInterpreterOptions,
): PythonInterpreterArgs {
    let args = rawArgs;

    if (typeof rawArgs === "string") {
        try {
            args = JSON.parse(rawArgs);
        } catch {
            args = {code: rawArgs};
        }
    }

    if (!args || typeof args !== "object" || Array.isArray(args)) {
        throw new Error("Tool arguments must be an object.");
    }

    const record = args as AiJsonObject;
    const code = record.code;

    if (typeof code !== "string" || !code.trim()) {
        throw new Error("Tool argument `code` must be a non-empty string.");
    }

    const maxCodeChars = options.maxCodeChars ?? DEFAULT_MAX_CODE_CHARS;
    if (code.length > maxCodeChars) {
        throw new Error(`Python code is too large: ${code.length} chars, max ${maxCodeChars}.`);
    }

    const stdin = record.stdin;
    if (stdin !== undefined && typeof stdin !== "string") {
        throw new Error("Tool argument `stdin` must be a string when provided.");
    }

    const timeoutMs = record.timeoutMs;
    if (
        timeoutMs !== undefined &&
        (!Number.isInteger(timeoutMs) || Number(timeoutMs) < 100 || Number(timeoutMs) > 60_000)
    ) {
        throw new Error("Tool argument `timeoutMs` must be an integer from 100 to 60000.");
    }

    return {
        code,
        stdin: typeof stdin === "string" ? stdin : undefined,
        timeoutMs: timeoutMs === undefined ? undefined : Number(timeoutMs),
    };
}

async function runProcess(params: {
    command: string;
    args: string[];
    input?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs: number;
    maxOutputChars: number;
}): Promise<ProcessRunResult> {
    const startedAt = Date.now();

    return new Promise<ProcessRunResult>((resolve) => {
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        let outputTruncated = false;
        let settled = false;

        const child = spawn(params.command, params.args, {
            cwd: params.cwd,
            env: params.env,
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
        });

        const finish = (result: Omit<ProcessRunResult, "durationMs">) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({
                ...result,
                durationMs: Date.now() - startedAt,
            });
        };

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, params.timeoutMs);

        const appendOutput = (target: "stdout" | "stderr", chunk: Buffer) => {
            const text = chunk.toString("utf8");

            if (target === "stdout") {
                stdout += text;
            } else {
                stderr += text;
            }

            const total = stdout.length + stderr.length;
            if (total > params.maxOutputChars) {
                outputTruncated = true;

                stdout = stdout.slice(0, params.maxOutputChars);
                stderr = stderr.slice(0, params.maxOutputChars);

                child.kill("SIGKILL");
            }
        };

        child.stdout.on("data", (chunk: Buffer) => appendOutput("stdout", chunk));
        child.stderr.on("data", (chunk: Buffer) => appendOutput("stderr", chunk));

        child.on("error", (error) => {
            finish({
                exitCode: null,
                signal: null,
                stdout,
                stderr: stderr + `\n${errorToString(error)}`,
                timedOut,
                outputTruncated,
            });
        });

        child.on("close", (exitCode, signal) => {
            finish({
                exitCode,
                signal,
                stdout,
                stderr,
                timedOut,
                outputTruncated,
            });
        });

        child.stdin.end(params.input ?? "");
    });
}

function buildSafeEnv(tempDir?: string): NodeJS.ProcessEnv {
    return {
        PATH: process.env.PATH ?? "",
        PATHEXT: process.env.PATHEXT ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
        HOME: tempDir ?? os.tmpdir(),
        USERPROFILE: tempDir ?? os.tmpdir(),
        TEMP: tempDir ?? os.tmpdir(),
        TMP: tempDir ?? os.tmpdir(),
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
    };
}

function errorToString(error: Error | string | object | null | undefined): string {
    if (error instanceof Error) {
        return error.stack || error.message;
    }

    return String(error);
}
