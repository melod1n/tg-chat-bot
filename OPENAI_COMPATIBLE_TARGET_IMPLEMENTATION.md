# OPENAI Compatible Target Implementation

## Purpose

Add a separate execution path for OpenAI-compatible backends such as `llama.cpp`, while keeping the current official OpenAI path unchanged.

## Checklist

- [x] Add explicit OpenAI backend mode in config
- [x] Route OpenAI requests to separate official and compatible runners
- [x] Keep official OpenAI on `responses.create(...)`
- [x] Add compatible `chat.completions.create(...)` runner
- [x] Add compatible tool-call extractors
- [x] Add backend selection tests
- [x] Add basic memory/config regression coverage
- [x] Normalize compatible streaming tool-call assembly
- [x] Preserve file upload behavior in compatible backend
- [x] Guard unsupported OpenAI-only tools for compatible backend
- [x] Add environment docs and example config entries
- [x] Add real-server integration coverage for compatible backend
- [x] Revisit shared orchestration extraction for further deduplication

## Non-Goals

1. Do not change the current official OpenAI `responses.create(...)` behavior.
2. Do not auto-switch behavior only because `OPENAI_BASE_URL` is set.
3. Do not merge compatible backend quirks into the official OpenAI runner.
4. Do not remove or weaken existing tool ranking, memory, RAG, logging, or upload behavior.

## Current State

1. `src/ai/unified-ai-runner.openai.ts` currently uses the official `responses` API.
2. `src/ai/provider-adapters.ts` already has provider-specific adapters and tool/result mapping.
3. `src/ai/provider-adapter-contract.ts` already contains `responses`-style extractors.
4. `src/ai/openai-chat-message.ts` currently models `responses`-style messages, not `chat.completions` tool messages.
5. `src/ai/unified-ai-request-pipeline.ts` prepares chat context and runtime state before the model call.
6. `src/ai/ai-runtime-target.ts` resolves provider targets, base URLs, models, and keys.
7. `src/ai/unified-ai-runner.tool-ranker.ts` already uses a `chat.completions`-style call path, which is closer to compatible backends.

## Target Architecture

1. Official OpenAI backend stays on `responses.create(...)`.
2. Compatible OpenAI backend uses `chat.completions.create(...)`.
3. Backend selection is explicit through config, for example `OPENAI_BACKEND=official|compatible`.
4. Shared preparation logic remains common.
5. Transport-specific request formatting and response parsing are split.

## Configuration Design

1. Add a new config value `OPENAI_BACKEND`.
2. Allowed values should be `official` and `compatible`.
3. Default must be `official`.
4. Keep `OPENAI_BASE_URL` as a transport setting only.
5. `OPENAI_BASE_URL` must not imply compatible mode by itself.
6. Extend environment schema and runtime config to expose this value.
7. Update env docs and example env files.

## Step 1: Config and Target Selection

1. Update `src/common/environment.ts`.
2. Add a new environment field for backend mode.
3. Add setters if the codebase uses runtime env mutation in tests.
4. Update the startup schema and runtime snapshot.
5. Add tests for default value and explicit `compatible` selection.

Expected result:
- Official OpenAI stays unchanged by default.
- Explicit `OPENAI_BACKEND=compatible` selects the new execution path.

## Step 2: Split Runner Selection

1. Update the unified AI execution entry point.
2. Add a small backend selector for OpenAI targets.
3. Route official mode to the current runner.
4. Route compatible mode to a new compatible runner.
5. Keep other providers untouched.

Expected result:
- One codepath for official OpenAI.
- One codepath for OpenAI-compatible servers.

## Step 3: Shared Orchestration Extraction

1. Identify logic that is identical for both OpenAI branches.
2. Extract common orchestration into a shared helper where possible.
3. Keep these pieces shared:
   - memory prompt injection
   - tool ranking
   - tool loop control
   - logging and timing
   - cancellation handling
   - file upload post-processing
   - document RAG preparation and cleanup
4. Keep transport-specific pieces separate:
   - request shape
   - response parsing
   - tool result message shape
   - streaming event parsing

