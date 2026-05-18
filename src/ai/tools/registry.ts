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

export const getTools = (forCreator?: boolean) => {
    const tools: AiTool[] = Environment.DISABLE_LOCAL_TOOLS ? [] : [
        ...defaultTools,
    ];

    if (Environment.DISABLE_LOCAL_TOOLS) {
        tools.push(...getMcpTools());
        return tools;
    }

    if (Environment.BRAVE_SEARCH_API_KEY) {
        tools.push(webSearchTool);
    }

    if (Environment.OPEN_WEATHER_MAP_API_KEY) {
        tools.push(getWeatherTool);
    }

    if (Environment.FILE_TOOLS_ROOT_DIR && Environment.ENABLE_FS_TOOLS) {
        tools.push(...fileTools);
    }

    if (forCreator) {
        if (Environment.ENABLE_PYTHON_INTERPRETER) {
            tools.push(pythonInterpreterTool);
        }

        if (Environment.ENABLE_UNSAFE_EVAL) {
            tools.push(shellExecuteTool);
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
    let handlers: Record<string, ToolHandler> = {
        ...getMcpToolHandlers(),
    };

    if (Environment.DISABLE_LOCAL_TOOLS) {
        return handlers;
    }

    handlers = {
        ...handlers,
        get_datetime: getCurrentDateTime,
        get_financial_market_data: getMarketRates,

        ...fileToolHandlers,

        python_interpreter: runPythonInterpreter,

        shell_execute: shellExecute,

        web_search: webSearch,

        get_weather: getWeather,
    };

    return handlers;
};

export function getToolPrompts(toolNames: string[]): string[] {
    if (Environment.DISABLE_LOCAL_TOOLS) {
        return getMcpToolPrompts(toolNames);
    }

    const prompts: string[] = [];

    for (const toolName of toolNames) {
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
