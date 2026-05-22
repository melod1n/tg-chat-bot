import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const {Environment} = await import("../dist/common/environment.js");
const {
    buildUserMemoryPrompt,
    compressMemoryWithFallback,
    deleteUserMemory,
    getMemoryFilePath,
    readUserMemory,
    updateUserMemory,
} = await import("../dist/ai/tools/user-memory.js");
const {AiProvider} = await import("../dist/model/ai-provider.js");

function makeTempDataPath() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "tg-chat-bot-memory-"));
}

function withEnv(vars, fn) {
    const snapshot = new Map();
    for (const [key, value] of Object.entries(vars)) {
        snapshot.set(key, process.env[key]);
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }

    return Promise.resolve(fn()).finally(() => {
        for (const [key, value] of snapshot.entries()) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });
}

test("memory storage supports append replace and remove", async () => {
    const oldDataPath = Environment.DATA_PATH;
    Environment.DATA_PATH = makeTempDataPath();

    try {
        const userId = 475823381;

        let result = await updateUserMemory({
            userId,
            scope: "user",
            action: "replace",
            content: "# Profile\nLikes tea",
        });
        assert.equal(result.success, true);

        result = await updateUserMemory({
            userId,
            scope: "user",
            action: "add",
            content: "Prefers concise answers",
        });
        assert.equal(result.success, true);
        assert.match(result.content, /Likes tea/);
        assert.match(result.content, /Prefers concise answers/);

        result = await updateUserMemory({
            userId,
            scope: "user",
            action: "remove",
            content: "Prefers concise answers",
        });
        assert.equal(result.success, true);
        assert.doesNotMatch(result.content, /Prefers concise answers/);

        const readback = await readUserMemory(userId, "user");
        assert.equal(readback.success, true);
        assert.equal(readback.filePath, getMemoryFilePath(userId, "user"));
        assert.match(readback.content, /Likes tea/);
    } finally {
        Environment.DATA_PATH = oldDataPath;
    }
});

test("memory delete removes the file", async () => {
    const oldDataPath = Environment.DATA_PATH;
    Environment.DATA_PATH = makeTempDataPath();

    try {
        const userId = 999;
        await updateUserMemory({userId, scope: "user", action: "replace", content: "hello"});
        const deleted = await deleteUserMemory(userId, "user");
        assert.equal(deleted.success, true);
        const readback = await readUserMemory(userId, "user");
        assert.equal(readback.success, true);
        assert.equal(readback.content, "");
    } finally {
        Environment.DATA_PATH = oldDataPath;
    }
});

test("memory prompt combines system and user files", async () => {
    const oldDataPath = Environment.DATA_PATH;
    Environment.DATA_PATH = makeTempDataPath();

    try {
        const userId = 1234;

        await updateUserMemory({
            userId,
            scope: "system",
            action: "replace",
            content: "Ты зовешься Евлампий.",
        });
        await updateUserMemory({
            userId,
            scope: "user",
            action: "replace",
            content: "Пользователь любит короткие ответы.",
        });

        const prompt = await buildUserMemoryPrompt(userId);
        assert(prompt);
        assert.equal(prompt?.includes("## Assistant memory (system.md)"), true);
        assert.equal(prompt?.includes("This is information about the assistant and its behavior."), true);
        assert.equal(prompt?.includes("## User memory (user.md)"), true);
        assert.equal(prompt?.includes("This is information about the user."), true);
        assert(prompt.indexOf("## Assistant memory (system.md)") < prompt.indexOf("## User memory (user.md)"));
    } finally {
        Environment.DATA_PATH = oldDataPath;
    }
});

test("memory compression falls back to current target when explicit target fails", async () => {
    await withEnv({
        OLLAMA_MEMORY_COMPRESS_MODEL: "memory-compress-model",
        OLLAMA_CHAT_MODEL: "chat-model",
    }, async () => {
        const calls = [];
        const result = await compressMemoryWithFallback(
            {
                provider: AiProvider.OLLAMA,
                currentTarget: {
                    provider: AiProvider.OLLAMA,
                    purpose: "chat",
                    model: "chat-model",
                },
                scope: "system",
                currentText: "x".repeat(1200),
                limit: 1000,
            },
            async ({target}) => {
                calls.push(target.model);
                if (target.model === "memory-compress-model") {
                    throw new Error("boom");
                }
                return "short summary";
            },
        );

        assert.deepEqual(calls, ["memory-compress-model", "chat-model"]);
        assert.equal(result.content, "short summary");
        assert.equal(result.compressed, true);
    });
});

test("memory compression uses current target when no separate target exists", async () => {
    await withEnv({
        OLLAMA_MEMORY_COMPRESS_MODEL: undefined,
        OLLAMA_CHAT_MODEL: "chat-model",
    }, async () => {
        const calls = [];
        const result = await compressMemoryWithFallback(
            {
                provider: AiProvider.OLLAMA,
                currentTarget: {
                    provider: AiProvider.OLLAMA,
                    purpose: "chat",
                    model: "chat-model",
                },
                scope: "user",
                currentText: "x".repeat(1200),
                limit: 1000,
            },
            async ({target}) => {
                calls.push(target.model);
                return "summary";
            },
        );

        assert.deepEqual(calls, ["chat-model"]);
        assert.equal(result.content, "summary");
        assert.equal(result.compressed, true);
    });
});
