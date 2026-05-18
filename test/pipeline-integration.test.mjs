import test from "node:test";
import assert from "node:assert/strict";

const {UserRequestPipeline} = await import("../dist/ai/user-request-pipeline/pipeline.js");
const {PIPELINE_ATTACHMENT_LIMIT_BYTES} = await import("../dist/ai/user-request-pipeline/types.js");

class FakeTelegramStreamMessage {
    constructor() {
        this.status = "";
        this.text = "";
        this.toolExecutions = [];
        this.outputAttachments = [];
        this.internalAttachments = [];
        this.pipelineAudits = [];
        this.finished = false;
        this.failed = false;
    }

    setStatus(status) {
        this.status = status;
    }

    clearStatus() {
        this.status = "";
    }

    append(delta) {
        this.text += delta;
    }

    replaceText(text) {
        this.text = text;
    }

    getText() {
        return this.text;
    }

    recordToolExecution(record) {
        this.toolExecutions.push(record);
    }

    getToolExecutions() {
        return [...this.toolExecutions];
    }

    recordOutputAttachment(record) {
        this.outputAttachments.push(record);
    }

    getOutputAttachments() {
        return [...this.outputAttachments];
    }

    async storeInternalAttachment(attachment) {
        this.internalAttachments.push(attachment);
    }

    async storePipelineAudit(events) {
        this.pipelineAudits.push(...events);
    }

    async finish() {
        this.finished = true;
    }

    async fail() {
        this.failed = true;
    }
}

class FakeProviderAdapter {
    constructor() {
        this.calls = [];
    }

    async callModel(request, execute) {
        this.calls.push(request);
        return await execute();
    }

    appendToolResults(messages, calls, results) {
        for (const [index, call] of calls.entries()) {
            messages.push({
                role: "tool",
                name: call.name,
                content: results[index] ?? "",
            });
        }
    }
}

class FakeMemoryStore {
    constructor() {
        this.rows = [];
    }

    persist(state) {
        this.rows.push({
            requestId: state.requestId,
            audit: [...state.audit],
            artifacts: [...state.artifacts],
            outputAttachments: [...state.outputAttachments],
        });
    }
}

function createBaseState() {
    return {
        requestId: "integration-request-1",
        chatId: 10,
        messageId: 20,
        fromId: 30,
        receivedAt: new Date().toISOString(),
        text: "process my attachments",
        settings: {
            provider: "OLLAMA",
            responseLanguage: "en",
            voiceMode: "execute",
            imageOutputMode: "photo",
        },
        inputAttachments: [],
        outputAttachments: [],
        artifacts: [],
        toolRankDecisions: [],
        audit: [],
    };
}

function artifact(kind, stage, extra = {}) {
    return {
        kind,
        stage,
        createdAt: "2026-05-18T00:00:00.000Z",
        ...extra,
    };
}

function outputAttachment(fileName, kind = "file") {
    return {
        direction: "output",
        kind,
        fileId: `${fileName}-file-id`,
        fileName,
        sizeBytes: 1024,
        cachePath: `/tmp/${fileName}`,
    };
}

test("integration pipeline rejects oversized attachment before later stages", async () => {
    const stream = new FakeTelegramStreamMessage();
    const state = createBaseState();
    state.inputAttachments.push({
        direction: "input",
        kind: "document",
        fileId: "doc-oversized",
        fileName: "big.pdf",
        sizeBytes: PIPELINE_ATTACHMENT_LIMIT_BYTES + 1,
        cachePath: "/tmp/big.pdf",
    });

    const pipeline = new UserRequestPipeline({
        stages: [{
            name: "input_size_gate",
            async run() {
                stream.setStatus("Checking size");
                const tooLarge = state.inputAttachments.some(attachment => attachment.sizeBytes > PIPELINE_ATTACHMENT_LIMIT_BYTES);
                stream.clearStatus();

                return {
                    stage: "input_size_gate",
                    status: tooLarge ? "fallback" : "succeeded",
                    fallbackAction: tooLarge ? "notify_user" : undefined,
                };
            },
        }],
        stageNames: ["input_size_gate"],
    });

    await pipeline.run(state, new AbortController().signal);

    assert.equal(state.audit.at(-1)?.status, "fallback");
    assert.equal(state.audit.at(-1)?.details?.fallbackAction, "notify_user");
    assert.equal(stream.status, "");
});

