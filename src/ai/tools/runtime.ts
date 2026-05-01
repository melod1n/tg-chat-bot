import {getToolHandlers} from "./registry";
import {normalizeToolArguments} from "./utils";
import {PYTHON_INTERPRETER_TOOL_NAME, PythonInterpreterInputFile, runPythonInterpreter} from "./python-interpretator";
import {toolsLogger} from "./tool-logger";
import {AiJsonObject, AiJsonValue} from "../tool-types";

const logger = toolsLogger.child("runtime");

export type ToolRuntimeContext = {
    pythonInputFiles?: PythonInterpreterInputFile[];
};

function stringifyToolResult(result: AiJsonValue): string {
    if (typeof result === "string") return result;
    return JSON.stringify(result, null, 2);
}

export async function executeToolCall(
    userId: number | undefined | null,
    name: string,
    args?: string | AiJsonObject,
    context: ToolRuntimeContext = {},
): Promise<string> {
    const startedAt = Date.now();
    const handler = getToolHandlers()[name];
    logger.info("execute.start", {name, args});

    if (!handler) {
        return stringifyToolResult({
            error: `Unknown tool: ${name}`,
        });
    }

    try {
        if (name === PYTHON_INTERPRETER_TOOL_NAME) {
            const result = await runPythonInterpreter(normalizeToolArguments(args, userId), {
                executionTimeoutMs: 8_000,
                syntaxTimeoutMs: 3_000,
                maxCodeChars: 100_000,
                maxOutputChars: 20_000,
                inputFiles: context.pythonInputFiles,
            });

            const s = stringifyToolResult(result);
            logger.debug("execute.done", {name, chars: s.length, duration: logger.duration(startedAt)});

            return s;
        }

        const arguments1 = normalizeToolArguments(args, userId);
        const result = await handler(arguments1);
        const s = stringifyToolResult(result);
        logger.debug("execute.done", {name, chars: s.length, duration: logger.duration(startedAt)});
        return s;
    } catch (error) {
        logger.error("execute.failed", {name, duration: logger.duration(startedAt), error: error instanceof Error ? error : String(error)});
        return stringifyToolResult({
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
