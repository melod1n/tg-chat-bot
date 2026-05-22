import type {ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam} from "openai/resources/chat/completions";
import {ChatRequest} from "ollama";
import {BoundaryValue} from "../common/boundary-types.js";
import {ToolRankerFallbackPolicy} from "../common/policies.js";
import {AiProvider} from "../model/ai-provider.js";
import {createMistralClient, createOllamaClient, createOpenAiClient, sameRuntimeEndpoint} from "./ai-runtime-target.js";
import {aiLog, aiLogDuration, aiLogProviderTarget} from "../logging/ai-logger.js";
import {providerChatTarget, RuntimeConfigSnapshot} from "./unified-ai-runner.shared.js";
import {
    buildRankerContext,
    buildRankerTarget,
    buildToolRankerPrompt,
    filterRankedTools,
    ToolRankerSelection,
} from "./tool-ranker-pipeline.js";
import {allToolSchemaNames} from "./unified-ai-runner.shared.js";
import {sanitizeToolRankerResult} from "./tool-ranker-metadata.js";
import {resolveToolRankerFallbackSelection} from "./tool-ranker-fallback.js";

export class ToolRanker {
    constructor(private readonly config: RuntimeConfigSnapshot) {
    }

    async selectTools(args: {
        provider: AiProvider;
        userQuery: string;
        availableTools: readonly BoundaryValue[];
        round: number;
        signal: AbortSignal;
        messages?: readonly { role?: string; content?: string | readonly { text?: string }[] }[];
        runRanker?: (
            provider: AiProvider,
            target: NonNullable<ReturnType<typeof buildRankerTarget>>,
            prompt: string,
            userQuery: string,
        ) => Promise<string>;
    }): Promise<ToolRankerSelection> {
        const {availableTools, provider, round, signal, userQuery} = args;
        const runRanker = args.runRanker ?? this.runRanker.bind(this);
        const availableNames = allToolSchemaNames(availableTools);
        const fallbackPolicy = this.config.toolRankerFallbackPolicy;
        const configuredTarget = buildRankerTarget(this.config, provider);
        const mainModelTarget = providerChatTarget(provider, this.config);

        if (!availableTools.length) {
            return {toolNames: [], usedRanker: false};
        }

        const target = configuredTarget ?? (fallbackPolicy === ToolRankerFallbackPolicy.MAIN_MODEL ? mainModelTarget : undefined);

        if (!target) {
            return resolveToolRankerFallbackSelection({
                fallbackPolicy,
                availableToolNames: availableNames,
            });
        }

        const startedAt = Date.now();
        const ranker = buildToolRankerPrompt(buildRankerContext(this.config, provider, target, round, userQuery, availableTools));

        aiLog("debug", "tool_ranker.start", {
            provider,
            round,
            target: aiLogProviderTarget(target),
            queryChars: userQuery.length,
            availableTools: availableNames,
            fallbackPolicy,
            usedMainModelFallback: !configuredTarget && fallbackPolicy === ToolRankerFallbackPolicy.MAIN_MODEL,
        });

        try {
            if (signal.aborted) throw new Error("Aborted");
            const raw = await runRanker(provider, target, ranker.prompt, userQuery);
            if (signal.aborted) throw new Error("Aborted");
            const selectedNames = sanitizeToolRankerResult({
                raw,
                availableToolNames: availableNames,
            });
            const filtered = filterRankedTools(availableTools, selectedNames);
            const toolNames = allToolSchemaNames(filtered);

            aiLog("debug", "tool_ranker.done", {
                provider,
                round,
                duration: aiLogDuration(startedAt),
                selectedNames,
                selectedCount: toolNames.length,
                rawPreview: raw.slice(0, 800),
            });

            return {toolNames, usedRanker: true};
        } catch (error) {
            if (error instanceof Error && error.message.includes("Aborted")) throw error;
            let failureMessage = error instanceof Error ? error.message : String(error);

            const canRetryOnMainModel = fallbackPolicy === ToolRankerFallbackPolicy.MAIN_MODEL
                && (
                    target.model !== mainModelTarget.model
                    || !sameRuntimeEndpoint(target, mainModelTarget)
                );

            if (canRetryOnMainModel) {
                try {
                    aiLog("warn", "tool_ranker.failed.retry_main_model", {
                        provider,
                        round,
                        target: aiLogProviderTarget(target),
                        fallbackTarget: aiLogProviderTarget(mainModelTarget),
                        duration: aiLogDuration(startedAt),
                        errorSummary: failureMessage,
                    });

                    const fallbackRanker = buildToolRankerPrompt(
                        buildRankerContext(this.config, provider, mainModelTarget, round, userQuery, availableTools),
                    );
                    const raw = await runRanker(provider, mainModelTarget, fallbackRanker.prompt, userQuery);
                    const selectedNames = sanitizeToolRankerResult({
                        raw,
                        availableToolNames: availableNames,
                    });
                    const filtered = filterRankedTools(availableTools, selectedNames);
                    const toolNames = allToolSchemaNames(filtered);

                    aiLog("debug", "tool_ranker.done", {
                        provider,
                        round,
                        duration: aiLogDuration(startedAt),
                        selectedNames,
                        selectedCount: toolNames.length,
                        rawPreview: raw.slice(0, 800),
                        fallbackUsed: true,
                    });

                    return {toolNames, usedRanker: true};
                } catch (fallbackError) {
                    if (fallbackError instanceof Error && fallbackError.message.includes("Aborted")) throw fallbackError;

                    const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
                    aiLog("warn", "tool_ranker.failed.main_model_fallback_failed", {
                        provider,
                        round,
                        target: aiLogProviderTarget(target),
                        fallbackTarget: aiLogProviderTarget(mainModelTarget),
                        duration: aiLogDuration(startedAt),
                        errorSummary: fallbackErrorMessage,
                    });

                    failureMessage = fallbackErrorMessage;
                }
            }

            aiLog("warn", "tool_ranker.failed.fallback_all_allowed", {
                provider,
                round,
                target: aiLogProviderTarget(target),
                fallbackPolicy,
                duration: aiLogDuration(startedAt),
                errorSummary: failureMessage,
            });

            return resolveToolRankerFallbackSelection({
                fallbackPolicy,
                availableToolNames: availableNames,
            });
        }
    }

