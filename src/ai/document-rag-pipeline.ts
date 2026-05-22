import {AiProvider} from "../model/ai-provider";
import {AiDownloadedFile} from "./telegram-attachments";
import {TelegramStreamMessage} from "./telegram-stream-message";
import {deleteMistralLibrary, RuntimeConfigSnapshot, MistralDocumentReference, prepareMistralDocuments} from "./unified-ai-runner.shared";
import {MistralChatMessage} from "./mistral-chat-message";
import {OllamaChatMessage} from "./ollama-chat-message";
import {prepareOllamaDocumentRag} from "./ollama-rag";
import type {OllamaRagArtifactDetails} from "./ollama-rag";
import {OpenAIChatMessage} from "./openai-chat-message";
import {createOpenAiClient, createOllamaClient} from "./ai-runtime-target";
import {prepareOpenAiDocumentRag} from "./unified-ai-runner.openai";

export type PreparedDocumentRag =
    | {
        provider: AiProvider.OPENAI;
        vectorStoreIds: string[];
        uploadedFileIds: string[];
        cleanup: () => Promise<void>;
    }
    | {
        provider: AiProvider.MISTRAL;
        documents: MistralDocumentReference[];
        libraryId?: string;
        cleanup: () => Promise<void>;
    }
    | {
        provider: AiProvider.OLLAMA;
        prepared: boolean;
        artifact?: OllamaRagArtifactDetails;
        cleanup: () => Promise<void>;
    };

export async function prepareDocumentRag(
    provider: AiProvider,
    downloads: AiDownloadedFile[],
    messages: Array<OpenAIChatMessage | MistralChatMessage | OllamaChatMessage>,
    streamMessage: TelegramStreamMessage,
    config: RuntimeConfigSnapshot,
    signal: AbortSignal,
    userQuery: string,
): Promise<PreparedDocumentRag | undefined> {
    const documents = downloads.filter(download => download.kind === "document");
    if (!documents.length) return undefined;

    if (provider === AiProvider.OPENAI && config.openAiBackend === "compatible") {
        return undefined;
    }

    switch (provider) {
        case AiProvider.OPENAI: {
            const openAi = createOpenAiClient(config.openAiChatTarget);
            const prepared = await prepareOpenAiDocumentRag(openAi, documents);
            if (!prepared) {
                throw new Error("OpenAI document RAG preparation returned no context.");
            }
            return {
                provider,
                vectorStoreIds: prepared.vectorStoreIds,
                uploadedFileIds: prepared.uploadedFileIds,
                cleanup: prepared.cleanup,
            };
        }
        case AiProvider.MISTRAL: {
            const prepared = await prepareMistralDocuments(documents, messages as MistralChatMessage[], streamMessage, config.mistralChatTarget, signal);
            return {
                provider,
                documents: prepared.documents,
                libraryId: prepared.libraryId,
                cleanup: async () => {
                    await deleteMistralLibrary(prepared.libraryId, config.mistralChatTarget);
                },
            };
        }
        case AiProvider.OLLAMA: {
            const prepared = await prepareOllamaDocumentRag({
                downloads,
                messages: messages as OllamaChatMessage[],
                userQuery,
                message: streamMessage,
                config: {
                    embeddingModel: config.ollamaDocumentsTarget.model,
                    embeddingClient: createOllamaClient(config.ollamaDocumentsTarget),
                    chunkSize: config.ollamaRagChunkSize,
                    chunkOverlap: config.ollamaRagChunkOverlap,
                    topK: config.ollamaRagTopK,
                    maxContextChars: config.ollamaRagMaxContextChars,
                    minScore: config.ollamaRagMinScore,
                    maxArchiveFiles: config.ollamaRagMaxArchiveFiles,
                    maxArchiveBytes: config.ollamaRagMaxArchiveBytes,
                    maxArchiveDepth: config.ollamaRagMaxArchiveDepth,
                },
            });

            return {
                provider,
                prepared: prepared.prepared,
                artifact: prepared.artifact,
                cleanup: async () => undefined,
            };
        }
    }
}