Expected result:
- Less duplicate logic.
- Cleaner separation between official and compatible behavior.

## Step 4: Compatible Message Model

1. Update `src/ai/openai-chat-message.ts` or create a sibling type file for compatible chat messages.
2. Model `system`, `user`, `assistant`, and `tool` roles explicitly.
3. Support `tool_calls` on assistant messages.
4. Support `tool_call_id` on tool result messages.
5. Preserve support for text and multimodal user content where the backend supports it.
6. Avoid forcing `responses` output types into `chat.completions`.

Expected result:
- Compatible runner can build valid `chat.completions` message arrays.

## Step 5: Compatible Contract Extractors

1. Extend `src/ai/provider-adapter-contract.ts`.
2. Add extractors for `chat.completions` tool calls.
3. Add extractors for `chat.completions` streaming tool call deltas.
4. Keep existing `responses` extractors intact.
5. Normalize tool call IDs, names, and argument text the same way as existing extractors.
6. Ensure arguments are always represented as JSON text for the tool loop.

Expected result:
- Compatible runner can parse tool calls from both normal and streaming responses.

## Step 6: Compatible Provider Adapter

1. Update `src/ai/provider-adapters.ts`.
2. Add a separate adapter or branch for OpenAI-compatible chat.completions behavior.
3. Reuse existing tool ranking where safe.
4. Make `appendToolResults(...)` emit `role: "tool"` messages with `tool_call_id`.
5. Keep official OpenAI adapter outputting `function_call_output`.
6. Keep Mistral and Ollama unchanged.

Expected result:
- Each backend uses the tool result shape it expects.

## Step 7: Compatible Runner Implementation

1. Create a new file such as `src/ai/unified-ai-runner.openai-compatible.ts`.
2. Use `openai.chat.completions.create(...)`.
3. Pass `messages`, `tools`, `model`, `stream`, and `signal`.
4. Map system prompt and memory prompt into the `messages` array correctly.
5. Keep the tool loop structure from the current runner.
6. Append assistant tool-call messages and tool result messages between rounds.
7. Continue until no tool calls remain or max rounds is reached.

Expected result:
- Compatible backends can complete multi-round tool flows.

## Step 8: Tool Call Loop Semantics

1. Preserve `MAX_TOOL_ROUNDS`.
2. Preserve tool ranking before each round.
3. Preserve memory tool selection.
4. Preserve file search injection when document RAG is active.
5. Preserve file upload post-processing.
6. Preserve max-rounds warnings and continuation decisions.
7. Keep the final text visible in the stream message exactly as today.

Expected result:
- Compatible backend behaves like the current runner from the user’s perspective.

## Step 9: Streaming Behavior

1. Implement streaming event handling for `chat.completions`.
2. Parse text deltas and append them to `TelegramStreamMessage`.
3. Parse `delta.tool_calls` and keep incremental tool-call state.
4. Update status text when tool usage starts and ends.
5. Keep image generation and file-search status handling if the backend emits compatible signals.
6. Finalize the stream only after the terminal completion event.

Expected result:
- Streaming works without losing tool call state.

## Step 10: Tool Result Handling

1. After each tool execution round, append tool results using the compatible message format.
2. Ensure each tool result keeps the correct `tool_call_id`.
3. Preserve the existing file upload hook.
4. If upload fails, convert the failure into a tool result error string.
5. Preserve the same tool memory map behavior.

Expected result:
- The backend receives a valid message history for the next round.

## Step 11: Prompt and Memory Injection

1. Keep `buildSystemInstruction(...)` as the source of system prompt assembly.
2. Keep `buildUserMemoryPrompt(...)` injected as a separate block.
3. Preserve the explicit separation between assistant memory and user memory.
4. Preserve the `user.md` and `system.md` memory layout.
5. Ensure compatible backend receives the same semantic prompt content.

Expected result:
- Memory behavior stays identical across official and compatible backends.

## Step 12: Tool Ranking Compatibility

