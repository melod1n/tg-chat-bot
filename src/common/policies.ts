export enum RateLimitFallbackPolicy {
    NOTIFY_USER = "NOTIFY_USER",
    IGNORE_USER = "IGNORE_USER",
    USE_OLLAMA = "USE_OLLAMA",
}

export enum ImageHandlePolicy {
    IGNORE = "IGNORE",
    FORCE_HANDLE = "FORCE_HANDLE",
    HANDLE_IF_CAPABLE = "HANDLE_IF_CAPABLE",
}

export enum ImageHandleFallbackPolicy {
    NOTIFY_USER = "NOTIFY_USER",
    IGNORE_USER = "IGNORE_USER",
    USE_OLLAMA = "USE_OLLAMA",
}