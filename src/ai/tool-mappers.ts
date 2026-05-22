import {AiTool} from "./tool-types";
import {AiProvider} from "../model/ai-provider.js";
import {getTools} from "./tools/registry.js";
import {WEB_SEARCH_TOOL_NAME} from "./tools/web-search.js";
import {PYTHON_INTERPRETER_TOOL_NAME} from "./tools/python-interpretator.js";
import {toolSchemaNames} from "./tool-schema-utils.js";

export type AiProviderName = "ollama" | "openai" | "mistral";

export function getOllamaTools(forCreator?: boolean): AiTool[] {
    return getTools(forCreator);
}

const openAiForbiddenTools = [
    WEB_SEARCH_TOOL_NAME,
    PYTHON_INTERPRETER_TOOL_NAME
];

function allowedOpenAiTool(tool: AiTool): boolean {
    return !openAiForbiddenTools.includes(tool.function.name);
}

export function getOpenAITools(forCreator?: boolean): AiTool[] {
    return getTools(forCreator).filter(allowedOpenAiTool).map(tool => ({
        type: "function",
        function: tool.function,
    }));
}

export function getOpenAICompatibleTools(forCreator?: boolean): AiTool[] {
    // The compatible chat.completions backend only accepts plain function tools.
    return getOpenAITools(forCreator);
}

export type OpenAiResponseTool = {
    type: "function";
    name: string;
    description?: string;
    parameters?: object;
    strict: false;
};

export type OpenAiCodeInterpreterTool = {
    type: "code_interpreter";
    container: {
        type: "auto";
        file_ids?: string[];
        memory_limit?: "1g" | "4g" | "16g" | "64g" | null;
    } | string;
};

export function getOpenAIResponsesTools(forCreator?: boolean): OpenAiResponseTool[] {
    return getOpenAITools(forCreator).map(tool => ({
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
        strict: false,
    }));
}

export function getOpenAICodeInterpreterTool(): OpenAiCodeInterpreterTool {
    return {
        type: "code_interpreter",
        container: {
            type: "auto",
        },
    };
}

export function getMistralTools(forCreator?: boolean): AiTool[] {
    return getTools(forCreator).map(tool => ({
        type: "function",
        function: tool.function,
    }));
}

export function getProviderTools(provider: AiProvider, forCreator?: boolean): AiTool[] {
    switch (provider) {
        case AiProvider.OLLAMA:
            return getOllamaTools(forCreator);
        case AiProvider.MISTRAL:
            return getMistralTools(forCreator);
        case AiProvider.OPENAI:
            return getOpenAITools(forCreator);
    }
}

export function ensureToolsSelected<T>(availableTools: readonly T[], selectedTools: readonly T[], toolNames: readonly string[]): T[] {
    const selected = [...selectedTools];
    const selectedNames = new Set(selected.flatMap(tool => toolSchemaNames(tool as never)));

    for (const toolName of toolNames) {
        if (selectedNames.has(toolName)) continue;

        const extraTool = availableTools.find(tool => toolSchemaNames(tool as never).includes(toolName));
        if (extraTool) {
            selected.unshift(extraTool);
            selectedNames.add(toolName);
        }
    }

    return selected;
}
