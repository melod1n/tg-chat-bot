import {Environment} from "../../common/environment";
import {AiTool} from "../tool-types";
import {WEB_SEARCH_TOOL_NAME, webSearch, webSearchTool, webSearchToolPrompt} from "./web-search";
import {getCurrentDateTime, getCurrentDateTimeTool} from "./datetime";
import {shellExecute, shellExecuteTool} from "./shell";
import {ToolHandler} from "./types";
import {getWeather, getWeatherTool} from "./weather";
import {
    GET_FINANCIAL_MARKET_DATA_TOOL_NAME,
    getFinancialMarketData,
    getFinancialMarketDataToolPrompt,
    getMarketRates
} from "./market-rates";
import {pythonInterpreterTool, runPythonInterpreter} from "./python-interpretator";
import {
    beginFileWrite,
    beginFileWriteTool,
    cancelFileWrite,
    cancelFileWriteTool,
    copyPath,
    copyPathTool,
    createDirectory,
    createDirectoryTool,
    createFile,
    createFileTool,
    deletePath,
    deletePathTool,
    editFilePatch,
    editFilePatchTool,
    fileToolsToolPrompt,
    finishFileWrite,
    finishFileWriteTool,
    listDirectory,
    listDirectoryTool,
    readFile,
    readFileTool,
    renamePath,
    renamePathTool,
    searchFiles,
    searchFilesTool,
    sendFileAsAttachment,
    sendFileAsAttachmentTool,
    updateFile,
    updateFileTool,
    writeFileChunk,
    writeFileChunkTool
} from "./files";
import {getMcpToolHandlers, getMcpToolPrompts, getMcpTools} from "../mcp/mcp-registry.js";

export const defaultTools: AiTool[] = [
    getCurrentDateTimeTool,
    getFinancialMarketData,
];

export const fileTools = [
    readFileTool,
    listDirectoryTool,
    searchFilesTool,

    createFileTool,
    beginFileWriteTool,
    writeFileChunkTool,
    finishFileWriteTool,
    cancelFileWriteTool,

    sendFileAsAttachmentTool,

    createDirectoryTool,
    copyPathTool,
    updateFileTool,
    editFilePatchTool,
    renamePathTool,
    deletePathTool,
] satisfies AiTool[];

function parseToolNameSet(raw: string | undefined): Set<string> | undefined {
    if (!raw?.trim()) return undefined;

    const names = raw
        .split(",")
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);

    return names.length ? new Set(names) : undefined;
}

function isLocalToolEnabled(toolName: string): boolean {
    if (Environment.DISABLE_LOCAL_TOOLS) return false;

    const allowlist = parseToolNameSet(Environment.LOCAL_TOOL_ALLOWLIST);
    if (allowlist && !allowlist.has(toolName.toLowerCase())) return false;

    const denylist = parseToolNameSet(Environment.LOCAL_TOOL_DENYLIST);
    if (denylist && denylist.has(toolName.toLowerCase())) return false;

    return true;
}

function filterEnabledTools(tools: AiTool[]): AiTool[] {
    return tools.filter(tool => isLocalToolEnabled(tool.function.name));
}

export const getTools = (forCreator?: boolean) => {
    const tools: AiTool[] = [];

    if (Environment.DISABLE_LOCAL_TOOLS) {
        tools.push(...getMcpTools());
        return tools;
    }

    tools.push(...filterEnabledTools(defaultTools));

    if (Environment.BRAVE_SEARCH_API_KEY) {
        tools.push(...filterEnabledTools([webSearchTool]));
    }

    if (Environment.OPEN_WEATHER_MAP_API_KEY) {
        tools.push(...filterEnabledTools([getWeatherTool]));
    }

    if (Environment.FILE_TOOLS_ROOT_DIR && Environment.ENABLE_FS_TOOLS) {
        tools.push(...filterEnabledTools(fileTools));
    }

    if (forCreator) {
        if (Environment.ENABLE_PYTHON_INTERPRETER) {
            tools.push(...filterEnabledTools([pythonInterpreterTool]));
        }

        if (Environment.ENABLE_UNSAFE_EVAL) {
            tools.push(...filterEnabledTools([shellExecuteTool]));
        }
    }

    tools.push(...getMcpTools());

    return tools;
};