test("integration pipeline carries artifacts through fake document, voice, tool and tts stages", async () => {
    const stream = new FakeTelegramStreamMessage();
    const adapter = new FakeProviderAdapter();
    const store = new FakeMemoryStore();
    const state = createBaseState();
    state.inputAttachments.push(
        {
            direction: "input",
            kind: "document",
            fileId: "doc-1",
            fileName: "contract.pdf",
            sizeBytes: 1024,
            cachePath: "/tmp/contract.pdf",
        },
        {
            direction: "input",
            kind: "audio",
            fileId: "audio-1",
            fileName: "voice.ogg",
            sizeBytes: 2048,
            cachePath: "/tmp/voice.ogg",
        },
    );

    const pipeline = new UserRequestPipeline({
        stages: [
            {
                name: "input_size_gate",
                async run() {
                    return {
                        stage: "input_size_gate",
                        status: "succeeded",
                    };
                },
            },
            {
                name: "document_rag",
                async run() {
                    stream.setStatus("RAG");
                    stream.clearStatus();
                    return {
                        stage: "document_rag",
                        status: "succeeded",
                        artifacts: [artifact("rag", "document_rag", {
                            provider: "OLLAMA",
                            sourceAttachmentIds: ["doc-1"],
                            extractedText: "contract text",
                        })],
                    };
                },
            },
            {
                name: "speech_to_text",
                async run() {
                    return {
                        stage: "speech_to_text",
                        status: "succeeded",
                        artifacts: [artifact("transcript", "speech_to_text", {
                            text: "transcribed voice",
                            sourceAttachmentIds: ["audio-1"],
                            model: "fake-stt",
                        })],
                    };
                },
            },
            {
                name: "model_call",
                async run() {
                    const reply = await adapter.callModel({provider: "OLLAMA", model: "fake-model"}, async () => {
                        stream.append("final answer");
                        return "final answer";
                    });

                    return {
                        stage: "model_call",
                        status: "succeeded",
                        artifacts: [artifact("final_text", "model_call", {
                            text: reply,
                        })],
                    };
                },
            },
            {
                name: "tool_loop",
                async run() {
                    const calls = [{id: "tool-call-1", name: "read_file", argumentsText: "{\"path\":\"docs/a.md\"}"}];
                    const results = ["tool result"];
                    adapter.appendToolResults([], calls, results);
                    stream.recordToolExecution({
                        toolName: "read_file",
                        callId: "tool-call-1",
                        argumentsText: "{\"path\":\"docs/a.md\"}",
                        resultChars: results[0].length,
                        startedAt: "2026-05-18T00:00:00.000Z",
                        finishedAt: "2026-05-18T00:00:01.000Z",
                    });

                    return {
                        stage: "tool_loop",
                        status: "succeeded",
                        artifacts: [artifact("tool_result", "tool_loop", {
                            toolName: "read_file",
                            callId: "tool-call-1",
                            resultText: results[0],
                        })],
                    };
                },
            },
            {
                name: "persist_output_artifacts",
                async run() {
                    const generatedFile = outputAttachment("report.txt", "file");
                    stream.recordOutputAttachment({
                        artifactKind: "generated_file",
                        fileName: generatedFile.fileName,
                        mimeType: "text/plain",
                        sizeBytes: generatedFile.sizeBytes,
                        messageId: 321,
                    });

                    return {
                        stage: "persist_output_artifacts",
                        status: "succeeded",
                        artifacts: [artifact("generated_file", "persist_output_artifacts", {
                            attachmentId: generatedFile.fileId,
                        })],
                        attachments: [generatedFile],
                    };
                },
            },
            {
                name: "text_to_speech",
                async run() {
                    stream.recordOutputAttachment({
                        artifactKind: "tts_audio",
                        fileName: "answer.ogg",
                        mimeType: "audio/ogg",
                        sizeBytes: 4096,
                        messageId: 322,
                    });

                    return {
                        stage: "text_to_speech",
                        status: "succeeded",
                        artifacts: [artifact("tts_audio", "text_to_speech", {
                            attachmentId: "tts-audio-id",
                        })],
                        attachments: [outputAttachment("answer.ogg", "audio")],
                    };
                },
            },
            {
                name: "audit_finish",
                async run() {
                    store.persist(state);
                    return {
                        stage: "audit_finish",
                        status: "succeeded",
                    };
                },
            },
        ],
        stageNames: [
            "input_size_gate",
            "document_rag",
            "speech_to_text",
            "model_call",
            "tool_loop",
            "persist_output_artifacts",
            "text_to_speech",
            "audit_finish",
        ],
    });

    await pipeline.run(state, new AbortController().signal);

    assert.equal(adapter.calls.length, 1);
    assert.equal(stream.getText(), "final answer");
    assert.equal(stream.getToolExecutions().length, 1);
    assert.equal(stream.getOutputAttachments().length, 2);
    assert.equal(state.artifacts.some(entry => entry.kind === "rag"), true);
    assert.equal(state.artifacts.some(entry => entry.kind === "transcript"), true);
    assert.equal(state.artifacts.some(entry => entry.kind === "final_text"), true);
    assert.equal(state.artifacts.some(entry => entry.kind === "tool_result"), true);
    assert.equal(state.artifacts.some(entry => entry.kind === "generated_file"), true);
    assert.equal(state.artifacts.some(entry => entry.kind === "tts_audio"), true);
    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].artifacts.length >= 6, true);
});

test("integration pipeline stops on fail_request fallback", async () => {
    const stream = new FakeTelegramStreamMessage();
    const state = createBaseState();
    const pipeline = new UserRequestPipeline({
        stages: [{
            name: "input_size_gate",
            async run() {
                stream.setStatus("Boom");
                throw new Error("boom");
            },
        }],
        stageNames: ["input_size_gate", "document_rag"],
        fallbackPolicies: [{
            stage: "input_size_gate",
            onUnavailable: "fail_request",
            onFailed: "fail_request",
        }],
    });

    await assert.rejects(() => pipeline.run(state, new AbortController().signal), /PipelineRequestFailure/);
    assert.equal(state.audit.some(entry => entry.stage === "document_rag"), false);
});
