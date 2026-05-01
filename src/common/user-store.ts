import {User} from "typescript-telegram-bot-api";
import {userDao} from "../index";
import {StoredUser} from "../model/stored-user";
import {getLruMapValue, setLruMapValue} from "../util/lru-map";

const USER_CACHE_MAX_ENTRIES = 5_000;

export class UserStore {
    private static map = new Map<number, StoredUser>();

    static all(): Map<number, StoredUser> {
        return this.map;
    }

    static async put(u: User): Promise<StoredUser> {
        const current = getLruMapValue(this.map, u.id);
        const user: StoredUser = {
            id: u.id,
            isBot: u.is_bot,
            firstName: u.first_name,
            lastName: u.last_name,
            userName: u.username,
            isPremium: u.is_premium,
            langCode: u.language_code,
            interfaceLanguage: current?.interfaceLanguage,
            aiProvider: current?.aiProvider,
            aiResponseLanguage: current?.aiResponseLanguage,
            aiContextSize: current?.aiContextSize,
            aiVoiceMode: current?.aiVoiceMode,
            aiImageOutputMode: current?.aiImageOutputMode,
        };

        setLruMapValue(this.map, u.id, user, USER_CACHE_MAX_ENTRIES);

        await userDao.insert(userDao.mapTo([u]));
        return user;
    }

    static async updateSettings(
        id: number,
        settings: Partial<Pick<StoredUser, "interfaceLanguage" | "aiProvider" | "aiResponseLanguage" | "aiContextSize" | "aiVoiceMode" | "aiImageOutputMode">>
    ): Promise<StoredUser | null> {
        await userDao.updateSettings(id, settings);
        const user = await userDao.getById({id});
        if (user) setLruMapValue(this.map, id, user, USER_CACHE_MAX_ENTRIES);
        return user;
    }

    static async get(id: number): Promise<StoredUser | null> {
        const user = await userDao.getById({id: id});
        if (!user) return null;

        setLruMapValue(this.map, id, user, USER_CACHE_MAX_ENTRIES);
        return user;
    }

    static clear() {
        this.map.clear();
    }
}
