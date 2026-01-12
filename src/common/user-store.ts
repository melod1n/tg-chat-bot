import {User} from "typescript-telegram-bot-api";
import {userDao} from "../index";
import {StoredUser} from "../model/stored-user";

export class UserStore {
    private static map = new Map<number, StoredUser>();

    static all(): Map<number, StoredUser> {
        return this.map;
    }

    static async put(u: User) {
        const user: StoredUser = {
            id: u.id,
            isBot: u.is_bot,
            firstName: u.first_name,
            lastName: u.last_name,
            userName: u.username,
            isPremium: u.is_premium,
        };

        this.map.set(u.id, user);

        await userDao.insert(userDao.mapTo([u]));
    }

    static async get(id: number): Promise<StoredUser | null> {
        const user = await userDao.getById({id: id});
        if (!user) return null;

        this.map.set(id, user);
        return user;
    }

    static clear() {
        this.map.clear();
    }
}