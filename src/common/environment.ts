import path from "node:path";
import {saveData} from "../db/database";
import {Answers} from "../model/answers";
import {ifTrue} from "../util/utils";

export class Environment {
    static BOT_TOKEN: string;
    static TEST_ENVIRONMENT: boolean;
    static ADMIN_IDS: Set<number> = new Set<number>();
    static MUTED_IDS: Set<number> = new Set<number>();
    static CHAT_IDS_WHITELIST: Set<number> = new Set<number>();
    static BOT_PREFIX: string;
    static CREATOR_ID: number;
    static IS_DOCKER: boolean;
    static DATA_PATH: string;
    static DB_FILE_NAME: string = "database.db";
    static DB_PATH: string;

    static ONLY_FOR_CREATOR_MODE: boolean;

    static ANSWERS: Answers;

    static USE_NAMES_IN_PROMPT: boolean;

    static MAX_PHOTO_SIZE: number;

    static SYSTEM_PROMPT?: string;

    static OLLAMA_ADDRESS?: string;
    static OLLAMA_MODEL?: string;
    static OLLAMA_IMAGE_MODEL?: string;
    static OLLAMA_THINK_MODEL?: string;
    static OLLAMA_API_KEY?: string;

    static GEMINI_API_KEY?: string;
    static GEMINI_MODEL: string;
    static GEMINI_IMAGE_MODEL: string;

    static MISTRAL_API_KEY?: string;
    static MISTRAL_MODEL: string;

    static waitText = "⏳ Дайте-ка подумать...";
    static analyzingPictureText = "🔍 Внимательно изучаю изображение...";
    static analyzingPicturesText = "🔍 Внимательно изучаю изображения...";
    static genImageText = "👨‍🎨 Генерирую изображение...";
    static ollamaCancelledText = "```Ollama\n❌ Отменено```";

    static load() {
        Environment.BOT_TOKEN = process.env.BOT_TOKEN;
        Environment.TEST_ENVIRONMENT = ifTrue(process.env.TEST_ENVIRONMENT);
        Environment.CHAT_IDS_WHITELIST = new Set(process.env.CHAT_IDS_WHITELIST?.split(",")?.map(e => parseInt(e.trim(), 10)) || []);
        Environment.BOT_PREFIX = process.env.BOT_PREFIX || "";
        Environment.CREATOR_ID = parseInt(process.env.CREATOR_ID || "");
        Environment.IS_DOCKER = ifTrue(process.env.IS_DOCKER);
        Environment.DATA_PATH = Environment.IS_DOCKER ? "/" + path.join("config", "data") : "data";
        Environment.DB_PATH = "file:" + path.join(Environment.DATA_PATH, Environment.DB_FILE_NAME);

        Environment.ONLY_FOR_CREATOR_MODE = ifTrue(process.env.ONLY_FOR_CREATOR_MODE);

        Environment.USE_NAMES_IN_PROMPT = ifTrue(process.env.USE_NAMES_IN_PROMPT);

        Environment.MAX_PHOTO_SIZE = Number(process.env.MAX_PHOTO_SIZE || "1280");

        Environment.SYSTEM_PROMPT = process.env.SYSTEM_PROMPT?.trim();

        Environment.OLLAMA_ADDRESS = process.env.OLLAMA_ADDRESS;
        Environment.OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma3:4b";
        Environment.OLLAMA_IMAGE_MODEL = process.env.OLLAMA_IMAGE_MODEL || Environment.OLLAMA_MODEL;
        Environment.OLLAMA_THINK_MODEL = process.env.OLLAMA_THINK_MODEL || Environment.OLLAMA_MODEL;
        Environment.OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;

        Environment.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        Environment.GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
        Environment.GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

        Environment.MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
        Environment.MISTRAL_MODEL = process.env.MISTRAL_MODEL || "mistral-small-latest";
    }

    static setAdmins(admins: Set<number>) {
        this.ADMIN_IDS = admins;
    }

    static async addAdmin(id: number): Promise<boolean> {
        const has = this.ADMIN_IDS.has(id);
        if (!has) {
            this.ADMIN_IDS.add(id);
            await saveData();
        }

        return !has;
    }

    static async removeAdmin(id: number): Promise<boolean> {
        const has = this.ADMIN_IDS.has(id);
        if (has) {
            this.ADMIN_IDS.delete(id);
            await saveData();
        }

        return has;
    }

    static setMuted(muted: Set<number>) {
        this.MUTED_IDS = muted;
    }

    static async addMute(id: number): Promise<boolean> {
        if (this.MUTED_IDS.has(id)) return Promise.resolve(false);

        this.MUTED_IDS.add(id);
        await saveData();
        return Promise.resolve(true);
    }

    static async removeMute(id: number): Promise<boolean> {
        if (!this.MUTED_IDS.has(id)) return Promise.resolve(false);
        this.MUTED_IDS.delete(id);
        await saveData();
        return Promise.resolve(true);
    }

    static setAnswers(answers: Answers) {
        this.ANSWERS = answers;
    }

    static setOllamaModel(newModel: string) {
        Environment.OLLAMA_MODEL = newModel;
    }

    static setGeminiModel(newModel: string) {
        Environment.GEMINI_MODEL = newModel;
    }

    static setMistralModel(newModel: string) {
        Environment.MISTRAL_MODEL = newModel;
    }
}