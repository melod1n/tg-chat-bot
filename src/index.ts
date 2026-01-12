import "dotenv/config";
import {Environment} from "./common/environment";
import {InlineQueryResult, TelegramBot, User} from "typescript-telegram-bot-api";
import {ChatCommand} from "./base/chat-command";
import {
    checkRequirements,
    executeChatCommand,
    extractTextMessage,
    initSystemSpecs,
    logError,
    randomValue,
    searchChatCommand
} from "./util/utils";
import {Ae} from "./commands/ae";
import {Help} from "./commands/help";
import {Mute} from "./commands/mute";
import {Unmute} from "./commands/unmute";
import {Ping} from "./commands/ping";
import {RandomString} from "./commands/random-string";
import {SystemSpecs} from "./commands/system-specs";
import {Test} from "./commands/test";
import {inviteAnswers, kickAnswers, muted, readData, retrieveAnswers} from "./db/database";
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
import {OllamaKill} from "./commands/ollama-kill";
import {Leave} from "./commands/leave";
import {OllamaChat} from "./commands/ollama-chat";
import {Start} from "./commands/start";
import {MessageStore} from "./common/message-store";
import {PrefixResponse} from "./commands/prefix-response";
import {GoogleGenAI} from "@google/genai";
import {GeminiChat} from "./commands/gemini-chat";
import {Choice} from "./commands/choice";
import {Coin} from "./commands/coin";
import {Qr} from "./commands/qr";
import {Distort} from "./commands/distort";
import {CacheSize} from "./commands/cache-size";
import {CacheClear} from "./commands/cache-clear";
import {Dice} from "./commands/dice";
import {Unban} from "./commands/unban";
import {Title} from "./commands/title";
import {MessageDao} from "./db/message-dao";
import {DatabaseManager} from "./db/database-manager";
import {UserDao} from "./db/user-dao";
import {UserStore} from "./common/user-store";

process.setUncaughtExceptionCaptureCallback(console.error);

Environment.load();
DatabaseManager.init();

export const messageDao = new MessageDao();
export const userDao = new UserDao();

export const bot = new TelegramBot({botToken: Environment.BOT_TOKEN, testEnvironment: Environment.TEST_ENVIRONMENT});
export let botUser: User;

export const ollama = new Ollama({
    host: Environment.OLLAMA_ADDRESS,
    headers: {"Authorization": `Bearer ${Environment.OLLAMA_API_KEY}`}
});

export const googleAi = new GoogleGenAI({apiKey: Environment.GEMINI_API_KEY});

export let systemSpecsText: string = "";

export function setSystemSpecs(systemSpecs: string) {
    systemSpecsText = systemSpecs;
}

export const chatCommands: ChatCommand[] = [
    new Start(),
    new Help(),
    new Test(),
    new Ae(),
    new Mute(),
    new Unmute(),
    new Ping(),
    new RandomInt(),
    new RandomString(),
    new SystemSpecs(),
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

    new AdminsAdd(),
    new AdminsRemove(),

    new Shutdown(),
    new Leave(),

    new OllamaChat(),
    new OllamaSearch(),
    new OllamaPrompt(),
    new OllamaKill(),

    new GeminiChat(),

    new CacheSize(),
    new CacheClear()
];

async function main() {
    console.log(`TEST_ENVIRONMENT: ${Environment.TEST_ENVIRONMENT}\nDATA_PATH: ${Environment.DATA_PATH}`);

    try {
        const messages = await messageDao.getAll();
        const users = await userDao.getAll();
        console.log("Messages: ", messages);
        console.log("Users: ", users);

        const results = await Promise.all(
            [
                initSystemSpecs(), readData(), retrieveAnswers(),
                bot.getMe()
            ]
        );
        botUser = results[3];
        await UserStore.put(botUser);
        await bot.startPolling();

        console.log(`Bot started!`);
    } catch (error) {
        console.error(error);
    }
}

bot.on("my_chat_member", async (u) => {
    console.log("my_chat_member", u);
});

bot.on("message", async (message) => {
    console.log("message", message);

    await UserStore.put(message.from);

    if ((message.new_chat_members?.length || 0 > 0)) {
        await bot.sendMessage({chat_id: message.chat.id, text: randomValue(inviteAnswers)}).catch(logError);
        return;
    }

    if (message.left_chat_member && message.left_chat_member.id !== botUser.id) {
        await bot.sendMessage({chat_id: message.chat.id, text: randomValue(kickAnswers)}).catch(logError);
        return;
    }
});

bot.on("edited_message", async (msg) => {
    console.log("edited_message", msg);

    await UserStore.put(msg.from);

    if (!extractTextMessage(msg) || msg.from.id === botUser.id) return;

    await MessageStore.put(msg);
});

bot.on("message:text", async (msg) => {
    await MessageStore.put(msg);

    if (muted.has(msg.from.id)) return;

    if (msg.forward_origin) return;

    const cmdText = msg.text || msg.caption || "";

    const cmd = searchChatCommand(chatCommands, cmdText);
    const executed = await executeChatCommand(cmd, msg, cmdText);
    if (executed || !cmdText) return;

    const startsWithPrefix = cmdText.toLowerCase().startsWith(Environment.BOT_PREFIX.toLowerCase());
    const messageWithoutPrefix = cmdText.substring(Environment.BOT_PREFIX.length).trim();

    if (startsWithPrefix && messageWithoutPrefix.length === 0) {
        const prefixResponse = new PrefixResponse();
        if (await checkRequirements(prefixResponse, msg)) {
            await prefixResponse.execute(msg);
        }
        return;
    }

    if (!startsWithPrefix && msg.chat.type !== "private") return;
    if (msg.chat.type === "private" && !Environment.ADMIN_IDS.has(msg.chat.id)) return;

    const chat = chatCommands.find(e => e instanceof OllamaChat);
    if (await checkRequirements(chat, msg)) {
        await chat.executeOllama(msg, startsWithPrefix ? messageWithoutPrefix : cmdText);
    }
});

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
            console.error(e);
        }
    } else {
        await bot.answerInlineQuery({
            inline_query_id: query.id,
            results: [],
        }).catch(logError);
    }
});

main().catch(console.error);