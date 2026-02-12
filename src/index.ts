import "dotenv/config";
import {Environment} from "./common/environment";
import {TelegramBot, User} from "typescript-telegram-bot-api";
import {Command} from "./base/command";
import {
    delay,
    ignore,
    initSystemSpecs,
    logError,
    processCallbackQuery,
    processEditedMessage,
    processInlineQuery,
    processMyChatMember,
    processNewMessage
} from "./util/utils";
import {Ae} from "./commands/ae";
import {Help} from "./commands/help";
import {Ignore} from "./commands/ignore";
import {Unignore} from "./commands/unignore";
import {Ping} from "./commands/ping";
import {RandomString} from "./commands/random-string";
import {SystemInfo} from "./commands/system-info";
import {Test} from "./commands/test";
import {readData, retrieveAnswers} from "./db/database";
import {Uptime} from "./commands/uptime";
import {WhatBetter} from "./commands/what-better";
import {When} from "./commands/when";
import {RandomInt} from "./commands/random-int";
import {Ban} from "./commands/ban";
import {Quote} from "./commands/quote";
import {Ollama} from "ollama";
import {OllamaSearch} from "./commands/ollama-search";
import {Id} from "./commands/id";
import {OllamaPrompt} from "./commands/ollama-prompt";
import {AdminsAdd} from "./commands/admins-add";
import {AdminsRemove} from "./commands/admins-remove";
import {Shutdown} from "./commands/shutdown";
import {Leave} from "./commands/leave";
import {OllamaChat} from "./commands/ollama-chat";
import {Start} from "./commands/start";
import {GeminiChat} from "./commands/gemini-chat";
import {Choice} from "./commands/choice";
import {Coin} from "./commands/coin";
import {Qr} from "./commands/qr";
import {Distort} from "./commands/distort";
import {Dice} from "./commands/dice";
import {Unban} from "./commands/unban";
import {Title} from "./commands/title";
import {MessageDao} from "./db/message-dao";
import {DatabaseManager} from "./db/database-manager";
import {UserDao} from "./db/user-dao";
import {UserStore} from "./common/user-store";
import {OllamaRequest} from "./model/ollama-request";
import {CallbackCommand} from "./base/callback-command";
import {OllamaCancel} from "./callback_commands/ollama-cancel";
import {MistralChat} from "./commands/mistral-chat";
import {Transliteration} from "./commands/transliteration";
import {OllamaListModels} from "./commands/ollama-list-models";
import {OllamaGetModel} from "./commands/ollama-get-model";
import {OllamaSetModel} from "./commands/ollama-set-model";
import {Mistral} from "@mistralai/mistralai";
import {GoogleGenAI} from "@google/genai";
import {MistralGetModel} from "./commands/mistral-get-model";
import {MistralSetModel} from "./commands/mistral-set-model";
import {MistralListModels} from "./commands/mistral-list-models";
import {GeminiListModels} from "./commands/gemini-list-models";
import {GeminiGetModel} from "./commands/gemini-get-model";
import {GeminiSetModel} from "./commands/gemini-set-model";
import {Debug} from "./commands/debug";
import {GeminiGenerateImage} from "./commands/gemini-generate-image";
import {YouTubeDownload} from "./commands/youtube-download";
import fs from "node:fs";
import path from "node:path";
import {setInterval} from "node:timers";
import {OpenAI} from "openai";
import {OpenAIChat} from "./commands/openai-chat";
import {OpenAIListModels} from "./commands/openai-list-models";
import {OpenAIGetModel} from "./commands/openai-get-model";
import {OpenAISetModel} from "./commands/openai-set-model";
import {Info} from "./commands/info";
import {OpenAIGenImage} from "./commands/openai-gen-image";
import {clearUpFolderFromOldFiles} from "./util/files";

process.setUncaughtExceptionCaptureCallback(logError);

Environment.load();
DatabaseManager.init();

export const messageDao = new MessageDao();
export const userDao = new UserDao();

export const bot = new TelegramBot({botToken: Environment.BOT_TOKEN, testEnvironment: Environment.TEST_ENVIRONMENT});
export let botUser: User;

export const googleAi = new GoogleGenAI({apiKey: Environment.GEMINI_API_KEY});
export const mistralAi = new Mistral({apiKey: Environment.MISTRAL_API_KEY});
export const openAi = new OpenAI({apiKey: Environment.OPENAI_API_KEY, baseURL: Environment.OPENAI_BASE_URL});

export const ollama = new Ollama({
    host: Environment.OLLAMA_ADDRESS,
    headers: {"Authorization": `Bearer ${Environment.OLLAMA_API_KEY}`}
});

