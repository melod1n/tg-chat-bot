import "dotenv/config";
import {appLogger} from "./logging/logger.js";
import {Environment} from "./common/environment.js";
import {BotCommand, TelegramBot, User} from "typescript-telegram-bot-api";
import {Command} from "./base/command.js";
import type {LogDetails} from "./logging/logger.js";
import {
    initSystemSpecs,
    logError,
    processCallbackQuery,
    processEditedMessage,
    processGuestMessage,
    processInlineQuery,
    processMyChatMember,
    processNewMessage
} from "./util/utils.js";
import {Ae} from "./commands/ae.js";
import {Help} from "./commands/help.js";
import {Ignore} from "./commands/ignore.js";
import {Unignore} from "./commands/unignore.js";
import {Ping} from "./commands/ping.js";
import {RandomString} from "./commands/random-string.js";
import {SystemInfo} from "./commands/system-info.js";
import {Test} from "./commands/test.js";
import {readData, retrieveAnswers} from "./db/database.js";
import {Uptime} from "./commands/uptime.js";
import {WhatBetter} from "./commands/what-better.js";
import {When} from "./commands/when.js";
import {RandomInt} from "./commands/random-int.js";
import {Ban} from "./commands/ban.js";
import {Quote} from "./commands/quote.js";
import {OllamaSearch} from "./commands/ollama-search.js";
import {Id} from "./commands/id.js";
import {AdminsAdd} from "./commands/admins-add.js";
import {AdminsRemove} from "./commands/admins-remove.js";
import {Shutdown} from "./commands/shutdown.js";
import {Leave} from "./commands/leave.js";
import {OllamaChat} from "./commands/ollama-chat.js";
import {Start} from "./commands/start.js";
import {Choice} from "./commands/choice.js";
import {Coin} from "./commands/coin.js";
import {Qr} from "./commands/qr.js";
import {Distort} from "./commands/distort.js";
import {Dice} from "./commands/dice.js";
import {Unban} from "./commands/unban.js";
import {Title} from "./commands/title.js";
import {MessageDao} from "./db/message-dao.js";
import {DatabaseManager} from "./db/database-manager.js";
import {UserDao} from "./db/user-dao.js";
import {UserStore} from "./common/user-store.js";
import {CallbackCommand} from "./base/callback-command.js";
import {AiCancel} from "./callback_commands/ai-cancel.js";
import {AiRegenerate} from "./callback_commands/ai-regenerate.js";
import {MistralChat} from "./commands/mistral-chat.js";
import {Transliteration} from "./commands/transliteration.js";
import {OllamaListModels} from "./commands/ollama-list-models.js";
import {OllamaGetModel} from "./commands/ollama-get-model.js";
import {OllamaSetModel} from "./commands/ollama-set-model.js";
import {MistralGetModel} from "./commands/mistral-get-model.js";
import {MistralSetModel} from "./commands/mistral-set-model.js";
import {MistralListModels} from "./commands/mistral-list-models.js";
import {Debug} from "./commands/debug.js";
import fs from "node:fs";
import path from "node:path";
import {OpenAIChat} from "./commands/openai-chat.js";
import {OpenAIListModels} from "./commands/openai-list-models.js";
import {OpenAIGetModel} from "./commands/openai-get-model.js";
import {OpenAISetModel} from "./commands/openai-set-model.js";
import {Info} from "./commands/info.js";
import {AdminsList} from "./commands/admins-list.js";
import {ExportDb} from "./commands/export-db.js";
import {ImportDb} from "./commands/import-db.js";
import {Settings} from "./commands/settings.js";
import {UserSettingsCallback} from "./callback_commands/user-settings.js";
import {TextToSpeech} from "./commands/text-to-speech.js";
import {SpeechToText} from "./commands/speech-to-text.js";
import {cleanupInternalArtifactCache} from "./ai/internal-artifact-store.js";
import {AIAudit} from "./commands/ai-audit.js";
import {AIMetrics} from "./commands/ai-metrics.js";
import {AIRequests} from "./commands/ai-requests.js";
import {cleanupStaleRagProviderState} from "./ai/rag-retention.js";
import {initializeMcpTools, shutdownMcpTools} from "./ai/mcp/mcp-registry.js";

process.setUncaughtExceptionCaptureCallback(logError);