    private async runRanker(
        provider: AiProvider,
        target: NonNullable<ReturnType<typeof buildRankerTarget>>,
        prompt: string,
        userQuery: string,
    ): Promise<string> {
        switch (provider) {
            case AiProvider.OLLAMA: {
                const ollama = createOllamaClient(target);
                const request = {
                    model: target.model,
                    messages: [
                        {role: "system", content: prompt},
                        {role: "user", content: userQuery},
                    ],
                    stream: false as const,
                    think: false,
                    format: {
                        type: "object",
                        properties: {
                            toolNames: {
                                type: "array",
                                items: {type: "string"},
                            },
                        },
                        required: ["toolNames"],
                        additionalProperties: false,
                    },
                    options: {
                        temperature: 0,
                        top_p: 0.8,
                        top_k: 20,
                        repeat_penalty: 1.05,
                        num_ctx: 8192,
                        num_predict: 256,
                    },
                } satisfies ChatRequest & { stream: false };

                const response = await ollama.chat(request);
                return response.message?.content?.trim() ?? "";
            }
            case AiProvider.MISTRAL: {
                const mistral = createMistralClient(target);
                const request: Parameters<typeof mistral.chat.complete>[0] = {
                    model: target.model,
                    messages: [
                        {role: "system", content: prompt},
                        {role: "user", content: userQuery},
                    ],
                    temperature: 0,
                };
                const response = await mistral.chat.complete(request);
                const message = response.choices?.[0]?.message;
                return typeof message?.content === "string" ? message.content.trim() : "";
            }
            case AiProvider.OPENAI: {
                const openAi = createOpenAiClient(target);
                const messages = [
                    {role: "system", content: prompt},
                    {role: "user", content: userQuery},
                ] satisfies ChatCompletionMessageParam[];

                // OpenAI-compatible servers often reject `response_format`, so keep JSON mode
                // only for official OpenAI endpoints.
                const request: ChatCompletionCreateParamsNonStreaming = {
                    model: target.model,
                    messages,
                };

                if (!target.baseUrl) {
                    // gpt-5 family ranker targets reject temperature=0; use the model default instead.
                    request.response_format = {type: "json_object"};
                }

                const response = await openAi.chat.completions.create(request);

                return response.choices[0]?.message?.content?.trim() ?? "";
            }
        }
    }
}
