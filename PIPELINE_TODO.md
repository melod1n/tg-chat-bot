# User Request Pipeline TODO

Этот чеклист описывает оставшиеся задачи по доведению pipeline до чистой архитектуры. Текущее состояние уже рабочее: есть `UserRequestPipeline`, stage audit, `ai_requests`, internal artifacts, unified size gate, RAG/STT/final/error/tool-result artifacts и response pipeline. Ниже перечислены задачи, которые ещё нужно сделать, чтобы убрать оставшиеся архитектурные компромиссы.

## 1. Нормализовать хранение attachments, artifacts и audit

- [x] Создать отдельную таблицу `attachments`.
- [x] Поля `attachments`: `id`, `messageChatId`, `messageId`, `direction`, `scope`, `kind`, `artifactKind`, `fileId`, `fileUniqueId`, `fileName`, `mimeType`, `cachePath`, `sizeBytes`, `sha256`, `metadata`, `createdAt`.
- [x] Создать отдельную таблицу `artifacts`.
- [x] Поля `artifacts`: `id`, `requestId`, `messageChatId`, `messageId`, `kind`, `stage`, `attachmentId`, `payload`, `createdAt`.
- [x] Создать отдельную таблицу `request_audit`.
- [x] Поля `request_audit`: `id`, `requestId`, `messageChatId`, `messageId`, `stage`, `status`, `startedAt`, `finishedAt`, `durationMs`, `provider`, `model`, `details`, `error`.
- [x] Оставить обратную совместимость с текущими JSON-полями `messages.attachments` и `messages.pipelineAudit`.
- [x] Добавить миграцию: переносить существующие `messages.attachments` в новую таблицу `attachments`.
- [x] Добавить миграцию: переносить существующие `messages.pipelineAudit` в новую таблицу `request_audit`.
- [x] Обновить backup/export/import, чтобы новые таблицы попадали в JSON и SQL dump.
- [x] Добавить DAO/store слой: `AttachmentStore`, `ArtifactStore`, `RequestAuditStore`.
- [x] Перевести новые записи на нормализованные таблицы.
- [x] Оставить чтение legacy JSON только как fallback.

## 2. Сделать единый ArtifactStore API

- [x] Ввести `ArtifactStore.put(...)`.
- [x] Ввести `ArtifactStore.getByRequestId(requestId)`.
- [x] Ввести `ArtifactStore.getByMessage(chatId, messageId)`.
- [x] Ввести `ArtifactStore.getLatestRagForReplyChain(chatId, messageId)`.
- [x] Ввести `ArtifactStore.getTranscriptForMessage(chatId, messageId)`.
- [x] Перевести `rag-artifact-store.ts` на `ArtifactStore`.
- [x] Перевести `transcript-artifact-store.ts` на `ArtifactStore`.
- [x] Перевести `final-response-artifact-store.ts` на `ArtifactStore`.
- [x] Перевести `tool-result-artifact-store.ts` на `ArtifactStore`.
- [x] Оставить физические JSON-файлы как storage backend для payload, но регистрировать их в БД.
- [x] Добавить единый size gate для artifact payload до записи файла.
- [x] Добавить cleanup policy для временных/устаревших artifact файлов.

## 3. Расширить RAG artifact content

- [x] Расширить общий тип `RagArtifact`.
- [x] Для Ollama сохранять extracted documents.
- [x] Для Ollama сохранять selected chunks.
- [x] Для Ollama сохранять chunk scores.
- [x] Для Ollama сохранять skipped documents и причины пропуска.
- [x] Для Ollama сохранять embedding model, `topK`, `chunkSize`, `chunkOverlap`, `maxContextChars`.
- [x] Для OpenAI сохранять `vectorStoreIds`.
- [x] Для OpenAI сохранять source file mapping: local attachment -> uploaded/vector store file.
- [x] Для Mistral сохранять `libraryId`.
- [x] Для Mistral сохранять uploaded document ids.
- [x] Для Mistral сохранять source file mapping: local attachment -> Mistral document id.
- [x] Добавить единый `providerState` schema для всех providers.
- [x] Добавить tests на сериализацию `RagArtifact`.
- [x] Добавить tests на то, что internal RAG artifacts не попадают обратно в user document context.

## 4. Вынести provider runners в adapter layer

- [x] Ввести интерфейс `AiProviderAdapter`.
- [x] Методы adapter-а: `mapMessages`, `rankTools`, `callModel`, `extractTextDelta`, `extractToolCalls`, `appendToolResults`, `finalize`.
- [x] Реализовать `OpenAiProviderAdapter`.
- [x] Реализовать `MistralProviderAdapter`.
- [x] Реализовать `OllamaProviderAdapter`.
- [x] Перенести provider-specific tool schema mapping внутрь adapter-ов.
- [x] Перенести provider-specific streaming parsing внутрь adapter-ов.
- [x] Перенести provider-specific tool result append внутрь adapter-ов.
- [x] Упростить `runOpenAi`, `runMistral`, `runOllama` или заменить их adapter-driven runner-ом.
- [x] Оставить compatibility wrappers для текущих imports.
- [x] Добавить tests на adapter contract без реальных API.

## 5. Сделать tool-ranker полноценным pipeline stage

