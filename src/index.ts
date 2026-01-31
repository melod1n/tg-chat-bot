import "dotenv/config";
import {Environment} from "./common/environment";
import {InlineQueryResult, TelegramBot, User} from "typescript-telegram-bot-api";
import {ChatCommand} from "./base/chat-command";
import {
    delay,
    extractTextMessage,
    findAndExecuteCallbackCommand,
    ignore,
    initSystemSpecs,
    logError,
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
import {WebSearchResponse} from "./model/web-search-response";
import {OllamaSearch} from "./commands/ollama-search";
import {Id} from "./commands/id";
import {OllamaPrompt} from "./commands/ollama-prompt";
import {AdminsAdd} from "./commands/admins-add";
import {AdminsRemove} from "./commands/admins-remove";
import {Shutdown} from "./commands/shutdown";
import {Leave} from "./commands/leave";
import {OllamaChat} from "./commands/ollama-chat";
import {Start} from "./commands/start";
import {MessageStore} from "./common/message-store";
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
import {clearUpVideoFolder} from "./util/files";

process.setUncaughtExceptionCaptureCallback(logError);

Environment.load();
DatabaseManager.init();

export const messageDao = new MessageDao();
export const userDao = new UserDao();

export const bot = new TelegramBot({botToken: Environment.BOT_TOKEN, testEnvironment: Environment.TEST_ENVIRONMENT});
export let botUser: User;

export const googleAi = new GoogleGenAI({apiKey: Environment.GEMINI_API_KEY});
export const mistralAi = new Mistral({apiKey: Environment.MISTRAL_API_KEY});

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

export const chatCommands: ChatCommand[] = [
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
    chatCommands.push(
        new OllamaChat(),
        new OllamaPrompt(),
        new OllamaListModels(),
        new OllamaGetModel(),
        new OllamaSetModel()
    );
}

if (Environment.OLLAMA_API_KEY) {
    chatCommands.push(new OllamaSearch());
}

if (Environment.GEMINI_API_KEY) {
    chatCommands.push(
        new GeminiChat(),
        new GeminiListModels(),
        new GeminiGetModel(),
        new GeminiSetModel(),
        new GeminiGenerateImage()
    );
}

if (Environment.MISTRAL_API_KEY) {
    chatCommands.push(
        new MistralChat(),
        new MistralListModels(),
        new MistralGetModel(),
        new MistralSetModel()
    );
}

export const photoDir = path.join(Environment.DATA_PATH, "photo");
export const videoDir = path.join(Environment.DATA_PATH, "video");

async function main() {
    const start = Date.now();

    console.log(
        `TEST_ENVIRONMENT: ${Environment.TEST_ENVIRONMENT}\n` +
        `DATA_PATH: ${Environment.DATA_PATH}\n` +
        `MAX_PHOTO_SIZE: ${Environment.MAX_PHOTO_SIZE}\n` +
        `ONLY_FOR_CREATOR: ${Environment.ONLY_FOR_CREATOR_MODE}`
    );

    fs.mkdir(photoDir, ignore);
    fs.mkdir(videoDir, ignore);

    const now = new Date();

    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    midnight.setDate(now.getDate() + 1);

    const diff = midnight.getTime() - now.getTime();
    console.log("Clearing up videos will be started in " + diff + "ms");

    delay(diff).then(() => {
        setInterval(() => {
            console.log("Started clearing up videos");
            clearUpVideoFolder();
        }, 1000 * 60 * 60 * 24);
    });

    const commands = chatCommands.filter(cmd => {
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
                bot.setMyCommands({commands: commands, scope: {type: "default"}})
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

bot.on("my_chat_member", async (u) => {
    console.log("my_chat_member", u);
});

bot.on("edited_message", async (msg) => {
    console.log("edited_message", msg);

    await UserStore.put(msg.from);

    if (!extractTextMessage(msg) || msg.from.id === botUser.id) return;

    await MessageStore.put(msg);
});

bot.on("message", processNewMessage);

bot.on("inline_query", async (query) => {
    console.log("query", query);

    if (Environment.CREATOR_ID !== query.from.id) {
        await bot.answerInlineQuery({
            inline_query_id: query.id,
            results: [],
            button: {
                text: "No access",
                start_parameter: "nope"
            }
        }).catch(logError);
        return;
    }

    if (query.query.trim().length !== 0) {
        try {
            const queryResults: InlineQueryResult[] = [];
            const results = await ollama.webSearch({query: query.query});

            console.log("results", results);

            results.results.forEach((result, i) => {
                const r = result as WebSearchResponse;
                queryResults.push({
                    type: "article",
                    id: `${i}`,
                    title: `${r.title}`,
                    input_message_content: {
                        message_text: `${r.title}\n\n${r.url}`
                    }
                });
            });

            await bot.answerInlineQuery({
                inline_query_id: query.id,
                results: queryResults,
            });
        } catch (e) {
            logError(e);
        }
    } else {
        await bot.answerInlineQuery({
            inline_query_id: query.id,
            results: [],
        }).catch(logError);
    }
});

bot.on("callback_query", async (query) => {
    console.log(query);
    await findAndExecuteCallbackCommand(callbackCommands, query);
});

main().catch(logError);