export const fileToolHandlers = {
    read_file: readFile,
    list_directory: listDirectory,
    search_files: searchFiles,

    create_file: createFile,
    begin_file_write: beginFileWrite,
    write_file_chunk: writeFileChunk,
    finish_file_write: finishFileWrite,
    cancel_file_write: cancelFileWrite,

    send_file_as_attachment: sendFileAsAttachment,

    create_directory: createDirectory,
    copy_path: copyPath,
    update_file: updateFile,
    edit_file_patch: editFilePatch,
    rename_path: renamePath,
    delete_path: deletePath,
};

export const getToolHandlers = () => {
    const handlers: Record<string, ToolHandler> = {
        ...getMcpToolHandlers(),
    };

    if (Environment.DISABLE_LOCAL_TOOLS) {
        return handlers;
    }

    if (isLocalToolEnabled("get_datetime")) handlers.get_datetime = getCurrentDateTime;
    if (isLocalToolEnabled("get_financial_market_data")) handlers.get_financial_market_data = getMarketRates;

    if (isLocalToolEnabled("read_file")) handlers.read_file = readFile;
    if (isLocalToolEnabled("list_directory")) handlers.list_directory = listDirectory;
    if (isLocalToolEnabled("search_files")) handlers.search_files = searchFiles;
    if (isLocalToolEnabled("create_file")) handlers.create_file = createFile;
    if (isLocalToolEnabled("begin_file_write")) handlers.begin_file_write = beginFileWrite;
    if (isLocalToolEnabled("write_file_chunk")) handlers.write_file_chunk = writeFileChunk;
    if (isLocalToolEnabled("finish_file_write")) handlers.finish_file_write = finishFileWrite;
    if (isLocalToolEnabled("cancel_file_write")) handlers.cancel_file_write = cancelFileWrite;
    if (isLocalToolEnabled("send_file_as_attachment")) handlers.send_file_as_attachment = sendFileAsAttachment;
    if (isLocalToolEnabled("create_directory")) handlers.create_directory = createDirectory;
    if (isLocalToolEnabled("copy_path")) handlers.copy_path = copyPath;
    if (isLocalToolEnabled("update_file")) handlers.update_file = updateFile;
    if (isLocalToolEnabled("edit_file_patch")) handlers.edit_file_patch = editFilePatch;
    if (isLocalToolEnabled("rename_path")) handlers.rename_path = renamePath;
    if (isLocalToolEnabled("delete_path")) handlers.delete_path = deletePath;

    if (isLocalToolEnabled("python_interpreter")) handlers.python_interpreter = runPythonInterpreter;
    if (isLocalToolEnabled("shell_execute")) handlers.shell_execute = shellExecute;
    if (isLocalToolEnabled("web_search")) handlers.web_search = webSearch;
    if (isLocalToolEnabled("get_weather")) handlers.get_weather = getWeather;

    return handlers;
};

export function getToolPrompts(toolNames: string[]): string[] {
    if (Environment.DISABLE_LOCAL_TOOLS) {
        return getMcpToolPrompts(toolNames);
    }

    const prompts: string[] = [];

    for (const toolName of toolNames) {
        if (!isLocalToolEnabled(toolName)) {
            continue;
        }

        if (!prompts.includes(fileToolsToolPrompt) &&
            fileTools.map(t => t.function.name).includes(toolName)) {
            prompts.push(fileToolsToolPrompt);
            continue;
        }

        switch (toolName) {
            case GET_FINANCIAL_MARKET_DATA_TOOL_NAME:
                prompts.push(getFinancialMarketDataToolPrompt);
                break;
            case WEB_SEARCH_TOOL_NAME:
                prompts.push(webSearchToolPrompt);
                break;
            default:
                break;
        }
    }

    prompts.push(...getMcpToolPrompts(toolNames));
    return prompts;
}
