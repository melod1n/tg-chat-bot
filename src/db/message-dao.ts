import {messagesTable} from "./schema";
import {DatabaseManager} from "./database-manager";
import {StoredMessage} from "../model/stored-message";
import {and, eq} from "drizzle-orm";
import {inArray} from "drizzle-orm/sql/expressions/conditions";
import {Message} from "typescript-telegram-bot-api";
import {Dao} from "../base/dao";
import {buildExcludedSet} from "../util/utils";

export class MessageDao extends Dao<StoredMessage> {

    private tag: string = "MessageDao";

    override async getAll(): Promise<StoredMessage[]> {
        const then = Date.now();

        const messages = await DatabaseManager.db.select().from(messagesTable);

        const now = Date.now();
        const diff = now - then;
        console.log(`${this.tag}: getAll()`, `took ${diff}ms; size: ${messages.length}`);

        return this.mapFrom(messages);
    }

    override async getById(params: { chatId: number, id: number }): Promise<StoredMessage | null> {
        const then = Date.now();

        const messages =
            await DatabaseManager.db.select()
                .from(messagesTable)
                .where(
                    and(
                        eq(messagesTable.chatId, params.chatId),
                        eq(messagesTable.id, params.id)
                    )
                );

        const now = Date.now();
        const diff = now - then;
        console.log(`${this.tag}: getById(${params.chatId}, ${params.id})`, `took ${diff}ms; size: ${messages.length}`);

        const m = messages[0];
        if (!m) return null;
        return this.mapFrom([m])[0];
    }

    override async getByIds(params: { chatId: number, ids: number[] }): Promise<StoredMessage[]> {
        const then = Date.now();

        const messages =
            await DatabaseManager.db.select()
                .from(messagesTable)
                .where(
                    and(
                        eq(messagesTable.chatId, params.chatId),
                        inArray(messagesTable.id, params.ids)
                    )
                );

        const now = Date.now();
        const diff = now - then;
        console.log(`${this.tag}: getByIds(${params.chatId}, ${params.ids})`, `took ${diff}ms; size: ${messages.length}`);

        return this.mapFrom(messages);
    }

    async insert(values: typeof messagesTable.$inferInsert[]): Promise<true> {
        const then = Date.now();
        const r = await DatabaseManager.db
            .insert(messagesTable)
            .values(values)
            .onConflictDoUpdate({
                target: messagesTable.id,
                set: buildExcludedSet(messagesTable, ["id"])
            });

        const now = Date.now();
        const diff = now - then;
        console.log(`${this.tag}: insert(size: ${values.length})`, `took ${diff}ms'; inserted: ${r.rowsAffected}`);
        return true;
    }

    mapTo(messages: Message[]): typeof messagesTable.$inferInsert[] {
        return messages.map(msg => {
            return {
                chatId: msg.chat.id,
                id: msg.message_id,
                replyToMessageId: msg.reply_to_message?.message_id,
                fromId: msg.from.id,
                text: msg.text,
                date: msg.date,
                firstName: msg.from.first_name,
                lastName: msg.from.last_name,
            };
        });
    }

    mapFrom(messages: typeof messagesTable.$inferInsert[]): StoredMessage[] {
        return messages.map(m => {
            return {
                firstName: m.firstName,
                lastName: m.lastName,
                chatId: m.chatId,
                messageId: m.id,
                replyToMessageId: m.replyToMessageId,
                fromId: m.fromId,
                text: m.text,
                date: m.date
            };
        });
    }
}