Environment.load();
DatabaseManager.init();

export const messageDao = new MessageDao();
export const userDao = new UserDao();

export const bot = new TelegramBot({botToken: Environment.BOT_TOKEN, testEnvironment: Environment.TEST_ENVIRONMENT});
export let botUser: User;

export const commands: Command[] = [
    new Start(),
    new Help(),
    new Test(),
    new Ignore(),
    new Unignore(),
    new Ping(),
    new RandomInt(),
    new RandomString(),
    new SystemInfo(),
    new Uptime(),

    new WhatBetter(),
    new When(),

    new Ban(),
    new Unban(),

    new Quote(),
    new Id(),
    new Choice(),
    new Coin(),
    new Qr(),
    new Distort(),
    new Dice(),
    new Title(),
    new Transliteration(),
    new Debug(),
    new Info(),
    new Settings(),
    new TextToSpeech(),
    new SpeechToText(),
    new AIRequests(),
    new AIAudit(),
    new AIMetrics(),

    new AdminsAdd(),
    new AdminsRemove(),
    new AdminsList(),

    new ExportDb(),
    new ImportDb(),

    new Shutdown(),
    new Leave(),
];

if (Environment.ENABLE_UNSAFE_EVAL) {
    commands.push(new Ae());
}

export const callbackCommands: CallbackCommand[] = [
    new AiCancel(),
    new AiRegenerate(),
    new UserSettingsCallback(),
];

if (Environment.OLLAMA_ADDRESS && Environment.OLLAMA_CHAT_MODEL) {
    commands.push(
        new OllamaChat(),
        new OllamaListModels(),
        new OllamaGetModel(),
        new OllamaSetModel()
    );
}

if (Environment.OLLAMA_API_KEY) {
    commands.push(new OllamaSearch());
}

if (Environment.MISTRAL_API_KEY) {
    commands.push(
        new MistralChat(),
        new MistralListModels(),
        new MistralGetModel(),
        new MistralSetModel()
    );
}

if (Environment.OPENAI_API_KEY) {
    commands.push(
        new OpenAIChat(),
        new OpenAIListModels(),
        new OpenAIGetModel(),
        new OpenAISetModel(),
    );
}

export const cacheDir = path.join(Environment.DATA_PATH, "cache");
export const photoDir = path.join(cacheDir, "photo");
export const photoGenDir = path.join(photoDir, "gen");
export const documentDir = path.join(cacheDir, "document");
export const audioDir = path.join(cacheDir, "audio");
export const videoDir = path.join(cacheDir, "video");
export const videoNotesDir = path.join(cacheDir, "video-note");
export const videoTempDir = path.join(videoDir, "temp");

export const filesDir = path.join(Environment.DATA_PATH, "files");

export const NOTES_HEADER = "## Notes\n";
export const notesDir = path.join(Environment.DATA_PATH, "notes");
export const notesRootFile = path.join(notesDir, "index.md");

const logger = appLogger.child("main");

let isShuttingDown = false;

async function measureStartupStep<T>(step: string, task: () => Promise<T> | T, details?: () => LogDetails): Promise<T> {
    const startedAt = Date.now();
    logger.info("startup.step.start", {
        step,
        ...(details?.() ?? {}),
    });

    try {
        const result = await task();
        logger.success("startup.step.done", {
            step,
            duration: `${Date.now() - startedAt}ms`,
            ...(details?.() ?? {}),
        });
        return result;
    } catch (error) {
        logger.error("startup.step.failed", {
            step,
            duration: `${Date.now() - startedAt}ms`,
            ...(details?.() ?? {}),
            error: error instanceof Error ? error : String(error),
        });
        throw error;
    }
}

export async function shutdown(signal: NodeJS.Signals | "manual") {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.warn("shutdown.signal", {signal});

    try {
        await bot.stopPolling();
    } catch (error) {
        logError(error instanceof Error ? error : String(error));
    } finally {
        try {
            await shutdownMcpTools();
        } catch (error) {
            logError(error instanceof Error ? error : String(error));
        } finally {
            try {
                await DatabaseManager.close();
            } catch (error) {
                logError(error instanceof Error ? error : String(error));
            }
            process.exit(0);
        }
    }
}

