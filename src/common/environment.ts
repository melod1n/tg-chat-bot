import path from "node:path";
import {saveData} from "../db/database";

export class Environment {
    static BOT_TOKEN: string;
    static TEST_ENVIRONMENT: boolean;
    static ADMIN_IDS: Set<number> = new Set<number>();
    static CHAT_IDS_WHITELIST: Set<number> = new Set<number>();
    static BOT_PREFIX: string;
    static CREATOR_ID: number;
    static IS_DOCKER: boolean;
    static DATA_PATH: string;
    static DB_FILE_NAME: string = "database.db";
    static DB_PATH: string;

    static USE_MOM: boolean;
    static USE_DAD: boolean;
    static USE_FU: boolean;

    static OLLAMA_MODEL?: string;
    static OLLAMA_ADDRESS?: string;
    static OLLAMA_API_KEY?: string;
    static SYSTEM_PROMPT?: string;

    static GEMINI_API_KEY?: string;

    static waitText = "⏳ Дайте-ка подумать...";

    static load() {
        Environment.BOT_TOKEN = process.env.BOT_TOKEN;
        Environment.TEST_ENVIRONMENT = process.env.TEST_ENVIRONMENT === "true";
        Environment.CHAT_IDS_WHITELIST = new Set(process.env.CHAT_IDS_WHITELIST?.split(",")?.map(e => parseInt(e.trim(), 10)) || []);
        Environment.BOT_PREFIX = process.env.BOT_PREFIX || "";
        Environment.CREATOR_ID = parseInt(process.env.CREATOR_ID || "");
        Environment.IS_DOCKER = process.env.IS_DOCKER == "true";
        Environment.DATA_PATH = Environment.IS_DOCKER ? "/" + path.join("config", "data") : "data";
        Environment.DB_PATH = "file:" + path.join(Environment.DATA_PATH, Environment.DB_FILE_NAME);

        Environment.USE_MOM = process.env.USE_MOM == "true";
        Environment.USE_DAD = process.env.USE_DAD == "true";
        Environment.USE_FU = process.env.USE_FU == "true";

        Environment.OLLAMA_MODEL = process.env.OLLAMA_MODEL;
        Environment.OLLAMA_ADDRESS = process.env.OLLAMA_ADDRESS;
        Environment.OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
        Environment.SYSTEM_PROMPT = process.env.SYSTEM_PROMPT?.trim();

        Environment.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
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
}