- [x] Вынести вызов `ToolRanker.selectTools(...)` из provider runners.
- [x] Добавить stage `tool_rank`, который работает через provider adapter.
- [x] Добавить stage `filter_tools`, который фильтрует provider-specific tools по результату ranker.
- [x] Хранить `ToolRankDecision` в `UserRequestPipelineState.toolRankDecisions`.
- [x] Сохранять `ToolRankDecision` в `request_audit.details`.
- [x] Убрать дублирующий ручной `tool-rank-audit.ts`, если stage полностью заменит его.
- [x] Сохранить status UX: `🧩 Выбираю подходящие инструменты...`.
- [x] Гарантировать `clearStatus()` после ranker success/failure.
- [x] Добавить fallback через `PipelineFallbackExecutor`: main model, all tools, no tools.
- [x] Добавить tests на fallback ranker policy.

## 6. Сделать model_call и tool_loop физически отдельными stages

- [x] Stage `model_call` должен делать только один model request.
- [x] Stage `model_call` должен возвращать normalized model output.
- [x] Stage `tool_loop` должен решать, есть ли tool calls.
- [x] Stage `tool_loop` должен выполнять tools через общий `executeToolBatch`.
- [x] Stage `tool_loop` должен добавлять tool results в provider adapter.
- [x] Stage `tool_loop` должен управлять max rounds.
- [x] Stage `tool_loop` должен сохранять tool result artifacts.
- [x] Stage `tool_loop` должен уметь завершаться без tools как `skipped`.
- [x] Убрать tool loop из `runOpenAi`.
- [x] Убрать tool loop из `runMistral`.
- [x] Убрать tool loop из `runOllama`.
- [x] Добавить tests на multi-round fake adapter.

## 7. Довести fallback notifications до централизованного UX

- [x] Добавить `PipelineFallbackNotifier`.
- [x] Для `notify_user` отправлять пользователю понятное сообщение.
- [x] Для `continue_without_stage` писать короткий debug/audit без user notification.
- [x] Для `use_alternate_target` логировать исходный и alternate target.
- [x] Для `fail_request` завершать request через единый error path.
- [ ] Добавить локализацию fallback messages.
- [x] Добавить отдельные тексты для RAG failure, STT failure, TTS failure, tool failure.
- [x] Не спамить пользователя несколькими fallback notifications за один request.
- [x] Сохранять fallback notification в `request_audit.details`.

## 8. Улучшить поведение reply-chain с документами

- [ ] Явно описать стратегию merge: current user attachments + reply-chain user attachments.
- [ ] Исключать `scope: internal_artifact` всегда.
- [ ] Исключать `scope: bot_output`, если это не user-provided file.
- [ ] Если пользователь отвечает новым документом на ответ бота с предыдущим документом, использовать оба документа.
- [ ] Если пользователь отвечает текстом на ответ бота, использовать документы из reply-chain.
- [ ] Если пользователь явно говорит "этот файл", приоритет отдавать новому вложению.
- [ ] Если несколько документов, добавлять их имена в prompt/RAG context.
- [ ] Добавить tests на follow-up с новым документом.
- [ ] Добавить tests на follow-up без нового документа.
- [ ] Добавить tests на то, что RAG internal JSON не становится пользовательским документом.

## 9. Интеграционные tests без реальных Telegram/AI API

- [ ] Создать fake `TelegramStreamMessage`.
- [ ] Создать fake provider adapter.
- [ ] Создать fake message store или in-memory DB fixture.
- [ ] Test: oversized input attachment rejected before download.
- [ ] Test: document input creates RAG artifact.
- [ ] Test: voice input creates transcript artifact.
- [ ] Test: final answer creates final_text artifact.
- [ ] Test: thrown error creates error artifact.
- [ ] Test: tool call creates tool_result artifact.
- [ ] Test: generated file creates generated_file artifact.
- [ ] Test: TTS requested creates tts_audio artifact.
- [ ] Test: fallback `continue_without_stage` continues request.
- [ ] Test: fallback `fail_request` stops request.

## 10. Operational cleanup and observability

- [ ] Add retention policy for `data/cache/internal-artifacts`.
- [ ] Add retention policy for stale RAG vector/library provider state.
- [ ] Add command or admin view for recent `ai_requests`.
- [ ] Add command or admin view for request audit by message id.
- [ ] Add command to inspect artifacts for a message.
- [ ] Add log correlation by `requestId` across AI logs, tool logs and DB audit.
- [ ] Add metrics counters: requests, failures, fallbacks, tool calls, RAG runs, TTS runs.
- [ ] Add startup migration logs for `ai_requests`, `attachments`, `artifacts`, `request_audit`.

## Suggested order

- [x] 1. Normalize DB tables: `attachments`, `artifacts`, `request_audit`.
- [ ] 2. Build `ArtifactStore` and migrate current artifact helpers to it.
- [ ] 3. Add fake integration tests for reply-chain documents and artifacts.
- [ ] 4. Introduce provider adapter interface.
- [ ] 5. Move `tool_rank` into pipeline stage.
- [ ] 6. Split `model_call` and `tool_loop` physically.
- [ ] 7. Add centralized fallback user notifications.
