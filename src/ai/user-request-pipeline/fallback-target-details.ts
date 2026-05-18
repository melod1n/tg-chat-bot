import {AiProvider} from "../../model/ai-provider.js";
import type {RuntimeConfigSnapshot} from "../unified-ai-runner.shared.js";
import {aiLogProviderTarget} from "../../logging/ai-logger.js";
import {buildRankerTarget} from "../tool-ranker-pipeline.js";
import {providerChatTarget} from "../unified-ai-runner.shared.js";

export function buildToolRankFallbackTargetDetails(provider: AiProvider, config: RuntimeConfigSnapshot) {
    const sourceTarget = buildRankerTarget(config, provider);
    const alternateTarget = providerChatTarget(provider, config);

    return {
        sourceTarget: aiLogProviderTarget(sourceTarget),
        alternateTarget: aiLogProviderTarget(alternateTarget),
    };
}
