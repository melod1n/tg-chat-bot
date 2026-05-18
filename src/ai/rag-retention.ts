import {appLogger} from "../logging/logger.js";
import {DatabaseManager} from "../db/database-manager.js";
import {AiProvider} from "../model/ai-provider.js";
import {createOpenAiClient, resolveAiRuntimeTarget} from "./ai-runtime-target.js";
import {deleteMistralLibrary} from "./unified-ai-runner.shared.js";
import {buildStaleRagCleanupPlan} from "./rag-retention-planner.js";

const logger = appLogger.child("rag-retention");

function unique(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}

async function cleanupOpenAiRag(vectorStoreIds: string[], uploadedFileIds: string[]): Promise<void> {
    const target = resolveAiRuntimeTarget(AiProvider.OPENAI, "documents");
    const client = createOpenAiClient(target);

    for (const vectorStoreId of unique(vectorStoreIds)) {
        const startedAt = Date.now();
        logger.info("openai.vector_store.cleanup.start", {vectorStoreId});
        try {
            await client.vectorStores.delete(vectorStoreId);
            logger.success("openai.vector_store.cleanup.done", {vectorStoreId, duration: `${Date.now() - startedAt}ms`});
        } catch (error) {
            logger.warn("openai.vector_store.cleanup.failed", {
                vectorStoreId,
                duration: `${Date.now() - startedAt}ms`,
                error: error instanceof Error ? error : String(error),
            });
        }
    }

    for (const fileId of unique(uploadedFileIds)) {
        const startedAt = Date.now();
        logger.info("openai.file.cleanup.start", {fileId});
        try {
            await client.files.delete(fileId);
            logger.success("openai.file.cleanup.done", {fileId, duration: `${Date.now() - startedAt}ms`});
        } catch (error) {
            logger.warn("openai.file.cleanup.failed", {
                fileId,
                duration: `${Date.now() - startedAt}ms`,
                error: error instanceof Error ? error : String(error),
            });
        }
    }
}

async function cleanupMistralRag(libraryId: string): Promise<void> {
    const target = resolveAiRuntimeTarget(AiProvider.MISTRAL, "documents");
    const startedAt = Date.now();
    logger.info("mistral.library.cleanup.start", {libraryId});
    try {
        await deleteMistralLibrary(libraryId, target);
        logger.success("mistral.library.cleanup.done", {libraryId, duration: `${Date.now() - startedAt}ms`});
    } catch (error) {
        logger.warn("mistral.library.cleanup.failed", {
            libraryId,
            duration: `${Date.now() - startedAt}ms`,
            error: error instanceof Error ? error : String(error),
        });
    }
}

export async function cleanupStaleRagProviderState(retentionDays = 14): Promise<{
    scannedArtifacts: number;
    cleanupTargets: number;
    openaiTargets: number;
    mistralTargets: number;
}> {
    const startedAt = Date.now();
    const artifacts = await DatabaseManager.getAllArtifacts().catch(() => []);
    const plan = buildStaleRagCleanupPlan(artifacts, retentionDays);

    logger.info("cleanup.start", {
        retentionDays,
        scannedArtifacts: artifacts.length,
        cleanupTargets: plan.targets.length,
        cutoffAt: plan.cutoffAt,
    });

    let openaiTargets = 0;
    let mistralTargets = 0;

    for (const target of plan.targets) {
        switch (target.provider) {
            case "OPENAI":
                openaiTargets += 1;
                await cleanupOpenAiRag(target.vectorStoreIds ?? [], target.uploadedFileIds ?? []);
                break;
            case "MISTRAL":
                mistralTargets += 1;
                if (target.libraryId) {
                    await cleanupMistralRag(target.libraryId);
                }
                break;
            case "OLLAMA":
                break;
        }
    }

    logger.success("cleanup.done", {
        retentionDays,
        scannedArtifacts: artifacts.length,
        cleanupTargets: plan.targets.length,
        openaiTargets,
        mistralTargets,
        duration: `${Date.now() - startedAt}ms`,
    });

    return {
        scannedArtifacts: artifacts.length,
        cleanupTargets: plan.targets.length,
        openaiTargets,
        mistralTargets,
    };
}