async function main() {
    const start = Date.now();

    logger.info("startup.begin", {
        testEnvironment: Environment.TEST_ENVIRONMENT,
        isDocker: Environment.IS_DOCKER,
        dataPath: Environment.DATA_PATH,
        database: Environment.databaseSummaryText,
    });

    await measureStartupStep("environment.load", () => Environment.load());
    const dirsToCheck = [cacheDir, photoDir, photoGenDir, documentDir, audioDir, videoDir, videoNotesDir, videoTempDir, notesDir, filesDir];
    await measureStartupStep("prepare_directories", () => {
        const created: string[] = [];
        for (const dir of dirsToCheck) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, {recursive: true});
                created.push(dir);
            }
        }
        return {created};
    }, () => ({directories: dirsToCheck.length}));

    const notesRootFilePath = path.join(notesDir, "index.md");
    await measureStartupStep("prepare_notes_index", () => {
        if (!fs.existsSync(notesRootFilePath)) {
            fs.writeFileSync(notesRootFilePath, "\n" + NOTES_HEADER);
        }

        if (!(fs.readFileSync(notesRootFilePath).toString().includes(NOTES_HEADER))) {
            fs.appendFileSync(notesRootFilePath, "\n" + NOTES_HEADER);
        }
    }, () => ({notesRootFilePath}));

    await measureStartupStep("cleanup_internal_artifacts", () => cleanupInternalArtifactCache(), () => ({retentionDays: 14}));
    await measureStartupStep("cleanup_stale_rag_provider_state", () => cleanupStaleRagProviderState(), () => ({retentionDays: 14}));
    await measureStartupStep("mcp.initialize", () => initializeMcpTools());
    await measureStartupStep("observability.snapshot", async () => {
        const [aiRequests, attachments, artifacts, requestAudits] = await Promise.all([
            DatabaseManager.getAllAiRequests(),
            DatabaseManager.getAllAttachments(),
            DatabaseManager.getAllArtifacts(),
            DatabaseManager.getAllRequestAudits(),
        ]);

        return {
            aiRequests: aiRequests.length,
            attachments: attachments.length,
            artifacts: artifacts.length,
            requestAudits: requestAudits.length,
        };
    }, () => ({tables: ["ai_requests", "attachments", "artifacts", "request_audit"]}));

    const cmds = await measureStartupStep("build_commands", () => commands.filter(cmd => {
        return cmd.title && cmd.title.startsWith("/") && cmd.title.split(" ").length === 1 && cmd.description;
    }).map(cmd => {
        return {
            command: cmd.title?.toLowerCase() || "",
            description: cmd.description,
        };
    }) as BotCommand[], () => ({commands: commands.length}));

    await measureStartupStep("database.ready", () => DatabaseManager.ready, () => ({database: Environment.databaseSummaryText}));

    const [_, __, ___, me] = await measureStartupStep("load_runtime", () => Promise.all(
        [
            measureStartupStep("init_system_specs", () => initSystemSpecs()),
            measureStartupStep("read_data", () => readData()),
            measureStartupStep("retrieve_answers", () => retrieveAnswers()),
            measureStartupStep("bot.getMe", () => bot.getMe()),
            measureStartupStep("bot.setMyCommands", () => bot.setMyCommands({commands: cmds, scope: {type: "default"}})),
        ]
    ));
    botUser = me;
    await measureStartupStep("user_store.put", () => UserStore.put(botUser), () => ({botId: botUser.id}));
    await measureStartupStep("bot.startPolling", () => bot.startPolling(), () => ({botId: botUser.id}));

    const end = Date.now();
    const diff = Math.abs(end - start);
    logger.success("startup.ready", {
        duration: `${diff}ms`,
        commands: cmds.length,
        botId: botUser.id,
        botUsername: botUser.username
    });
}

bot.on("my_chat_member", processMyChatMember);
bot.on("edited_message", processEditedMessage);
bot.on("message", processNewMessage);
bot.on("inline_query", processInlineQuery);
bot.on("callback_query", processCallbackQuery);
bot.on("guest_message", processGuestMessage);

process.on("SIGTERM", () => {
    shutdown("SIGTERM").catch(logError);
});

process.on("SIGINT", () => {
    shutdown("SIGINT").catch(logError);
});

main().catch(error => {
    logError(error);
    process.exit(1);
});
