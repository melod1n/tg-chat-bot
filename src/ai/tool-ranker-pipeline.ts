import type {BoundaryValue} from "../common/boundary-types";
import type {AiRuntimeTarget} from "./ai-runtime-target";
import {AiProvider} from "../model/ai-provider";
import {RuntimeConfigSnapshot, toolSchemaNames} from "./unified-ai-runner.shared";
import {
    buildToolRankerSystemPrompt,
    getToolRankerAvailableToolInfos,
    type ToolRankerToolInfo,
} from "./tool-ranker-metadata";

export type ToolRankerMessage = {
    role?: string;
    content?: BoundaryValue;
};

export type ToolRankerSelection = {
    toolNames: string[];
    usedRanker: boolean;
};

export type ToolRankerContext = {
    provider: AiProvider;
    round: number;
    userQuery: string;
    availableTools: readonly BoundaryValue[];
    targetModel: string;
    rankerPrompt?: string | null;
    promptAdditions?: string | null;
};

export type ToolRankerPromptPlan = {
    availableToolNames: string[];
    availableToolInfos: ToolRankerToolInfo[];
    prompt: string;
};

export function latestUserTextFromMessages(messages: readonly ToolRankerMessage[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message?.role !== "user") continue;
        if (typeof message.content === "string") return message.content;

        if (Array.isArray(message.content)) {
            return message.content
                .map(part => {
                    if (typeof part === "object" && part !== null && "text" in part && typeof part.text === "string") {
                        return part.text;
                    }
                    return "";
                })
                .filter(Boolean)
                .join("\n");
        }
    }

    return "";
}

export function buildToolRankerPrompt(context: ToolRankerContext): ToolRankerPromptPlan {
    const availableToolInfos = getToolRankerAvailableToolInfos(context.availableTools);
    const availableToolNames = availableToolInfos.map(tool => tool.name);
    const prompt = buildToolRankerSystemPrompt({
        availableTools: availableToolInfos,
        includeExamples: true,
        maxExamplesPerTool: 1,
        compact: true,
    });

    return {
        availableToolNames,
        availableToolInfos,
        prompt: [
            context.rankerPrompt?.trim() || null,
            context.promptAdditions?.trim() || null,
            prompt,
        ].filter((line): line is string => Boolean(line?.trim?.() ?? line)).join("\n\n"),
    };
}

export function filterRankedTools<T extends BoundaryValue>(availableTools: readonly T[], toolNames: readonly string[]): T[] {
    const selected = new Set(toolNames);
    return availableTools.filter(tool => toolSchemaNames(tool).some(name => selected.has(name)));
}

export function buildRankerContext(config: RuntimeConfigSnapshot, provider: AiProvider, target: AiRuntimeTarget, round: number, userQuery: string, availableTools: readonly BoundaryValue[]): ToolRankerContext {
    return {
        provider,
        round,
        userQuery,
        availableTools,
        targetModel: target.model,
        rankerPrompt: config.rankerToolPrompt,
        promptAdditions: target.systemPromptAdditions ?? null,
    };
}

export function buildRankerTarget(config: RuntimeConfigSnapshot, provider: AiProvider): AiRuntimeTarget | undefined {
    const target = provider === AiProvider.OLLAMA
        ? config.ollamaToolRankerTarget
        : provider === AiProvider.MISTRAL
            ? config.mistralToolRankerTarget
            : provider === AiProvider.OPENAI
                ? config.openAiToolRankerTarget
                : undefined;

    if (!target?.model) return undefined;

    return {
        provider: target.provider,
        purpose: target.purpose,
        model: target.model,
        baseUrl: target.baseUrl,
        apiKey: target.apiKey,
        systemPromptAdditions: target.systemPromptAdditions ?? null,
    };
}
