import {StoredUser} from "../model/stored-user";
import {Dao} from "../base/dao";
import {DatabaseManager} from "./database-manager";
import {UserInsert, usersTable} from "./schema";
import {eq} from "drizzle-orm";
import {inArray} from "drizzle-orm/sql/expressions/conditions";
import {User} from "typescript-telegram-bot-api";
import {boolToInt, buildExcludedSet} from "../util/utils";

export class UserDao extends Dao<StoredUser> {

    private tag: string = "UserDao";

    override async getAll(): Promise<StoredUser[]> {
        const then = Date.now();

        const users = await DatabaseManager.db.select().from(usersTable);

        const now = Date.now();
        const diff = now - then;
        console.log(`${this.tag}: getAll()`, `took ${diff}ms; size: ${users.length}`);

        return this.mapFrom(users);
    }

    override async getById(params: { id: number }): Promise<StoredUser | null> {
        const then = Date.now();

        const users =
            await DatabaseManager.db.select()
                .from(usersTable)
                .where(
                    eq(usersTable.id, params.id)
                );

        const now = Date.now();
        const diff = now - then;
        console.log(`${this.tag}: getById(${params.id})`, `took ${diff}ms; size: ${users.length}`);

        const u = users[0];
        if (!u) return null;
        return this.mapFrom([u])[0];
    }

    override async getByIds(params: { ids: number[] }): Promise<StoredUser[]> {
        const then = Date.now();

        const users =
            await DatabaseManager.db.select()
                .from(usersTable)
                .where(
                    inArray(usersTable.id, params.ids)
                );

        const now = Date.now();
        const diff = now - then;
        console.log(`${this.tag}: getByIds(${params.ids})`, `took ${diff}ms; size: ${users.length}`);

        return this.mapFrom(users);
    }

    override async insert(values: UserInsert[] | UserInsert): Promise<true> {
        const rows = Array.isArray(values) ? values : [values];

        const then = Date.now();
        const r = await DatabaseManager.db
            .insert(usersTable)
            .values(rows)
            .onConflictDoUpdate({
                target: usersTable.id,
                set: buildExcludedSet(usersTable, ["id"])
            });

        const now = Date.now();
        const diff = now - then;
        console.log(`${this.tag}: insert(size: ${rows.length})`, `took ${diff}ms; inserted: ${r.rowsAffected}`);
        return true;
    }

    mapTo(users: User[]): UserInsert[] {
        return users.map(u => {
            return {
                id: u.id,
                isBot: boolToInt(u.is_bot),
                firstName: u.first_name,
                lastName: u.last_name,
                userName: u.username,
                isPremium: boolToInt(u.is_premium)
            };
        });
    }

    mapFrom(users: UserInsert[]): StoredUser[] {
        return users.map(u => {
            return {
                id: u.id,
                isBot: u.isBot === 1,
                firstName: u.firstName,
                lastName: u.lastName,
                userName: u.userName,
                isPremium: u.isPremium === 1
            };
        });
    }
}