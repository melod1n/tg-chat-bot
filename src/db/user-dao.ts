import {StoredUser} from "../model/stored-user";
import {Dao} from "../base/dao";
import {appLogger} from "../logging/logger";
import {DatabaseManager} from "./database-manager";
import {User} from "typescript-telegram-bot-api";
import {boolToInt} from "../util/utils";
import {UserDbRow} from "./db-types";

export class UserDao extends Dao<StoredUser, {id: number}, {ids: number[]}, UserDbRow | UserDbRow[]> {

    private readonly logger = appLogger.child("dao:users");

    override async getAll(): Promise<StoredUser[]> {
        const then = Date.now();

        const users = await DatabaseManager.getAllUsers();

        const now = Date.now();
        const diff = now - then;
        this.logger.trace("get_all", {dao: "users", duration: `${diff}ms`, size: users.length});

        return this.mapFrom(users);
    }

    override async getById(params: { id: number }): Promise<StoredUser | null> {
        const then = Date.now();

        const user = await DatabaseManager.getUserById(params.id);

        const now = Date.now();
        const diff = now - then;
        this.logger.trace("get_by_id", {dao: "users", id: params.id, duration: `${diff}ms`, size: user ? 1 : 0});

        if (!user) return null;
        return this.mapFrom([user])[0];
    }

    override async getByIds(params: { ids: number[] }): Promise<StoredUser[]> {
        const then = Date.now();

        const users = await DatabaseManager.getUsersByIds(params.ids);

        const now = Date.now();
        const diff = now - then;
        this.logger.trace("get_by_ids", {dao: "users", ids: params.ids, duration: `${diff}ms`, size: users.length});

        return this.mapFrom(users);
    }

    override async insert(values: UserDbRow[] | UserDbRow): Promise<true> {
        const rows = Array.isArray(values) ? values : [values];
        if (!rows.length) return true;

        const then = Date.now();
        await DatabaseManager.upsertUsers(rows);

        const now = Date.now();
        const diff = now - then;
        this.logger.debug("insert", {dao: "users", duration: `${diff}ms`, size: rows.length});
        return true;
    }

    async updateSettings(
        id: number,
        settings: Partial<Pick<StoredUser, "interfaceLanguage" | "aiProvider" | "aiResponseLanguage" | "aiContextSize" | "aiVoiceMode" | "aiImageOutputMode">>
    ): Promise<true> {
        await DatabaseManager.updateUserSettings(id, settings);

        return true;
    }

    mapTo(users: User[]): UserDbRow[] {
        return users.map(u => {
            return {
                id: u.id,
                isBot: boolToInt(u.is_bot),
                firstName: u.first_name,
                lastName: u.last_name ?? null,
                userName: u.username ?? null,
                isPremium: boolToInt(u.is_premium),
                langCode: u.language_code ?? null,
                interfaceLanguage: null,
                aiProvider: null,
                aiResponseLanguage: null,
                aiContextSize: null,
                aiVoiceMode: null,
                aiImageOutputMode: null,
            };
        });
    }

    mapFrom(users: UserDbRow[]): StoredUser[] {
        return users.map(u => {
            return {
                id: u.id,
                isBot: u.isBot === 1,
                firstName: u.firstName,
                lastName: u.lastName === null ? undefined : u.lastName,
                userName: u.userName === null ? undefined : u.userName,
                isPremium: u.isPremium === 1,
                langCode: u.langCode === null ? undefined : u.langCode,
                interfaceLanguage: u.interfaceLanguage === null ? undefined : u.interfaceLanguage,
                aiProvider: u.aiProvider === null ? undefined : u.aiProvider,
                aiResponseLanguage: u.aiResponseLanguage === null ? undefined : u.aiResponseLanguage,
                aiContextSize: u.aiContextSize === null ? undefined : u.aiContextSize,
                aiVoiceMode: u.aiVoiceMode === null ? undefined : u.aiVoiceMode,
                aiImageOutputMode: u.aiImageOutputMode === null ? undefined : u.aiImageOutputMode,
            };
        });
    }
}