1. Review `src/ai/unified-ai-runner.tool-ranker.ts`.
2. Verify whether the current JSON response handling is safe for compatible backends.
3. If a backend cannot guarantee strict JSON mode, add a fallback parser.
4. Keep ranking inputs and outputs consistent across both branches.
5. Do not weaken tool selection heuristics.

Expected result:
- Tool ranking remains deterministic enough for both branches.

## Step 13: File Search and RAG

1. Keep document RAG preparation in the request pipeline.
2. Keep vector store preparation for official OpenAI.
3. Decide whether compatible backend supports file search or needs a no-op fallback.
4. If unsupported, guard the tool list so the compatible backend never receives unsupported tools.
5. Keep cleanup behavior for temporary artifacts.

Expected result:
- Compatible backend does not receive tools it cannot execute.

## Step 14: Error Handling

1. Preserve abort handling.
2. Preserve response failure handling.
3. Preserve stream error handling.
4. Surface backend-specific incompatibilities as explicit errors.
5. Do not silently fall back from compatible to official mode.
6. Keep logs actionable.

Expected result:
- Failures are obvious and debuggable.

## Step 15: Logging and Observability

1. Keep the current AI logs and duration tracking.
2. Add backend mode to log metadata.
3. Log tool calls, tool outputs, and round transitions in both branches.
4. Preserve existing observability hooks.
5. Add explicit labels for official vs compatible runs.

Expected result:
- Debugging remains easy after the split.

## Step 16: Tests

1. Add unit tests for backend selection.
2. Add unit tests for compatible message conversion.
3. Add unit tests for compatible tool call extraction.
4. Add integration tests for a tool-call round trip using mocked `chat.completions`.
5. Add tests proving the official `responses` path is unchanged.
6. Add tests for streaming tool call parsing if the backend supports it.
7. Add tests for fallback behavior in the tool ranker if needed.

Expected result:
- Both branches are covered and regressions are visible quickly.

## Step 17: Suggested File Changes

1. `src/common/environment.ts`
2. `src/ai/ai-runtime-target.ts`
3. `src/ai/unified-ai-request-pipeline.ts`
4. `src/ai/unified-ai-runner.openai.ts`
5. `src/ai/unified-ai-runner.openai-compatible.ts`
6. `src/ai/provider-adapter-contract.ts`
7. `src/ai/provider-adapters.ts`
8. `src/ai/openai-chat-message.ts`
9. `src/ai/unified-ai-runner.tool-ranker.ts`
10. `test/*.test.mjs`
11. `.env.example`
12. Documentation files for backend selection

## Implementation Order

1. [x] Add config flag and wire it through environment parsing.
2. [x] Add backend selection logic.
3. [x] Add compatible message and extractor support.
4. [x] Create the compatible runner.
5. [x] Reuse shared orchestration where possible.
6. [x] Wire tests.
7. [x] Verify official behavior is unchanged.
8. [x] Verify compatible backend works with a real OpenAI-compatible server.

## Verification Plan

1. Run unit tests.
2. Run integration tests.
3. Verify official OpenAI path still uses `responses.create(...)`.
4. Verify compatible path uses `chat.completions.create(...)`.
5. Verify a `llama.cpp`-style server can complete a tool loop.
6. Verify memory tools still work.
7. Verify document RAG and file upload behavior do not regress.

## Risks

1. Some OpenAI-compatible servers do not support every official OpenAI feature.
2. Streaming tool call deltas may differ across providers.
3. JSON-mode assumptions in the ranker may not hold for all compatible servers.
4. Tool schema filtering may need backend-specific allowlists.
5. Message conversion mistakes can break tool loops silently if not tested.

## Acceptance Criteria

1. Official OpenAI behavior is unchanged.
2. Compatible backend can run a full chat loop with tools.
3. Tool calls are correctly extracted and executed.
4. Tool results are appended in the correct format.
5. Memory injection still works.
6. Document RAG and file upload behavior remain functional or fail explicitly.
7. Tests cover both branches.

## Final Note

The key design rule is simple: keep official OpenAI `responses` behavior intact, and introduce OpenAI-compatible `chat.completions` behavior as a separate backend mode with its own parsing and message shape.
