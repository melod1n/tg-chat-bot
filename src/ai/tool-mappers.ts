import {AiTool} from "./tool-types";
import {AiProvider} from "../model/ai-provider";
import {getTools} from "./tools/registry";
import {WEB_SEARCH_TOOL_NAME} from "./tools/web-search";
import {PYTHON_INTERPRETER_TOOL_NAME} from "./tools/python-interpretator";

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