export const ollamaRequests: OllamaRequest[] = [];

export function getOllamaRequest(uuid: string): OllamaRequest | null {
    return ollamaRequests.find(r => r.uuid === uuid);
}

export function updateOllamaRequest(uuid: string, request: OllamaRequest) {
    const index = ollamaRequests.findIndex(r => r.uuid === uuid);
    if (index >= 0) {
        ollamaRequests[index] = request;
    }
}

export function abortOllamaRequest(uuid: string): boolean {
    const request = getOllamaRequest(uuid);
    if (!request || request.done) return false;

    try {
        request.stream.abort();
        updateOllamaRequest(uuid, {...request, done: true});
        return true;
    } catch (e) {
        logError(e);
        return false;
    }
}

export const commands: Command[] = [
    new Start(),
    new Help(),
    new Test(),
    new Ae(),
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

    new AdminsAdd(),
    new AdminsRemove(),

    new Shutdown(),
    new Leave(),

    new YouTubeDownload()
];

export const callbackCommands: CallbackCommand[] = [
    new OllamaCancel()
];

if (Environment.OLLAMA_ADDRESS && Environment.OLLAMA_MODEL && Environment.SYSTEM_PROMPT) {
    commands.push(
        new OllamaChat(),
        new OllamaPrompt(),
        new OllamaListModels(),
        new OllamaGetModel(),
        new OllamaSetModel()
    );
}

if (Environment.OLLAMA_API_KEY) {
    commands.push(new OllamaSearch());
}

if (Environment.GEMINI_API_KEY) {
    commands.push(
        new GeminiChat(),
        new GeminiListModels(),
        new GeminiGetModel(),
        new GeminiSetModel(),
        new GeminiGenerateImage()
    );
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
        new OpenAIGenImage()
    );
}

export const photoDir = path.join(Environment.DATA_PATH, "photo");
export const videoDir = path.join(Environment.DATA_PATH, "video");

let isShuttingDown = false;

async function shutdown(signal: NodeJS.Signals) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`Received ${signal}. Stopping bot polling...`);

    try {
        await bot.stopPolling();
    } catch (error) {
        logError(error);
    } finally {
        process.exit(0);
    }
}

async function main() {
    const start = Date.now();

    console.log(
        `TEST_ENVIRONMENT: ${Environment.TEST_ENVIRONMENT}\n` +
        `DATA_PATH: ${Environment.DATA_PATH}\n` +
        `MAX_PHOTO_SIZE: ${Environment.MAX_PHOTO_SIZE}\n` +
        `ONLY_FOR_CREATOR: ${Environment.ONLY_FOR_CREATOR_MODE}\n` +
        `DEFAULT_AI_PROVIDER: ${Environment.DEFAULT_AI_PROVIDER}`
    );

    fs.mkdir(photoDir, ignore);
    fs.mkdir(videoDir, ignore);

    const now = new Date();

    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    midnight.setDate(now.getDate() + 1);

    const diff = midnight.getTime() - now.getTime();
    console.log("Clearing up videos and photos will be started in " + diff + "ms");

    clearUpFolderFromOldFiles(videoDir);
    clearUpFolderFromOldFiles(photoDir);
    delay(diff).then(() => {
        setInterval(() => {
            console.log("Started clearing up videos and photos");
            clearUpFolderFromOldFiles(videoDir);
            clearUpFolderFromOldFiles(photoDir);
        }, 1000 * 60 * 60 * 24);
    });

    const cmds = commands.filter(cmd => {
        return cmd.title && cmd.title.startsWith("/") && cmd.title.split(" ").length === 1 && cmd.description;
    }).map(cmd => {
        return {
            command: cmd.title.toLowerCase(),
            description: cmd.description,
        };
    });

    try {
        const results = await Promise.all(
            [
                initSystemSpecs(), readData(), retrieveAnswers(),
                bot.getMe(),
                bot.setMyCommands({commands: cmds, scope: {type: "default"}})
            ]
        );
        botUser = results[3];
        await UserStore.put(botUser);
        await bot.startPolling();

        const end = Date.now();
        const diff = Math.abs(end - start);
        console.log(`Bot started in ${diff}ms!`);
    } catch (error) {
        logError(error);
    }
}

bot.on("my_chat_member", processMyChatMember);
bot.on("edited_message", processEditedMessage);
bot.on("message", processNewMessage);
bot.on("inline_query", processInlineQuery);
bot.on("callback_query", processCallbackQuery);

process.on("SIGTERM", () => {
    shutdown("SIGTERM").catch(logError);
});

process.on("SIGINT", () => {
    shutdown("SIGINT").catch(logError);
});

main().catch(logError);