const OLLAMA_SPEECH_TO_TEXT_MODELS = new Set([
    "gemma4:e2b",
    "gemma4:e4b",
]);

export function isOllamaSpeechToTextModel(model: string | undefined | null): boolean {
    return !!model && OLLAMA_SPEECH_TO_TEXT_MODELS.has(model.trim().toLowerCase());
}
