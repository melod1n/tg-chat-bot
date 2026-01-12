import {int, sqliteTable, text} from "drizzle-orm/sqlite-core";

export const messagesTable = sqliteTable("messages", {
    id: int().primaryKey().unique().notNull(),
    chatId: int().notNull(),
    replyToMessageId: int(),
    fromId: int().notNull(),
    text: text().notNull(),
    date: int().notNull(),
});

export type MessageInsert = typeof messagesTable.$inferInsert;

export const usersTable = sqliteTable("users", {
    id: int().primaryKey().unique().notNull(),
    isBot: int().notNull(),
    firstName: text().notNull(),
    lastName: text(),
    userName: text(),
    isPremium: int(),
});

export type UserInsert = typeof usersTable.$inferInsert;
