import "dotenv/config";
import {createClient, type Client as LibSqlClient} from "@libsql/client";
import {createHash} from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {Pool, type QueryResultRow} from "pg";
import {deflateRawSync} from "node:zlib";
import {Environment} from "../common/environment";
import {appLogger} from "../logging/logger";
import {logError} from "../util/utils";
import type {BoundaryValue} from "../common/boundary-types";
import type {AiRequestDbRow, ArtifactDbRow, AttachmentDbRow, MessageDbRow, RequestAuditDbRow, UserDbRow} from "./db-types";
import type {StoredAttachment} from "../model/stored-attachment";
import type {StoredMessage} from "../model/stored-message";
import type {StoredUser} from "../model/stored-user";
import {createStoredImageAttachment, uniqueStoredAttachments} from "../common/stored-attachment-utils";
import type {StoredAiRequest} from "../model/stored-ai-request";

export type DatabaseKind = "sqlite" | "postgres";

type DatabaseBackend =
    | {
    kind: "sqlite";
    client: LibSqlClient;
}
    | {
    kind: "postgres";
    pool: Pool;
};

type DbColumnDefinition = {
    name: string;
    sql: string;
};

type ZipEntryInput = {
    fileName: string;
    content: Buffer;
};

type DbValue = string | number | boolean | bigint | null | undefined;

export type DatabaseBackupArtifact = {
    filePath: string;
    fileName: string;
    contentType: string;
    cleanup: () => Promise<void>;
};

export type DatabaseBackupPayload = {
    schemaVersion: number;
    createdAt: string;
    database: {
        kind: DatabaseKind;
        summary: string;
    };
    users: StoredUser[];
    messages: StoredMessage[];
    attachments?: AttachmentDbRow[];
    artifacts?: ArtifactDbRow[];
    requestAudits?: RequestAuditDbRow[];
    aiRequests?: StoredAiRequest[];
};

export type UserSettingsUpdate = Partial<Pick<UserDbRow, "interfaceLanguage" | "aiProvider" | "aiResponseLanguage" | "aiContextSize" | "aiVoiceMode" | "aiImageOutputMode">>;

const USER_COLUMNS: readonly string[] = [
    "id",
    "isBot",
    "firstName",
    "lastName",
    "userName",
    "isPremium",
    "langCode",
    "interfaceLanguage",
    "aiProvider",
    "aiResponseLanguage",
    "aiContextSize",
    "aiVoiceMode",
    "aiImageOutputMode",
];

const MESSAGE_COLUMNS: readonly string[] = [
    "id",
    "chatId",
    "replyToMessageId",
    "fromId",
    "text",
    "quoteText",
    "date",
    "deletedByBotAt",
    "attachments",
    "pipelineAudit",
];

const ATTACHMENT_COLUMNS: readonly string[] = [
    "id",
    "messageChatId",
    "messageId",
    "direction",
    "scope",
    "kind",
    "artifactKind",
    "fileId",
    "fileUniqueId",
    "fileName",
    "mimeType",
    "cachePath",
    "sizeBytes",
    "sha256",
    "metadata",
    "createdAt",
];

const ARTIFACT_COLUMNS: readonly string[] = [
    "id",
    "requestId",
    "messageChatId",
    "messageId",
    "kind",
    "stage",
    "attachmentId",
    "payload",
    "createdAt",
];

const REQUEST_AUDIT_COLUMNS: readonly string[] = [
    "id",
    "requestId",
    "messageChatId",
    "messageId",
    "stage",
    "status",
    "startedAt",
    "finishedAt",
    "durationMs",
    "provider",
    "model",
    "details",
    "error",
];

const AI_REQUEST_COLUMNS: readonly string[] = [
    "requestId",
    "chatId",
    "messageId",
    "responseMessageId",
    "fromId",
    "provider",
    "model",
    "status",
    "startedAt",
    "finishedAt",
    "error",
];

const SCHEMA_VERSION = 7;
const SCHEMA_META_KEY = "database_schema_version";

type LegacyMessageDbRow = MessageDbRow & { photoMaxSizeFilePath: string | null };

export class DatabaseManager {
    private static readonly logger = appLogger.child("database");
    private static readonly CRC32_TABLE = (() => {
        const table = new Uint32Array(256);

        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let j = 0; j < 8; j++) {
                c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
            }
            table[i] = c >>> 0;
        }

        return table;
    })();

    static backend: DatabaseBackend;
    static kind: DatabaseKind = "sqlite";
    static ready: Promise<void> = Promise.resolve();

    static init(): void {
        const startedAt = Date.now();
        const databaseUrl = Environment.DB_PATH;

        DatabaseManager.logger.info("startup.init.start", {
            database: Environment.databaseSummaryText,
        });

        if (/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
            const pool = new Pool({
                connectionString: databaseUrl,
                max: 10,
            });

            DatabaseManager.backend = {
                kind: "postgres",
                pool,
            };
            DatabaseManager.kind = "postgres";
        } else {
            const sqliteFilePath = Environment.DB_FILE_PATH ?? databaseUrl.replace(/^file:/i, "");
            const sqliteDir = path.dirname(sqliteFilePath);
            if (sqliteDir && !fs.existsSync(sqliteDir)) {
                fs.mkdirSync(sqliteDir, {recursive: true});
            }

            const client = createClient({url: databaseUrl});

            DatabaseManager.backend = {
                kind: "sqlite",
                client,
            };
            DatabaseManager.kind = "sqlite";
        }

        DatabaseManager.logger.success("startup.init.done", {
            kind: DatabaseManager.kind,
            duration: `${Date.now() - startedAt}ms`,
        });

        DatabaseManager.ready = DatabaseManager.ensureSchema().catch(error => {
            logError(error);
            throw error;
        });
    }

    static async close(): Promise<void> {
        await DatabaseManager.ready;

        if (DatabaseManager.backend.kind === "postgres") {
            await DatabaseManager.backend.pool.end();
            return;
        }

        DatabaseManager.backend.client.close();
    }

    static async exportBackupArtifact(): Promise<DatabaseBackupArtifact> {
        await DatabaseManager.ready;

        const backup = await DatabaseManager.buildBackupPayload();
        const stamp = DatabaseManager.makeBackupStamp();
        const entries: ZipEntryInput[] = [
            {
                fileName: "database.json",
                content: Buffer.from(JSON.stringify(backup, null, 2), "utf8"),
            },
            {
                fileName: "database.sql",
                content: Buffer.from(DatabaseManager.buildSqlDump(backup), "utf8"),
            },
        ];

        if (DatabaseManager.kind === "sqlite" && Environment.DB_FILE_PATH && fs.existsSync(Environment.DB_FILE_PATH)) {
            entries.push({
                fileName: path.basename(Environment.DB_FILE_PATH),
                content: await fsp.readFile(Environment.DB_FILE_PATH),
            });
        }

        const zipBuffer = DatabaseManager.buildZip(entries);
        return await DatabaseManager.writeTempArtifact(
            `database-backup-${stamp}.zip`,
            zipBuffer,
            "application/zip",
        );
    }

    static async exportBackupArtifacts(): Promise<DatabaseBackupArtifact[]> {
        return [await DatabaseManager.exportBackupArtifact()];
    }

    static async importBackupFromJsonPayload(payload: DatabaseBackupPayload): Promise<{ users: number; messages: number }> {
        await DatabaseManager.ready;

        if (
            payload.schemaVersion !== 1
            && payload.schemaVersion !== 2
            && payload.schemaVersion !== 3
            && payload.schemaVersion !== 4
            && payload.schemaVersion !== 5
            && payload.schemaVersion !== 6
            && payload.schemaVersion !== 7
        ) {
            throw new Error(`Unsupported backup schema version: ${payload.schemaVersion}`);
        }

        if (!Array.isArray(payload.users) || !Array.isArray(payload.messages)) {
            throw new Error("Invalid backup payload structure");
        }

        const users = payload.users.map(DatabaseManager.normalizeImportedUser);
        const messages = payload.messages.map(DatabaseManager.normalizeImportedMessage);
        const attachments = Array.isArray(payload.attachments) ? payload.attachments.map(DatabaseManager.normalizeImportedAttachment) : [];
        const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts.map(DatabaseManager.normalizeImportedArtifact) : [];
        const requestAudits = Array.isArray(payload.requestAudits) ? payload.requestAudits.map(DatabaseManager.normalizeImportedRequestAudit) : [];
        const aiRequests = (payload.aiRequests ?? []).map(DatabaseManager.normalizeImportedAiRequest);
        const persistDerivedTables = !attachments.length && !artifacts.length && !requestAudits.length;

        await DatabaseManager.transaction(async tx => {
            await tx.execute("DELETE FROM \"request_audit\"");
            await tx.execute("DELETE FROM \"artifacts\"");
            await tx.execute("DELETE FROM \"attachments\"");
            await tx.execute("DELETE FROM \"ai_requests\"");
            await tx.execute("DELETE FROM \"messages\"");
            await tx.execute("DELETE FROM \"users\"");

            if (users.length) {
                const {query, params} = DatabaseManager.buildBulkUpsertQuery(
                    "users",
                    USER_COLUMNS,
                    ["id"],
                    users,
                    ["isBot", "firstName", "lastName", "userName", "isPremium", "langCode"],
                );
                await tx.execute(query, params);
            }

            if (messages.length) {
                const {query, params} = DatabaseManager.buildBulkUpsertQuery("messages", MESSAGE_COLUMNS, ["chatId", "id"], messages);
                await tx.execute(query, params);
            }

            if (attachments.length) {
                const {query, params} = DatabaseManager.buildBulkUpsertQuery("attachments", ATTACHMENT_COLUMNS, ["id"], attachments);
                await tx.execute(query, params);
            }

            if (artifacts.length) {
                const {query, params} = DatabaseManager.buildBulkUpsertQuery("artifacts", ARTIFACT_COLUMNS, ["id"], artifacts);
                await tx.execute(query, params);
            }

            if (requestAudits.length) {
                const {query, params} = DatabaseManager.buildBulkUpsertQuery("request_audit", REQUEST_AUDIT_COLUMNS, ["id"], requestAudits);
                await tx.execute(query, params);
            }

            if (aiRequests.length) {
                const {query, params} = DatabaseManager.buildBulkUpsertQuery("ai_requests", AI_REQUEST_COLUMNS, ["requestId"], aiRequests);
                await tx.execute(query, params);
            }

            if (persistDerivedTables) {
                const derivedAttachments = messages.flatMap(message => DatabaseManager.attachmentRowsFromMessageRow(message));
                const derivedArtifacts = messages.flatMap(message => DatabaseManager.artifactRowsFromMessageRow(message));
                const derivedRequestAudits = messages.flatMap(message => DatabaseManager.requestAuditRowsFromMessageRow(message));

                if (derivedAttachments.length) {
                    const {query, params} = DatabaseManager.buildBulkUpsertQuery("attachments", ATTACHMENT_COLUMNS, ["id"], derivedAttachments);
                    await tx.execute(query, params);
                }

                if (derivedArtifacts.length) {
                    const {query, params} = DatabaseManager.buildBulkUpsertQuery("artifacts", ARTIFACT_COLUMNS, ["id"], derivedArtifacts);
                    await tx.execute(query, params);
                }

                if (derivedRequestAudits.length) {
                    const {query, params} = DatabaseManager.buildBulkUpsertQuery("request_audit", REQUEST_AUDIT_COLUMNS, ["id"], derivedRequestAudits);
                    await tx.execute(query, params);
                }
            }
        });

        return {
            users: users.length,
            messages: messages.length,
        };
    }

    static async getAllUsers(): Promise<UserDbRow[]> {
        await DatabaseManager.ready;
        return DatabaseManager.query<UserDbRow>(`
            SELECT
                "id",
                "isBot",
                "firstName",
                "lastName",
                "userName",
                "isPremium",
                "langCode",
                "interfaceLanguage",
                "aiProvider",
                "aiResponseLanguage",
                "aiContextSize",
                "aiVoiceMode",
                "aiImageOutputMode"
            FROM "users"
            ORDER BY "id"
        `);
    }

    static async getUserById(id: number): Promise<UserDbRow | null> {
        await DatabaseManager.ready;
        const rows = await DatabaseManager.query<UserDbRow>(`
            SELECT
                "id",
                "isBot",
                "firstName",
                "lastName",
                "userName",
                "isPremium",
                "langCode",
                "interfaceLanguage",
                "aiProvider",
                "aiResponseLanguage",
                "aiContextSize",
                "aiVoiceMode",
                "aiImageOutputMode"
            FROM "users"
            WHERE "id" = ${DatabaseManager.placeholder(1)}
            LIMIT 1
        `, [id]);

        return rows[0] ?? null;
    }

    static async getUsersByIds(ids: number[]): Promise<UserDbRow[]> {
        await DatabaseManager.ready;
        if (!ids.length) return [];

        const {query, params} = DatabaseManager.buildInQuery(`
            SELECT
                "id",
                "isBot",
                "firstName",
                "lastName",
                "userName",
                "isPremium",
                "langCode",
                "interfaceLanguage",
                "aiProvider",
                "aiResponseLanguage",
                "aiContextSize",
                "aiVoiceMode",
                "aiImageOutputMode"
            FROM "users"
            WHERE "id" IN (__IN__)
            ORDER BY "id"
        `, ids);

        return DatabaseManager.query<UserDbRow>(query, params);
    }

    static async upsertUsers(rows: UserDbRow[]): Promise<void> {
        await DatabaseManager.ready;
        if (!rows.length) return;

        const {query, params} = DatabaseManager.buildBulkUpsertQuery(
            "users",
            USER_COLUMNS,
            ["id"],
            rows,
            ["isBot", "firstName", "lastName", "userName", "isPremium", "langCode"],
        );
        await DatabaseManager.execute(query, params);
    }

    static async updateUserSettings(id: number, settings: UserSettingsUpdate): Promise<void> {
        await DatabaseManager.ready;

        const entries = Object.entries(settings).filter(([, value]) => value !== undefined);
        if (!entries.length) return;

        const assignments: string[] = [];
        const params: DbValue[] = [];
        let index = 1;

        for (const [column, value] of entries) {
            assignments.push(`"${column}" = ${DatabaseManager.placeholder(index++)}`);
            params.push(DatabaseManager.normalizeValue(value));
        }

        params.push(id);
        const query = `
            UPDATE "users"
            SET ${assignments.join(", ")}
            WHERE "id" = ${DatabaseManager.placeholder(index)}
        `;

        await DatabaseManager.execute(query, params);
    }

    static async getAllMessages(): Promise<MessageDbRow[]> {
        await DatabaseManager.ready;
        return DatabaseManager.query<MessageDbRow>(`
            SELECT
                "id",
                "chatId",
                "replyToMessageId",
                "fromId",
                "text",
                "quoteText",
                "date",
                "deletedByBotAt",
                "attachments",
                "pipelineAudit"
            FROM "messages"
            ORDER BY "chatId", "id"
        `);
    }

    static async getMessageById(chatId: number, id: number): Promise<MessageDbRow | null> {
        await DatabaseManager.ready;
        const rows = await DatabaseManager.query<MessageDbRow>(`
            SELECT
                "id",
                "chatId",
                "replyToMessageId",
                "fromId",
                "text",
                "quoteText",
                "date",
                "deletedByBotAt",
                "attachments",
                "pipelineAudit"
            FROM "messages"
            WHERE "chatId" = ${DatabaseManager.placeholder(1)}
              AND "id" = ${DatabaseManager.placeholder(2)}
            LIMIT 1
        `, [chatId, id]);

        return rows[0] ?? null;
    }

    static async getMessagesByIds(chatId: number, ids: number[]): Promise<MessageDbRow[]> {
        await DatabaseManager.ready;
        if (!ids.length) return [];

        const {query, params} = DatabaseManager.buildInQuery(`
            SELECT
                "id",
                "chatId",
                "replyToMessageId",
                "fromId",
                "text",
                "quoteText",
                "date",
                "deletedByBotAt",
                "attachments",
                "pipelineAudit"
            FROM "messages"
            WHERE "chatId" = ${DatabaseManager.placeholder(1)}
              AND "id" IN (__IN__)
            ORDER BY "id"
        `, [chatId, ...ids], 2);

        return DatabaseManager.query<MessageDbRow>(query, params);
    }

    static async upsertMessages(rows: MessageDbRow[], options?: {persistDerivedTables?: boolean}): Promise<void> {
        await DatabaseManager.ready;
        if (!rows.length) return;

        const persistDerivedTables = options?.persistDerivedTables !== false;

        await DatabaseManager.transaction(async tx => {
            const {query, params} = DatabaseManager.buildBulkUpsertQuery("messages", MESSAGE_COLUMNS, ["chatId", "id"], rows);
            await tx.execute(query, params);

            if (!persistDerivedTables) return;

            const uniqueMessageKeys = new Set(rows.map(row => `${row.chatId}:${row.id}`));
            for (const key of uniqueMessageKeys) {
                const [chatId, messageId] = key.split(":").map(value => Number(value));
                await tx.execute(`DELETE FROM "attachments" WHERE "messageChatId" = ${DatabaseManager.placeholder(1)} AND "messageId" = ${DatabaseManager.placeholder(2)}`, [chatId, messageId]);
                await tx.execute(`DELETE FROM "artifacts" WHERE "messageChatId" = ${DatabaseManager.placeholder(1)} AND "messageId" = ${DatabaseManager.placeholder(2)}`, [chatId, messageId]);
                await tx.execute(`DELETE FROM "request_audit" WHERE "messageChatId" = ${DatabaseManager.placeholder(1)} AND "messageId" = ${DatabaseManager.placeholder(2)}`, [chatId, messageId]);
            }

            const attachments = rows.flatMap(message => DatabaseManager.attachmentRowsFromMessageRow(message));
            const artifacts = rows.flatMap(message => DatabaseManager.artifactRowsFromMessageRow(message));
            const requestAudits = rows.flatMap(message => DatabaseManager.requestAuditRowsFromMessageRow(message));

            if (attachments.length) {
                const result = DatabaseManager.buildBulkUpsertQuery("attachments", ATTACHMENT_COLUMNS, ["id"], attachments);
                await tx.execute(result.query, result.params);
            }

            if (artifacts.length) {
                const result = DatabaseManager.buildBulkUpsertQuery("artifacts", ARTIFACT_COLUMNS, ["id"], artifacts);
                await tx.execute(result.query, result.params);
            }

            if (requestAudits.length) {
                const result = DatabaseManager.buildBulkUpsertQuery("request_audit", REQUEST_AUDIT_COLUMNS, ["id"], requestAudits);
                await tx.execute(result.query, result.params);
            }
        });
    }

    static async getAllAiRequests(): Promise<AiRequestDbRow[]> {
        await DatabaseManager.ready;
        return DatabaseManager.query<AiRequestDbRow>(`
            SELECT
                "requestId",
                "chatId",
                "messageId",
                "responseMessageId",
                "fromId",
                "provider",
                "model",
                "status",
                "startedAt",
                "finishedAt",
                "error"
            FROM "ai_requests"
            ORDER BY "startedAt"
        `);
    }

    static async getAiRequestByMessage(chatId: number, messageId: number): Promise<AiRequestDbRow | null> {
        await DatabaseManager.ready;
        const rows = await DatabaseManager.query<AiRequestDbRow>(`
            SELECT
                "requestId",
                "chatId",
                "messageId",
                "responseMessageId",
                "fromId",
                "provider",
                "model",
                "status",
                "startedAt",
                "finishedAt",
                "error"
            FROM "ai_requests"
            WHERE "chatId" = ${DatabaseManager.placeholder(1)}
              AND "messageId" = ${DatabaseManager.placeholder(2)}
            ORDER BY "startedAt" DESC
            LIMIT 1
        `, [chatId, messageId]);

        return rows[0] ?? null;
    }

    static async upsertAiRequests(rows: AiRequestDbRow[]): Promise<void> {
        await DatabaseManager.ready;
        if (!rows.length) return;

        const {query, params} = DatabaseManager.buildBulkUpsertQuery("ai_requests", AI_REQUEST_COLUMNS, ["requestId"], rows);
        await DatabaseManager.execute(query, params);
    }

    static async getAllAttachments(): Promise<AttachmentDbRow[]> {
        await DatabaseManager.ready;
        return DatabaseManager.query<AttachmentDbRow>(`
            SELECT
                "id",
                "messageChatId",
                "messageId",
                "direction",
                "scope",
                "kind",
                "artifactKind",
                "fileId",
                "fileUniqueId",
                "fileName",
                "mimeType",
                "cachePath",
                "sizeBytes",
                "sha256",
                "metadata",
                "createdAt"
            FROM "attachments"
            ORDER BY "messageChatId", "messageId", "createdAt", "id"
        `);
    }

    static async getAttachmentsByMessage(chatId: number, messageId: number): Promise<AttachmentDbRow[]> {
        await DatabaseManager.ready;
        return DatabaseManager.query<AttachmentDbRow>(`
            SELECT
                "id",
                "messageChatId",
                "messageId",
                "direction",
                "scope",
                "kind",
                "artifactKind",
                "fileId",
                "fileUniqueId",
                "fileName",
                "mimeType",
                "cachePath",
                "sizeBytes",
                "sha256",
                "metadata",
                "createdAt"
            FROM "attachments"
            WHERE "messageChatId" = ${DatabaseManager.placeholder(1)}
              AND "messageId" = ${DatabaseManager.placeholder(2)}
            ORDER BY "createdAt", "id"
        `, [chatId, messageId]);
    }

    static async getAllArtifacts(): Promise<ArtifactDbRow[]> {
        await DatabaseManager.ready;
        return DatabaseManager.query<ArtifactDbRow>(`
            SELECT
                "id",
                "requestId",
                "messageChatId",
                "messageId",
                "kind",
                "stage",
                "attachmentId",
                "payload",
                "createdAt"
            FROM "artifacts"
            ORDER BY "messageChatId", "messageId", "createdAt", "id"
        `);
    }

    static async getArtifactsByRequestId(requestId: string): Promise<ArtifactDbRow[]> {
        await DatabaseManager.ready;
        return DatabaseManager.query<ArtifactDbRow>(`
            SELECT
                "id",
                "requestId",
                "messageChatId",
                "messageId",
                "kind",
                "stage",
                "attachmentId",
                "payload",
                "createdAt"
            FROM "artifacts"
            WHERE "requestId" = ${DatabaseManager.placeholder(1)}
            ORDER BY "createdAt", "id"
        `, [requestId]);
    }

    static async getArtifactsByMessage(chatId: number, messageId: number): Promise<ArtifactDbRow[]> {
        await DatabaseManager.ready;
        return DatabaseManager.query<ArtifactDbRow>(`
            SELECT
                "id",
                "requestId",
                "messageChatId",
                "messageId",
                "kind",
                "stage",
                "attachmentId",
                "payload",
                "createdAt"
            FROM "artifacts"
            WHERE "messageChatId" = ${DatabaseManager.placeholder(1)}
              AND "messageId" = ${DatabaseManager.placeholder(2)}
            ORDER BY "createdAt", "id"
        `, [chatId, messageId]);
    }

    static async getAllRequestAudits(): Promise<RequestAuditDbRow[]> {
        await DatabaseManager.ready;
        return DatabaseManager.query<RequestAuditDbRow>(`
            SELECT
                "id",
                "requestId",
                "messageChatId",
                "messageId",
                "stage",
                "status",
                "startedAt",
                "finishedAt",
                "durationMs",
                "provider",
                "model",
                "details",
                "error"
            FROM "request_audit"
            ORDER BY "messageChatId", "messageId", "startedAt", "id"
        `);
    }

    static async getRequestAuditsByMessage(chatId: number, messageId: number): Promise<RequestAuditDbRow[]> {
        await DatabaseManager.ready;
        return DatabaseManager.query<RequestAuditDbRow>(`
            SELECT
                "id",
                "requestId",
                "messageChatId",
                "messageId",
                "stage",
                "status",
                "startedAt",
                "finishedAt",
                "durationMs",
                "provider",
                "model",
                "details",
                "error"
            FROM "request_audit"
            WHERE "messageChatId" = ${DatabaseManager.placeholder(1)}
              AND "messageId" = ${DatabaseManager.placeholder(2)}
            ORDER BY "startedAt", "id"
        `, [chatId, messageId]);
    }

    static async upsertAttachments(rows: AttachmentDbRow[]): Promise<void> {
        await DatabaseManager.ready;
        if (!rows.length) return;

        const {query, params} = DatabaseManager.buildBulkUpsertQuery("attachments", ATTACHMENT_COLUMNS, ["id"], rows);
        await DatabaseManager.execute(query, params);
    }

    static async upsertArtifacts(rows: ArtifactDbRow[]): Promise<void> {
        await DatabaseManager.ready;
        if (!rows.length) return;

        const {query, params} = DatabaseManager.buildBulkUpsertQuery("artifacts", ARTIFACT_COLUMNS, ["id"], rows);
        await DatabaseManager.execute(query, params);
    }

    static async upsertRequestAudits(rows: RequestAuditDbRow[]): Promise<void> {
        await DatabaseManager.ready;
        if (!rows.length) return;

        const {query, params} = DatabaseManager.buildBulkUpsertQuery("request_audit", REQUEST_AUDIT_COLUMNS, ["id"], rows);
        await DatabaseManager.execute(query, params);
    }

    private static async ensureSchema(): Promise<void> {
        const startedAt = Date.now();
        DatabaseManager.logger.info("startup.schema.start", {
            kind: DatabaseManager.kind,
        });

        const measure = async <T>(step: string, task: () => Promise<T>): Promise<T> => {
            const stepStartedAt = Date.now();
            DatabaseManager.logger.debug("startup.schema.step.start", {
                kind: DatabaseManager.kind,
                step,
            });
            try {
                const result = await task();
                DatabaseManager.logger.debug("startup.schema.step.done", {
                    kind: DatabaseManager.kind,
                    step,
                    duration: `${Date.now() - stepStartedAt}ms`,
                });
                return result;
            } catch (error) {
                DatabaseManager.logger.error("startup.schema.step.failed", {
                    kind: DatabaseManager.kind,
                    step,
                    duration: `${Date.now() - stepStartedAt}ms`,
                    error: error instanceof Error ? error : String(error),
                });
                throw error;
            }
        };

        const currentVersion = await measure("getSchemaVersion", () => DatabaseManager.getSchemaVersion());
        if (currentVersion === SCHEMA_VERSION) {
            DatabaseManager.logger.success("startup.schema.done", {
                kind: DatabaseManager.kind,
                schemaVersion: currentVersion,
                duration: `${Date.now() - startedAt}ms`,
                migrated: false,
            });
            return;
        }

        DatabaseManager.logger.warn("startup.schema.migrate", {
            kind: DatabaseManager.kind,
            currentVersion: currentVersion ?? 0,
            targetVersion: SCHEMA_VERSION,
        });

        await measure("ensureUsersTable", () => DatabaseManager.ensureUsersTable());
        await measure("ensureMessagesTable", () => DatabaseManager.ensureMessagesTable());
        await measure("ensureAttachmentsTable", () => DatabaseManager.ensureAttachmentsTable());
        await measure("ensureArtifactsTable", () => DatabaseManager.ensureArtifactsTable());
        await measure("ensureRequestAuditTable", () => DatabaseManager.ensureRequestAuditTable());
        await measure("ensureAiRequestsTable", () => DatabaseManager.ensureAiRequestsTable());
        await measure("migrateLegacyMessagePhotoColumn", () => DatabaseManager.migrateLegacyMessagePhotoColumn());
        await measure("migrateLegacyNormalizedTables", () => DatabaseManager.migrateLegacyNormalizedTables());
        await measure("setSchemaVersion", () => DatabaseManager.setSchemaVersion(SCHEMA_VERSION));

        DatabaseManager.logger.success("startup.schema.done", {
            kind: DatabaseManager.kind,
            schemaVersion: SCHEMA_VERSION,
            duration: `${Date.now() - startedAt}ms`,
            migrated: true,
        });
    }

    private static async buildBackupPayload(): Promise<DatabaseBackupPayload> {
        const [users, messages, attachments, artifacts, requestAudits, aiRequests] = await Promise.all([
            DatabaseManager.getAllUsers(),
            DatabaseManager.getAllMessages(),
            DatabaseManager.getAllAttachments().catch(() => []),
            DatabaseManager.getAllArtifacts().catch(() => []),
            DatabaseManager.getAllRequestAudits().catch(() => []),
            DatabaseManager.getAllAiRequests().catch(() => []),
        ]);

        return {
            schemaVersion: SCHEMA_VERSION,
            createdAt: new Date().toISOString(),
            database: {
                kind: DatabaseManager.kind,
                summary: Environment.databaseSummaryText,
            },
            users: users.map(DatabaseManager.toStoredUser),
            messages: messages.map(DatabaseManager.toStoredMessage),
            attachments,
            artifacts,
            requestAudits,
            aiRequests: aiRequests.map(DatabaseManager.toStoredAiRequest),
        };
    }

    private static async writeTempArtifact(fileName: string, content: string | Buffer, contentType: string): Promise<DatabaseBackupArtifact> {
        const filePath = path.join(os.tmpdir(), `tg-chat-bot-${process.pid}-${Date.now()}-${fileName}`);
        await fsp.writeFile(filePath, content);

        return {
            filePath,
            fileName,
            contentType,
            cleanup: async () => {
                await fsp.unlink(filePath).catch(() => undefined);
            },
        };
    }

    private static buildSqlDump(payload: DatabaseBackupPayload): string {
        const lines: string[] = [
            "-- tg-chat-bot database dump",
            `-- schemaVersion: ${payload.schemaVersion}`,
            `-- createdAt: ${payload.createdAt}`,
            `-- database: ${payload.database.summary}`,
            "",
            "BEGIN TRANSACTION;",
            "",
            "DROP INDEX IF EXISTS \"messages_chatId_id_idx\";",
            "DROP INDEX IF EXISTS \"attachments_messageChatId_messageId_idx\";",
            "DROP INDEX IF EXISTS \"artifacts_requestId_idx\";",
            "DROP INDEX IF EXISTS \"request_audit_requestId_idx\";",
            "DROP INDEX IF EXISTS \"ai_requests_chatId_messageId_idx\";",
            "DROP INDEX IF EXISTS \"ai_requests_status_idx\";",
            "DROP TABLE IF EXISTS \"request_audit\";",
            "DROP TABLE IF EXISTS \"artifacts\";",
            "DROP TABLE IF EXISTS \"attachments\";",
            "DROP TABLE IF EXISTS \"ai_requests\";",
            "DROP TABLE IF EXISTS \"messages\";",
            "DROP TABLE IF EXISTS \"users\";",
            "",
            "CREATE TABLE \"users\"",
            "(",
            "    \"id\" INTEGER PRIMARY KEY NOT NULL,",
            "    \"isBot\" INTEGER NOT NULL,",
            "    \"firstName\" TEXT NOT NULL,",
            "    \"lastName\" TEXT,",
            "    \"userName\" TEXT,",
            "    \"isPremium\" INTEGER,",
            "    \"langCode\" TEXT,",
            "    \"interfaceLanguage\" TEXT DEFAULT 'default',",
            "    \"aiProvider\" TEXT,",
            "    \"aiResponseLanguage\" TEXT DEFAULT 'ru',",
            "    \"aiContextSize\" INTEGER,",
            "    \"aiVoiceMode\" TEXT DEFAULT 'execute',",
            "    \"aiImageOutputMode\" TEXT DEFAULT 'photo'",
            ");",
            "",
            "CREATE TABLE \"messages\"",
            "(",
            "    \"id\" INTEGER NOT NULL,",
            "    \"chatId\" INTEGER NOT NULL,",
            "    \"replyToMessageId\" INTEGER,",
            "    \"fromId\" INTEGER NOT NULL,",
            "    \"text\" TEXT,",
            "    \"quoteText\" TEXT,",
            "    \"date\" INTEGER NOT NULL,",
            "    \"deletedByBotAt\" INTEGER,",
            "    \"attachments\" TEXT,",
            "    \"pipelineAudit\" TEXT,",
            "    PRIMARY KEY (\"chatId\", \"id\")",
            ");",
            "",
            "CREATE UNIQUE INDEX \"messages_chatId_id_idx\" ON \"messages\" (\"chatId\", \"id\");",
            "",
            "CREATE TABLE \"attachments\"",
            "(",
            "    \"id\" TEXT PRIMARY KEY NOT NULL,",
            "    \"messageChatId\" INTEGER NOT NULL,",
            "    \"messageId\" INTEGER NOT NULL,",
            "    \"direction\" TEXT NOT NULL,",
            "    \"scope\" TEXT NOT NULL,",
            "    \"kind\" TEXT NOT NULL,",
            "    \"artifactKind\" TEXT,",
            "    \"fileId\" TEXT NOT NULL,",
            "    \"fileUniqueId\" TEXT,",
            "    \"fileName\" TEXT NOT NULL,",
            "    \"mimeType\" TEXT,",
            "    \"cachePath\" TEXT NOT NULL,",
            "    \"sizeBytes\" INTEGER,",
            "    \"sha256\" TEXT,",
            "    \"metadata\" TEXT,",
            "    \"createdAt\" TEXT NOT NULL",
            ");",
            "",
            "CREATE INDEX \"attachments_messageChatId_messageId_idx\" ON \"attachments\" (\"messageChatId\", \"messageId\");",
            "",
            "CREATE TABLE \"artifacts\"",
            "(",
            "    \"id\" TEXT PRIMARY KEY NOT NULL,",
            "    \"requestId\" TEXT NOT NULL,",
            "    \"messageChatId\" INTEGER NOT NULL,",
            "    \"messageId\" INTEGER NOT NULL,",
            "    \"kind\" TEXT NOT NULL,",
            "    \"stage\" TEXT NOT NULL,",
            "    \"attachmentId\" TEXT,",
            "    \"payload\" TEXT NOT NULL,",
            "    \"createdAt\" TEXT NOT NULL",
            ");",
            "",
            "CREATE INDEX \"artifacts_requestId_idx\" ON \"artifacts\" (\"requestId\");",
            "",
            "CREATE TABLE \"request_audit\"",
            "(",
            "    \"id\" TEXT PRIMARY KEY NOT NULL,",
            "    \"requestId\" TEXT NOT NULL,",
            "    \"messageChatId\" INTEGER NOT NULL,",
            "    \"messageId\" INTEGER NOT NULL,",
            "    \"stage\" TEXT NOT NULL,",
            "    \"status\" TEXT NOT NULL,",
            "    \"startedAt\" TEXT,",
            "    \"finishedAt\" TEXT,",
            "    \"durationMs\" INTEGER,",
            "    \"provider\" TEXT,",
            "    \"model\" TEXT,",
            "    \"details\" TEXT,",
            "    \"error\" TEXT",
            ");",
            "",
            "CREATE INDEX \"request_audit_requestId_idx\" ON \"request_audit\" (\"requestId\");",
            "",
            "CREATE TABLE \"ai_requests\"",
            "(",
            "    \"requestId\" TEXT PRIMARY KEY NOT NULL,",
            "    \"chatId\" INTEGER NOT NULL,",
            "    \"messageId\" INTEGER NOT NULL,",
            "    \"responseMessageId\" INTEGER,",
            "    \"fromId\" INTEGER NOT NULL,",
            "    \"provider\" TEXT NOT NULL,",
            "    \"model\" TEXT NOT NULL,",
            "    \"status\" TEXT NOT NULL,",
            "    \"startedAt\" TEXT NOT NULL,",
            "    \"finishedAt\" TEXT,",
            "    \"error\" TEXT",
            ");",
            "",
            "CREATE INDEX \"ai_requests_chatId_messageId_idx\" ON \"ai_requests\" (\"chatId\", \"messageId\");",
            "CREATE INDEX \"ai_requests_status_idx\" ON \"ai_requests\" (\"status\");",
            "",
        ];

        const userRows = payload.users.map(user => {
            return `(${[
                DatabaseManager.sqlLiteral(user.id),
                DatabaseManager.sqlLiteral(user.isBot ? 1 : 0),
                DatabaseManager.sqlLiteral(user.firstName),
                DatabaseManager.sqlLiteral(user.lastName ?? null),
                DatabaseManager.sqlLiteral(user.userName ?? null),
                DatabaseManager.sqlLiteral(user.isPremium === undefined ? null : (user.isPremium ? 1 : 0)),
                DatabaseManager.sqlLiteral(user.langCode ?? null),
                DatabaseManager.sqlLiteral(user.interfaceLanguage ?? "default"),
                DatabaseManager.sqlLiteral(user.aiProvider ?? null),
                DatabaseManager.sqlLiteral(user.aiResponseLanguage ?? "ru"),
                DatabaseManager.sqlLiteral(user.aiContextSize ?? null),
                DatabaseManager.sqlLiteral(user.aiVoiceMode ?? "execute"),
                DatabaseManager.sqlLiteral(user.aiImageOutputMode ?? "photo"),
            ].join(", ")})`;
        });

        if (userRows.length) {
            lines.push(
                "INSERT INTO \"users\" (\"id\", \"isBot\", \"firstName\", \"lastName\", \"userName\", \"isPremium\", \"langCode\", \"interfaceLanguage\", \"aiProvider\", \"aiResponseLanguage\", \"aiContextSize\", \"aiVoiceMode\", \"aiImageOutputMode\") VALUES",
                `${userRows.join(",\n")};`,
                "",
            );
        }

        const messageRows = payload.messages.map(message => {
            return `(${[
                DatabaseManager.sqlLiteral(message.id),
                DatabaseManager.sqlLiteral(message.chatId),
                DatabaseManager.sqlLiteral(message.replyToMessageId ?? null),
                DatabaseManager.sqlLiteral(message.fromId),
                DatabaseManager.sqlLiteral(message.text ?? null),
                DatabaseManager.sqlLiteral(message.quoteText ?? null),
                DatabaseManager.sqlLiteral(message.date),
                DatabaseManager.sqlLiteral(message.deletedByBotAt ?? null),
                DatabaseManager.sqlLiteral(message.attachments?.length ? JSON.stringify(message.attachments) : null),
                DatabaseManager.sqlLiteral(message.pipelineAudit?.length ? JSON.stringify(message.pipelineAudit) : null),
            ].join(", ")})`;
        });

        if (messageRows.length) {
            lines.push(
                "INSERT INTO \"messages\" (\"id\", \"chatId\", \"replyToMessageId\", \"fromId\", \"text\", \"quoteText\", \"date\", \"deletedByBotAt\", \"attachments\", \"pipelineAudit\") VALUES",
                `${messageRows.join(",\n")};`,
                "",
            );
        }

        const attachmentRows = (payload.attachments ?? []).map(attachment => {
            return `(${[
                DatabaseManager.sqlLiteral(attachment.id),
                DatabaseManager.sqlLiteral(attachment.messageChatId),
                DatabaseManager.sqlLiteral(attachment.messageId),
                DatabaseManager.sqlLiteral(attachment.direction),
                DatabaseManager.sqlLiteral(attachment.scope),
                DatabaseManager.sqlLiteral(attachment.kind),
                DatabaseManager.sqlLiteral(attachment.artifactKind ?? null),
                DatabaseManager.sqlLiteral(attachment.fileId),
                DatabaseManager.sqlLiteral(attachment.fileUniqueId ?? null),
                DatabaseManager.sqlLiteral(attachment.fileName),
                DatabaseManager.sqlLiteral(attachment.mimeType ?? null),
                DatabaseManager.sqlLiteral(attachment.cachePath),
                DatabaseManager.sqlLiteral(attachment.sizeBytes ?? null),
                DatabaseManager.sqlLiteral(attachment.sha256 ?? null),
                DatabaseManager.sqlLiteral(attachment.metadata ?? null),
                DatabaseManager.sqlLiteral(attachment.createdAt),
            ].join(", ")})`;
        });

        if (attachmentRows.length) {
            lines.push(
                "INSERT INTO \"attachments\" (\"id\", \"messageChatId\", \"messageId\", \"direction\", \"scope\", \"kind\", \"artifactKind\", \"fileId\", \"fileUniqueId\", \"fileName\", \"mimeType\", \"cachePath\", \"sizeBytes\", \"sha256\", \"metadata\", \"createdAt\") VALUES",
                `${attachmentRows.join(",\n")};`,
                "",
            );
        }

        const artifactRows = (payload.artifacts ?? []).map(artifact => {
            return `(${[
                DatabaseManager.sqlLiteral(artifact.id),
                DatabaseManager.sqlLiteral(artifact.requestId),
                DatabaseManager.sqlLiteral(artifact.messageChatId),
                DatabaseManager.sqlLiteral(artifact.messageId),
                DatabaseManager.sqlLiteral(artifact.kind),
                DatabaseManager.sqlLiteral(artifact.stage),
                DatabaseManager.sqlLiteral(artifact.attachmentId ?? null),
                DatabaseManager.sqlLiteral(artifact.payload),
                DatabaseManager.sqlLiteral(artifact.createdAt),
            ].join(", ")})`;
        });

        if (artifactRows.length) {
            lines.push(
                "INSERT INTO \"artifacts\" (\"id\", \"requestId\", \"messageChatId\", \"messageId\", \"kind\", \"stage\", \"attachmentId\", \"payload\", \"createdAt\") VALUES",
                `${artifactRows.join(",\n")};`,
                "",
            );
        }

        const auditRows = (payload.requestAudits ?? []).map(audit => {
            return `(${[
                DatabaseManager.sqlLiteral(audit.id),
                DatabaseManager.sqlLiteral(audit.requestId),
                DatabaseManager.sqlLiteral(audit.messageChatId),
                DatabaseManager.sqlLiteral(audit.messageId),
                DatabaseManager.sqlLiteral(audit.stage),
                DatabaseManager.sqlLiteral(audit.status),
                DatabaseManager.sqlLiteral(audit.startedAt ?? null),
                DatabaseManager.sqlLiteral(audit.finishedAt ?? null),
                DatabaseManager.sqlLiteral(audit.durationMs ?? null),
                DatabaseManager.sqlLiteral(audit.provider ?? null),
                DatabaseManager.sqlLiteral(audit.model ?? null),
                DatabaseManager.sqlLiteral(audit.details ?? null),
                DatabaseManager.sqlLiteral(audit.error ?? null),
            ].join(", ")})`;
        });

        if (auditRows.length) {
            lines.push(
                "INSERT INTO \"request_audit\" (\"id\", \"requestId\", \"messageChatId\", \"messageId\", \"stage\", \"status\", \"startedAt\", \"finishedAt\", \"durationMs\", \"provider\", \"model\", \"details\", \"error\") VALUES",
                `${auditRows.join(",\n")};`,
                "",
            );
        }

        const aiRequestRows = (payload.aiRequests ?? []).map(request => {
            return `(${[
                DatabaseManager.sqlLiteral(request.requestId),
                DatabaseManager.sqlLiteral(request.chatId),
                DatabaseManager.sqlLiteral(request.messageId),
                DatabaseManager.sqlLiteral(request.responseMessageId ?? null),
                DatabaseManager.sqlLiteral(request.fromId),
                DatabaseManager.sqlLiteral(request.provider),
                DatabaseManager.sqlLiteral(request.model),
                DatabaseManager.sqlLiteral(request.status),
                DatabaseManager.sqlLiteral(request.startedAt),
                DatabaseManager.sqlLiteral(request.finishedAt ?? null),
                DatabaseManager.sqlLiteral(request.error ?? null),
            ].join(", ")})`;
        });

        if (aiRequestRows.length) {
            lines.push(
                "INSERT INTO \"ai_requests\" (\"requestId\", \"chatId\", \"messageId\", \"responseMessageId\", \"fromId\", \"provider\", \"model\", \"status\", \"startedAt\", \"finishedAt\", \"error\") VALUES",
                `${aiRequestRows.join(",\n")};`,
                "",
            );
        }

        lines.push("COMMIT;");
        return lines.join("\n");
    }

    private static async transaction<T>(work: (tx: { execute(query: string, params?: DbValue[]): Promise<void> }) => Promise<T>): Promise<T> {
        if (DatabaseManager.backend.kind === "postgres") {
            const client = await DatabaseManager.backend.pool.connect();
            try {
                await client.query("BEGIN");
                const result = await work({
                    execute: async (query: string, params: DbValue[] = []) => {
                        await client.query(query, params);
                    },
                });
                await client.query("COMMIT");
                return result;
            } catch (error) {
                await client.query("ROLLBACK").catch(() => undefined);
                throw error;
            } finally {
                client.release();
            }
        }

        const backend = DatabaseManager.backend;
        await backend.client.execute("BEGIN");
        try {
            const result = await work({
                execute: async (query: string, params: DbValue[] = []) => {
                    await backend.client.execute(query, params as never);
                },
            });
            await backend.client.execute("COMMIT");
            return result;
        } catch (error) {
            await backend.client.execute("ROLLBACK").catch(() => undefined);
            throw error;
        }
    }

    private static toStoredUser(user: UserDbRow): StoredUser {
        return {
            id: user.id,
            isBot: user.isBot === 1,
            firstName: user.firstName,
            lastName: user.lastName ?? undefined,
            userName: user.userName ?? undefined,
            isPremium: user.isPremium === null ? undefined : user.isPremium === 1,
            langCode: user.langCode ?? undefined,
            interfaceLanguage: user.interfaceLanguage ?? undefined,
            aiProvider: user.aiProvider ?? undefined,
            aiResponseLanguage: user.aiResponseLanguage ?? undefined,
            aiContextSize: user.aiContextSize ?? undefined,
            aiVoiceMode: user.aiVoiceMode ?? undefined,
            aiImageOutputMode: user.aiImageOutputMode ?? undefined,
        };
    }

    private static toStoredMessage(message: MessageDbRow): StoredMessage {
        return {
            chatId: message.chatId,
            id: message.id,
            replyToMessageId: message.replyToMessageId ?? undefined,
            fromId: message.fromId,
            text: message.text ?? undefined,
            quoteText: message.quoteText ?? undefined,
            date: message.date,
            deletedByBotAt: message.deletedByBotAt ?? undefined,
            attachments: DatabaseManager.parseStoredAttachments(message.attachments),
            pipelineAudit: DatabaseManager.parsePipelineAudit(message.pipelineAudit),
        };
    }

    private static toStoredAiRequest(row: AiRequestDbRow): StoredAiRequest {
        return {
            requestId: row.requestId,
            chatId: row.chatId,
            messageId: row.messageId,
            responseMessageId: row.responseMessageId ?? undefined,
            fromId: row.fromId,
            provider: row.provider as StoredAiRequest["provider"],
            model: row.model,
            status: row.status as StoredAiRequest["status"],
            startedAt: row.startedAt,
            finishedAt: row.finishedAt ?? undefined,
            error: row.error ?? undefined,
        };
    }

    private static normalizeImportedUser(user: StoredUser): UserDbRow {
        if (typeof user !== "object" || user === null) {
            throw new Error("Invalid user backup entry");
        }

        return {
            id: DatabaseManager.normalizeInt(user.id, "users.id"),
            isBot: DatabaseManager.normalizeBoolToInt(user.isBot, "users.isBot"),
            firstName: DatabaseManager.normalizeString(user.firstName, "users.firstName"),
            lastName: DatabaseManager.normalizeNullableString(user.lastName, "users.lastName"),
            userName: DatabaseManager.normalizeNullableString(user.userName, "users.userName"),
            isPremium: DatabaseManager.normalizeNullableBoolToInt(user.isPremium, "users.isPremium"),
            langCode: DatabaseManager.normalizeNullableString(user.langCode, "users.langCode"),
            interfaceLanguage: DatabaseManager.normalizeNullableString(user.interfaceLanguage, "users.interfaceLanguage"),
            aiProvider: DatabaseManager.normalizeNullableString(user.aiProvider, "users.aiProvider"),
            aiResponseLanguage: DatabaseManager.normalizeNullableString(user.aiResponseLanguage, "users.aiResponseLanguage"),
            aiContextSize: DatabaseManager.normalizeNullableInt(user.aiContextSize, "users.aiContextSize"),
            aiVoiceMode: DatabaseManager.normalizeNullableString(user.aiVoiceMode, "users.aiVoiceMode"),
            aiImageOutputMode: DatabaseManager.normalizeNullableString(user.aiImageOutputMode, "users.aiImageOutputMode"),
        };
    }

    private static normalizeImportedMessage(message: StoredMessage & { photoMaxSizeFilePath?: string[] | null }): MessageDbRow {
        if (typeof message !== "object" || message === null) {
            throw new Error("Invalid message backup entry");
        }

        return {
            id: DatabaseManager.normalizeInt(message.id, "messages.id"),
            chatId: DatabaseManager.normalizeInt(message.chatId, "messages.chatId"),
            replyToMessageId: DatabaseManager.normalizeNullableInt(message.replyToMessageId, "messages.replyToMessageId"),
            fromId: DatabaseManager.normalizeInt(message.fromId, "messages.fromId"),
            text: DatabaseManager.normalizeNullableString(message.text, "messages.text"),
            quoteText: DatabaseManager.normalizeNullableString(message.quoteText, "messages.quoteText"),
            date: DatabaseManager.normalizeInt(message.date, "messages.date"),
            deletedByBotAt: DatabaseManager.normalizeNullableInt(message.deletedByBotAt, "messages.deletedByBotAt"),
            attachments: DatabaseManager.normalizeAttachments(DatabaseManager.mergeStoredAttachments(
                Array.isArray(message.attachments) ? message.attachments : undefined,
                message.photoMaxSizeFilePath,
            )),
            pipelineAudit: DatabaseManager.normalizePipelineAudit(Array.isArray(message.pipelineAudit) ? message.pipelineAudit : undefined),
        };
    }

    private static normalizeImportedAiRequest(request: StoredAiRequest): AiRequestDbRow {
        if (typeof request !== "object" || request === null) {
            throw new Error("Invalid AI request backup entry");
        }

        return {
            requestId: DatabaseManager.normalizeString(request.requestId, "ai_requests.requestId"),
            chatId: DatabaseManager.normalizeInt(request.chatId, "ai_requests.chatId"),
            messageId: DatabaseManager.normalizeInt(request.messageId, "ai_requests.messageId"),
            responseMessageId: DatabaseManager.normalizeNullableInt(request.responseMessageId, "ai_requests.responseMessageId"),
            fromId: DatabaseManager.normalizeInt(request.fromId, "ai_requests.fromId"),
            provider: DatabaseManager.normalizeString(request.provider, "ai_requests.provider"),
            model: DatabaseManager.normalizeString(request.model, "ai_requests.model"),
            status: DatabaseManager.normalizeString(request.status, "ai_requests.status"),
            startedAt: DatabaseManager.normalizeString(request.startedAt, "ai_requests.startedAt"),
            finishedAt: DatabaseManager.normalizeNullableString(request.finishedAt, "ai_requests.finishedAt"),
            error: DatabaseManager.normalizeNullableString(request.error, "ai_requests.error"),
        };
    }

    private static normalizeImportedAttachment(attachment: AttachmentDbRow): AttachmentDbRow {
        if (typeof attachment !== "object" || attachment === null) {
            throw new Error("Invalid attachment backup entry");
        }

        return {
            id: DatabaseManager.normalizeString(attachment.id, "attachments.id"),
            messageChatId: DatabaseManager.normalizeInt(attachment.messageChatId, "attachments.messageChatId"),
            messageId: DatabaseManager.normalizeInt(attachment.messageId, "attachments.messageId"),
            direction: DatabaseManager.normalizeString(attachment.direction, "attachments.direction"),
            scope: DatabaseManager.normalizeString(attachment.scope, "attachments.scope"),
            kind: DatabaseManager.normalizeString(attachment.kind, "attachments.kind"),
            artifactKind: DatabaseManager.normalizeNullableString(attachment.artifactKind, "attachments.artifactKind"),
            fileId: DatabaseManager.normalizeString(attachment.fileId, "attachments.fileId"),
            fileUniqueId: DatabaseManager.normalizeNullableString(attachment.fileUniqueId, "attachments.fileUniqueId"),
            fileName: DatabaseManager.normalizeString(attachment.fileName, "attachments.fileName"),
            mimeType: DatabaseManager.normalizeNullableString(attachment.mimeType, "attachments.mimeType"),
            cachePath: DatabaseManager.normalizeString(attachment.cachePath, "attachments.cachePath"),
            sizeBytes: DatabaseManager.normalizeNullableInt(attachment.sizeBytes, "attachments.sizeBytes"),
            sha256: DatabaseManager.normalizeNullableString(attachment.sha256, "attachments.sha256"),
            metadata: DatabaseManager.normalizeNullableString(attachment.metadata, "attachments.metadata"),
            createdAt: DatabaseManager.normalizeString(attachment.createdAt, "attachments.createdAt"),
        };
    }

    private static normalizeImportedArtifact(artifact: ArtifactDbRow): ArtifactDbRow {
        if (typeof artifact !== "object" || artifact === null) {
            throw new Error("Invalid artifact backup entry");
        }

        return {
            id: DatabaseManager.normalizeString(artifact.id, "artifacts.id"),
            requestId: DatabaseManager.normalizeString(artifact.requestId, "artifacts.requestId"),
            messageChatId: DatabaseManager.normalizeInt(artifact.messageChatId, "artifacts.messageChatId"),
            messageId: DatabaseManager.normalizeInt(artifact.messageId, "artifacts.messageId"),
            kind: DatabaseManager.normalizeString(artifact.kind, "artifacts.kind"),
            stage: DatabaseManager.normalizeString(artifact.stage, "artifacts.stage"),
            attachmentId: DatabaseManager.normalizeNullableString(artifact.attachmentId, "artifacts.attachmentId"),
            payload: DatabaseManager.normalizeString(artifact.payload, "artifacts.payload"),
            createdAt: DatabaseManager.normalizeString(artifact.createdAt, "artifacts.createdAt"),
        };
    }

    private static normalizeImportedRequestAudit(audit: RequestAuditDbRow): RequestAuditDbRow {
        if (typeof audit !== "object" || audit === null) {
            throw new Error("Invalid request audit backup entry");
        }

        return {
            id: DatabaseManager.normalizeString(audit.id, "request_audit.id"),
            requestId: DatabaseManager.normalizeString(audit.requestId, "request_audit.requestId"),
            messageChatId: DatabaseManager.normalizeInt(audit.messageChatId, "request_audit.messageChatId"),
            messageId: DatabaseManager.normalizeInt(audit.messageId, "request_audit.messageId"),
            stage: DatabaseManager.normalizeString(audit.stage, "request_audit.stage"),
            status: DatabaseManager.normalizeString(audit.status, "request_audit.status"),
            startedAt: DatabaseManager.normalizeNullableString(audit.startedAt, "request_audit.startedAt"),
            finishedAt: DatabaseManager.normalizeNullableString(audit.finishedAt, "request_audit.finishedAt"),
            durationMs: DatabaseManager.normalizeNullableInt(audit.durationMs, "request_audit.durationMs"),
            provider: DatabaseManager.normalizeNullableString(audit.provider, "request_audit.provider"),
            model: DatabaseManager.normalizeNullableString(audit.model, "request_audit.model"),
            details: DatabaseManager.normalizeNullableString(audit.details, "request_audit.details"),
            error: DatabaseManager.normalizeNullableString(audit.error, "request_audit.error"),
        };
    }

    private static attachmentRowsFromMessageRow(message: MessageDbRow): AttachmentDbRow[] {
        const attachments = DatabaseManager.parseStoredAttachments(message.attachments) ?? [];
        const createdAt = new Date(message.date * 1000).toISOString();

        return attachments.map((attachment, ordinal) => DatabaseManager.toAttachmentDbRow({
            messageChatId: message.chatId,
            messageId: message.id,
            attachment,
            direction: attachment.scope === "bot_output" ? "output" : "input",
            createdAt,
            ordinal,
        }));
    }

    private static artifactRowsFromMessageRow(message: MessageDbRow): ArtifactDbRow[] {
        const attachments = DatabaseManager.parseStoredAttachments(message.attachments) ?? [];
        const createdAt = new Date(message.date * 1000).toISOString();
        const requestId = DatabaseManager.requestIdFromMessageRow(message);

        return attachments.flatMap((attachment, ordinal) => {
            if (!attachment.artifactKind) return [];

            const attachmentRow = DatabaseManager.toAttachmentDbRow({
                messageChatId: message.chatId,
                messageId: message.id,
                attachment,
                direction: attachment.scope === "bot_output" ? "output" : "input",
                createdAt,
                ordinal,
            });

            return [DatabaseManager.toArtifactDbRow({
                requestId,
                messageChatId: message.chatId,
                messageId: message.id,
                attachment,
                createdAt,
                attachmentId: attachmentRow.id,
            })];
        });
    }

    private static requestAuditRowsFromMessageRow(message: MessageDbRow): RequestAuditDbRow[] {
        const events = DatabaseManager.parsePipelineAudit(message.pipelineAudit) ?? [];
        const requestId = DatabaseManager.requestIdFromMessageRow(message);

        return events.map((event, ordinal) => DatabaseManager.toRequestAuditDbRow({
            requestId,
            messageChatId: message.chatId,
            messageId: message.id,
            event,
            ordinal,
        }));
    }

    private static toAttachmentDbRow(input: {
        messageChatId: number;
        messageId: number;
        attachment: StoredAttachment;
        direction: string;
        createdAt: string;
        ordinal: number;
    }): AttachmentDbRow {
        const attachment = input.attachment;
        const id = DatabaseManager.hashRowId([
            input.messageChatId,
            input.messageId,
            input.direction,
            attachment.scope ?? "user_input",
            attachment.kind,
            attachment.fileUniqueId ?? attachment.fileId,
            attachment.fileName,
            attachment.cachePath,
            attachment.artifactKind ?? "",
            input.ordinal,
        ]);

        return {
            id,
            messageChatId: input.messageChatId,
            messageId: input.messageId,
            direction: input.direction,
            scope: attachment.scope ?? "user_input",
            kind: attachment.kind,
            artifactKind: attachment.artifactKind ?? null,
            fileId: attachment.fileId,
            fileUniqueId: attachment.fileUniqueId ?? null,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType ?? null,
            cachePath: attachment.cachePath,
            sizeBytes: attachment.sizeBytes ?? null,
            sha256: attachment.sha256 ?? null,
            metadata: attachment.metadata ? JSON.stringify(attachment.metadata) : null,
            createdAt: input.createdAt,
        };
    }

    private static toArtifactDbRow(input: {
        requestId: string;
        messageChatId: number;
        messageId: number;
        attachment: StoredAttachment;
        createdAt: string;
        attachmentId: string | null;
    }): ArtifactDbRow {
        const kind = input.attachment.artifactKind ?? "unknown";
        const payload = {
            kind,
            createdAt: input.createdAt,
            fileName: input.attachment.fileName,
            mimeType: input.attachment.mimeType ?? null,
            cachePath: input.attachment.cachePath,
            sizeBytes: input.attachment.sizeBytes ?? null,
            sha256: input.attachment.sha256 ?? null,
            metadata: input.attachment.metadata ?? null,
            scope: input.attachment.scope ?? null,
        };

        return {
            id: DatabaseManager.hashRowId([
                input.requestId,
                input.messageChatId,
                input.messageId,
                kind,
                input.attachmentId ?? "",
                input.createdAt,
            ]),
            requestId: input.requestId,
            messageChatId: input.messageChatId,
            messageId: input.messageId,
            kind,
            stage: kind,
            attachmentId: input.attachmentId,
            payload: JSON.stringify(payload),
            createdAt: input.createdAt,
        };
    }

    private static toRequestAuditDbRow(input: {
        requestId: string;
        messageChatId: number;
        messageId: number;
        event: NonNullable<StoredMessage["pipelineAudit"]>[number];
        ordinal: number;
    }): RequestAuditDbRow {
        return {
            id: DatabaseManager.hashRowId([
                input.requestId,
                input.messageChatId,
                input.messageId,
                input.event.stage,
                input.event.status,
                input.event.startedAt ?? "",
                input.event.finishedAt ?? "",
                input.ordinal,
            ]),
            requestId: input.requestId,
            messageChatId: input.messageChatId,
            messageId: input.messageId,
            stage: input.event.stage,
            status: input.event.status,
            startedAt: input.event.startedAt ?? null,
            finishedAt: input.event.finishedAt ?? null,
            durationMs: input.event.durationMs ?? null,
            provider: input.event.provider ?? null,
            model: input.event.model ?? null,
            details: input.event.details ? JSON.stringify(input.event.details) : null,
            error: input.event.error ?? null,
        };
    }

    private static requestIdFromMessageRow(message: MessageDbRow): string {
        return `message:${message.chatId}:${message.id}`;
    }

    private static hashRowId(parts: Array<string | number | null | undefined>): string {
        return createHash("sha256").update(parts.map(part => part === null || part === undefined ? "" : String(part)).join("\u0000")).digest("hex");
    }

    private static mergeStoredAttachments(
        attachments: StoredAttachment[] | undefined,
        legacyPhotoIds: string[] | undefined | null,
    ): StoredAttachment[] | null {
        const merged = uniqueStoredAttachments([
            ...(attachments ?? []),
            ...DatabaseManager.legacyPhotoIdsToAttachments(legacyPhotoIds),
        ]);

        return merged.length ? merged : null;
    }

    private static legacyPhotoIdsToAttachments(photoMaxSizeFilePath?: string[] | null): StoredAttachment[] {
        if (!Array.isArray(photoMaxSizeFilePath) || !photoMaxSizeFilePath.length) return [];

        return photoMaxSizeFilePath
            .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
            .map(uniqueId => createStoredImageAttachment({
                fileId: uniqueId,
                fileUniqueId: uniqueId,
            }));
    }

    private static normalizeLegacyMessageRow(message: LegacyMessageDbRow): MessageDbRow {
        return {
            id: DatabaseManager.normalizeInt(message.id, "messages.id"),
            chatId: DatabaseManager.normalizeInt(message.chatId, "messages.chatId"),
            replyToMessageId: DatabaseManager.normalizeNullableInt(message.replyToMessageId, "messages.replyToMessageId"),
            fromId: DatabaseManager.normalizeInt(message.fromId, "messages.fromId"),
            text: DatabaseManager.normalizeNullableString(message.text, "messages.text"),
            quoteText: DatabaseManager.normalizeNullableString(message.quoteText, "messages.quoteText"),
            date: DatabaseManager.normalizeInt(message.date, "messages.date"),
            deletedByBotAt: DatabaseManager.normalizeNullableInt(message.deletedByBotAt, "messages.deletedByBotAt"),
            attachments: DatabaseManager.normalizeAttachments(DatabaseManager.mergeStoredAttachments(
                DatabaseManager.parseStoredAttachments(message.attachments),
                DatabaseManager.legacyPhotoIdsFromColumn(message.photoMaxSizeFilePath),
            )),
            pipelineAudit: null,
        };
    }

    private static legacyPhotoIdsFromColumn(photoMaxSizeFilePath: string | null): string[] | undefined {
        if (!photoMaxSizeFilePath?.trim()) return undefined;
        return photoMaxSizeFilePath
            .split(";")
            .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    }

    private static parseStoredAttachments(value: string | null): StoredAttachment[] | undefined {
        if (!value?.trim()) return undefined;

        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed as StoredAttachment[] : undefined;
        } catch {
            return undefined;
        }
    }

    private static normalizeAttachments(value: StoredAttachment[] | null | undefined): string | null {
        if (!value?.length) return null;
        return JSON.stringify(value);
    }

    private static parsePipelineAudit(value: string | null): StoredMessage["pipelineAudit"] {
        if (!value?.trim()) return undefined;

        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed as StoredMessage["pipelineAudit"] : undefined;
        } catch {
            return undefined;
        }
    }

    private static normalizePipelineAudit(value: StoredMessage["pipelineAudit"]): string | null {
        if (!value?.length) return null;
        return JSON.stringify(value);
    }

    private static normalizeInt(value: BoundaryValue, field: string): number {
        const number = typeof value === "string" ? Number(value) : value;
        if (typeof number !== "number" || !Number.isSafeInteger(number)) {
            throw new Error(`Invalid numeric value for ${field}`);
        }
        return number;
    }

    private static normalizeNullableInt(value: BoundaryValue, field: string): number | null {
        if (value === null || value === undefined || value === "") return null;
        return DatabaseManager.normalizeInt(value, field);
    }

    private static normalizeBoolToInt(value: BoundaryValue, field: string): number {
        if (value === true || value === 1 || value === "1") return 1;
        if (value === false || value === 0 || value === "0") return 0;
        throw new Error(`Invalid boolean value for ${field}`);
    }

    private static normalizeNullableBoolToInt(value: BoundaryValue, field: string): number | null {
        if (value === null || value === undefined) return null;
        return DatabaseManager.normalizeBoolToInt(value, field);
    }

    private static normalizeString(value: BoundaryValue, field: string): string {
        if (typeof value !== "string" || !value.trim()) {
            throw new Error(`Invalid string value for ${field}`);
        }
        return value;
    }

    private static normalizeNullableString(value: BoundaryValue, field: string): string | null {
        if (value === null || value === undefined) return null;
        if (typeof value !== "string") {
            throw new Error(`Invalid string value for ${field}`);
        }
        return value;
    }

    private static sqlLiteral(value: DbValue): string {
        if (value === null || value === undefined) return "NULL";
        if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
        if (typeof value === "boolean") return value ? "1" : "0";
        if (typeof value === "bigint") return value.toString();
        return `'${String(value).replace(/'/g, "''")}'`;
    }

    private static buildZip(entries: ZipEntryInput[]): Buffer {
        const localParts: Buffer[] = [];
        const centralParts: Buffer[] = [];
        let offset = 0;

        for (const entry of entries) {
            const fileName = Buffer.from(entry.fileName, "utf8");
            const compressed = deflateRawSync(entry.content);
            const crc = DatabaseManager.crc32(entry.content);
            const localHeader = Buffer.alloc(30 + fileName.length);

            localHeader.writeUInt32LE(0x04034b50, 0);
            localHeader.writeUInt16LE(20, 4);
            localHeader.writeUInt16LE(0x0800, 6);
            localHeader.writeUInt16LE(8, 8);
            localHeader.writeUInt16LE(0, 10);
            localHeader.writeUInt16LE(0, 12);
            localHeader.writeUInt32LE(crc, 14);
            localHeader.writeUInt32LE(compressed.length, 18);
            localHeader.writeUInt32LE(entry.content.length, 22);
            localHeader.writeUInt16LE(fileName.length, 26);
            localHeader.writeUInt16LE(0, 28);
            fileName.copy(localHeader, 30);

            localParts.push(localHeader, compressed);

            const centralHeader = Buffer.alloc(46 + fileName.length);
            centralHeader.writeUInt32LE(0x02014b50, 0);
            centralHeader.writeUInt16LE(20, 4);
            centralHeader.writeUInt16LE(20, 6);
            centralHeader.writeUInt16LE(0x0800, 8);
            centralHeader.writeUInt16LE(8, 10);
            centralHeader.writeUInt16LE(0, 12);
            centralHeader.writeUInt16LE(0, 14);
            centralHeader.writeUInt32LE(crc, 16);
            centralHeader.writeUInt32LE(compressed.length, 20);
            centralHeader.writeUInt32LE(entry.content.length, 24);
            centralHeader.writeUInt16LE(fileName.length, 28);
            centralHeader.writeUInt16LE(0, 30);
            centralHeader.writeUInt16LE(0, 32);
            centralHeader.writeUInt16LE(0, 34);
            centralHeader.writeUInt16LE(0, 36);
            centralHeader.writeUInt32LE(0, 38);
            centralHeader.writeUInt32LE(offset, 42);
            fileName.copy(centralHeader, 46);

            centralParts.push(centralHeader);
            offset += localHeader.length + compressed.length;
        }

        const centralDirectory = Buffer.concat(centralParts);
        const localData = Buffer.concat(localParts);
        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0);
        end.writeUInt16LE(0, 4);
        end.writeUInt16LE(0, 6);
        end.writeUInt16LE(entries.length, 8);
        end.writeUInt16LE(entries.length, 10);
        end.writeUInt32LE(centralDirectory.length, 12);
        end.writeUInt32LE(localData.length, 16);
        end.writeUInt16LE(0, 20);

        return Buffer.concat([localData, centralDirectory, end]);
    }

    private static crc32(buffer: Buffer): number {
        let crc = 0xffffffff;
        for (const byte of buffer) {
            crc = DatabaseManager.CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
        }
        return (crc ^ 0xffffffff) >>> 0;
    }

    private static makeBackupStamp(): string {
        return new Date().toISOString().replace(/[:.]/g, "-");
    }

    private static async ensureUsersTable(): Promise<void> {
        await DatabaseManager.execute(`
            CREATE TABLE IF NOT EXISTS "users"
            (
                "id" INTEGER PRIMARY KEY NOT NULL,
                "isBot" INTEGER NOT NULL,
                "firstName" TEXT NOT NULL,
                "lastName" TEXT,
                "userName" TEXT,
                "isPremium" INTEGER,
                "langCode" TEXT,
                "interfaceLanguage" TEXT DEFAULT 'default',
                "aiProvider" TEXT,
                "aiResponseLanguage" TEXT DEFAULT 'ru',
                "aiContextSize" INTEGER,
                "aiVoiceMode" TEXT DEFAULT 'execute',
                "aiImageOutputMode" TEXT DEFAULT 'photo'
            )
        `);

        const columns = await DatabaseManager.getTableColumns("users");
        const missingColumns: DbColumnDefinition[] = [
            {name: "langCode", sql: "\"langCode\" TEXT"},
            {name: "aiProvider", sql: "\"aiProvider\" TEXT"},
            {name: "interfaceLanguage", sql: "\"interfaceLanguage\" TEXT DEFAULT 'default'"},
            {name: "aiResponseLanguage", sql: "\"aiResponseLanguage\" TEXT DEFAULT 'ru'"},
            {name: "aiContextSize", sql: "\"aiContextSize\" INTEGER"},
            {name: "aiVoiceMode", sql: "\"aiVoiceMode\" TEXT DEFAULT 'execute'"},
            {name: "aiImageOutputMode", sql: "\"aiImageOutputMode\" TEXT DEFAULT 'photo'"},
        ].filter(column => !columns.has(column.name));

        for (const column of missingColumns) {
            await DatabaseManager.execute(`ALTER TABLE "users" ADD COLUMN ${column.sql}`);
        }
    }

    private static async ensureMessagesTable(): Promise<void> {
        await DatabaseManager.execute(`
            CREATE TABLE IF NOT EXISTS "messages"
            (
                "id" INTEGER NOT NULL,
                "chatId" INTEGER NOT NULL,
                "replyToMessageId" INTEGER,
                "fromId" INTEGER NOT NULL,
                "text" TEXT,
                "quoteText" TEXT,
                "date" INTEGER NOT NULL,
                "deletedByBotAt" INTEGER,
                "attachments" TEXT,
                "pipelineAudit" TEXT,
                PRIMARY KEY ("chatId", "id")
            )
        `);

        const columns = await DatabaseManager.getTableColumns("messages");
        const missingColumns: DbColumnDefinition[] = [
            {name: "quoteText", sql: "\"quoteText\" TEXT"},
            {name: "deletedByBotAt", sql: "\"deletedByBotAt\" INTEGER"},
            {name: "attachments", sql: "\"attachments\" TEXT"},
            {name: "pipelineAudit", sql: "\"pipelineAudit\" TEXT"},
        ].filter(column => !columns.has(column.name));

        for (const column of missingColumns) {
            await DatabaseManager.execute(`ALTER TABLE "messages" ADD COLUMN ${column.sql}`);
        }

        await DatabaseManager.execute(`
            CREATE UNIQUE INDEX IF NOT EXISTS "messages_chatId_id_idx"
            ON "messages" ("chatId", "id")
        `);
    }

    private static async ensureAiRequestsTable(): Promise<void> {
        await DatabaseManager.execute(`
            CREATE TABLE IF NOT EXISTS "ai_requests"
            (
                "requestId" TEXT PRIMARY KEY NOT NULL,
                "chatId" INTEGER NOT NULL,
                "messageId" INTEGER NOT NULL,
                "responseMessageId" INTEGER,
                "fromId" INTEGER NOT NULL,
                "provider" TEXT NOT NULL,
                "model" TEXT NOT NULL,
                "status" TEXT NOT NULL,
                "startedAt" TEXT NOT NULL,
                "finishedAt" TEXT,
                "error" TEXT
            )
        `);

        await DatabaseManager.execute(`
            CREATE INDEX IF NOT EXISTS "ai_requests_chatId_messageId_idx"
            ON "ai_requests" ("chatId", "messageId")
        `);

        await DatabaseManager.execute(`
            CREATE INDEX IF NOT EXISTS "ai_requests_status_idx"
            ON "ai_requests" ("status")
        `);
    }

    private static async ensureAttachmentsTable(): Promise<void> {
        await DatabaseManager.execute(`
            CREATE TABLE IF NOT EXISTS "attachments"
            (
                "id" TEXT PRIMARY KEY NOT NULL,
                "messageChatId" INTEGER NOT NULL,
                "messageId" INTEGER NOT NULL,
                "direction" TEXT NOT NULL,
                "scope" TEXT NOT NULL,
                "kind" TEXT NOT NULL,
                "artifactKind" TEXT,
                "fileId" TEXT NOT NULL,
                "fileUniqueId" TEXT,
                "fileName" TEXT NOT NULL,
                "mimeType" TEXT,
                "cachePath" TEXT NOT NULL,
                "sizeBytes" INTEGER,
                "sha256" TEXT,
                "metadata" TEXT,
                "createdAt" TEXT NOT NULL
            )
        `);

        await DatabaseManager.execute(`
            CREATE INDEX IF NOT EXISTS "attachments_messageChatId_messageId_idx"
            ON "attachments" ("messageChatId", "messageId")
        `);
    }

    private static async ensureArtifactsTable(): Promise<void> {
        await DatabaseManager.execute(`
            CREATE TABLE IF NOT EXISTS "artifacts"
            (
                "id" TEXT PRIMARY KEY NOT NULL,
                "requestId" TEXT NOT NULL,
                "messageChatId" INTEGER NOT NULL,
                "messageId" INTEGER NOT NULL,
                "kind" TEXT NOT NULL,
                "stage" TEXT NOT NULL,
                "attachmentId" TEXT,
                "payload" TEXT NOT NULL,
                "createdAt" TEXT NOT NULL
            )
        `);

        await DatabaseManager.execute(`
            CREATE INDEX IF NOT EXISTS "artifacts_requestId_idx"
            ON "artifacts" ("requestId")
        `);
    }

    private static async ensureRequestAuditTable(): Promise<void> {
        await DatabaseManager.execute(`
            CREATE TABLE IF NOT EXISTS "request_audit"
            (
                "id" TEXT PRIMARY KEY NOT NULL,
                "requestId" TEXT NOT NULL,
                "messageChatId" INTEGER NOT NULL,
                "messageId" INTEGER NOT NULL,
                "stage" TEXT NOT NULL,
                "status" TEXT NOT NULL,
                "startedAt" TEXT,
                "finishedAt" TEXT,
                "durationMs" INTEGER,
                "provider" TEXT,
                "model" TEXT,
                "details" TEXT,
                "error" TEXT
            )
        `);

        await DatabaseManager.execute(`
            CREATE INDEX IF NOT EXISTS "request_audit_requestId_idx"
            ON "request_audit" ("requestId")
        `);
    }

    private static async migrateLegacyMessagePhotoColumn(): Promise<void> {
        const columns = await DatabaseManager.getTableColumns("messages");
        if (!columns.has("photoMaxSizeFilePath")) return;

        const rows = await DatabaseManager.query<LegacyMessageDbRow>(`
            SELECT
                "id",
                "chatId",
                "replyToMessageId",
                "fromId",
                "text",
                "quoteText",
                "date",
                "deletedByBotAt",
                "attachments",
                "pipelineAudit",
                "photoMaxSizeFilePath"
            FROM "messages"
            ORDER BY "chatId", "id"
        `);

        const migratedRows = rows.map(DatabaseManager.normalizeLegacyMessageRow);
        const tempTable = "messages__migrate";

        await DatabaseManager.transaction(async tx => {
            await tx.execute(`DROP TABLE IF EXISTS "${tempTable}"`);
            await tx.execute(`
                CREATE TABLE "${tempTable}"
                (
                    "id" INTEGER NOT NULL,
                    "chatId" INTEGER NOT NULL,
                    "replyToMessageId" INTEGER,
                    "fromId" INTEGER NOT NULL,
                    "text" TEXT,
                    "quoteText" TEXT,
                    "date" INTEGER NOT NULL,
                    "deletedByBotAt" INTEGER,
                    "attachments" TEXT,
                    "pipelineAudit" TEXT,
                    PRIMARY KEY ("chatId", "id")
                )
            `);

            if (migratedRows.length) {
                const {query, params} = DatabaseManager.buildBulkUpsertQuery(
                    tempTable,
                    MESSAGE_COLUMNS,
                    ["chatId", "id"],
                    migratedRows,
                );
                await tx.execute(query, params);
            }

            await tx.execute(`DROP TABLE "messages"`);
            await tx.execute(`ALTER TABLE "${tempTable}" RENAME TO "messages"`);
            await tx.execute(`
                CREATE UNIQUE INDEX IF NOT EXISTS "messages_chatId_id_idx"
                ON "messages" ("chatId", "id")
            `);
        });
    }

    private static async migrateLegacyNormalizedTables(): Promise<void> {
        const messages = await DatabaseManager.getAllMessages();
        const attachments = messages.flatMap(message => DatabaseManager.attachmentRowsFromMessageRow(message));
        const artifacts = messages.flatMap(message => DatabaseManager.artifactRowsFromMessageRow(message));
        const requestAudits = messages.flatMap(message => DatabaseManager.requestAuditRowsFromMessageRow(message));

        await DatabaseManager.transaction(async tx => {
            await tx.execute("DELETE FROM \"request_audit\"");
            await tx.execute("DELETE FROM \"artifacts\"");
            await tx.execute("DELETE FROM \"attachments\"");

            if (attachments.length) {
                const {query, params} = DatabaseManager.buildBulkUpsertQuery("attachments", ATTACHMENT_COLUMNS, ["id"], attachments);
                await tx.execute(query, params);
            }

            if (artifacts.length) {
                const {query, params} = DatabaseManager.buildBulkUpsertQuery("artifacts", ARTIFACT_COLUMNS, ["id"], artifacts);
                await tx.execute(query, params);
            }

            if (requestAudits.length) {
                const {query, params} = DatabaseManager.buildBulkUpsertQuery("request_audit", REQUEST_AUDIT_COLUMNS, ["id"], requestAudits);
                await tx.execute(query, params);
            }
        });
    }

    private static async getSchemaVersion(): Promise<number | null> {
        if (DatabaseManager.backend.kind === "postgres") {
            await DatabaseManager.ensureSchemaMetaTable();
            const rows = await DatabaseManager.query<{value: string | null}>(`
                SELECT "value"
                FROM "schema_meta"
                WHERE "key" = ${DatabaseManager.placeholder(1)}
                LIMIT 1
            `, [SCHEMA_META_KEY]);

            const raw = rows[0]?.value;
            if (!raw?.trim()) return null;

            const parsed = Number(raw);
            return Number.isSafeInteger(parsed) ? parsed : null;
        }

        const rows = await DatabaseManager.query<{user_version: number}>("PRAGMA user_version");
        const raw = rows[0]?.user_version ?? 0;
        return Number.isSafeInteger(raw) ? raw : null;
    }

    private static async setSchemaVersion(version: number): Promise<void> {
        if (DatabaseManager.backend.kind === "postgres") {
            await DatabaseManager.ensureSchemaMetaTable();
            await DatabaseManager.execute(`
                INSERT INTO "schema_meta" ("key", "value")
                VALUES (${DatabaseManager.placeholder(1)}, ${DatabaseManager.placeholder(2)})
                ON CONFLICT ("key")
                DO UPDATE SET "value" = excluded."value"
            `, [SCHEMA_META_KEY, String(version)]);
            return;
        }

        await DatabaseManager.execute(`PRAGMA user_version = ${version}`);
    }

    private static async ensureSchemaMetaTable(): Promise<void> {
        await DatabaseManager.execute(`
            CREATE TABLE IF NOT EXISTS "schema_meta"
            (
                "key" TEXT PRIMARY KEY NOT NULL,
                "value" TEXT NOT NULL
            )
        `);
    }

    private static async getTableColumns(tableName: string): Promise<Set<string>> {
        if (DatabaseManager.backend.kind === "postgres") {
            const rows = await DatabaseManager.query<{column_name: string}>(`
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = ${DatabaseManager.placeholder(1)}
            `, [tableName]);

            return new Set(rows.map(row => row.column_name));
        }

        const rows = await DatabaseManager.query<{name: string}>(`PRAGMA table_info("${tableName}")`);
        return new Set(rows.map(row => row.name));
    }

    private static async query<T extends QueryResultRow>(query: string, params: DbValue[] = []): Promise<T[]> {
        if (DatabaseManager.backend.kind === "postgres") {
            const result = await DatabaseManager.backend.pool.query<T>(query, params);
            return result.rows;
        }

        const result = await DatabaseManager.backend.client.execute(query, params as never);
        const rows: QueryResultRow[] = result.rows as QueryResultRow[];
        return rows.map(row => row as T);
    }

    private static async execute(query: string, params: DbValue[] = []): Promise<void> {
        await DatabaseManager.query(query, params);
    }

    private static normalizeValue(value: DbValue | undefined): DbValue | null {
        return value === undefined ? null : value;
    }

    private static placeholder(index: number): string {
        return DatabaseManager.backend.kind === "postgres" ? `$${index}` : "?";
    }

    private static buildBulkUpsertQuery<T extends Record<string, DbValue | null | undefined>>(
        tableName: string,
        columns: readonly string[],
        conflictColumns: readonly string[],
        rows: readonly T[],
        updateColumns: readonly string[] = columns.filter(column => !conflictColumns.includes(column)),
    ): {query: string; params: DbValue[]} {
        const params: DbValue[] = [];
        const values: string[] = [];
        let index = 1;

        for (const row of rows) {
            const placeholders = columns.map(column => {
                params.push(DatabaseManager.normalizeValue(row[column]));
                return DatabaseManager.placeholder(index++);
            });

            values.push(`(${placeholders.join(", ")})`);
        }

        const updateClause = updateColumns.map(column => `"${column}" = excluded."${column}"`).join(", ");

        return {
            query: `
                INSERT INTO "${tableName}"
                    (${columns.map(column => `"${column}"`).join(", ")})
                VALUES ${values.join(", ")}
                ON CONFLICT (${conflictColumns.map(column => `"${column}"`).join(", ")})
                DO UPDATE SET ${updateClause}
            `,
            params,
        };
    }

    private static buildInQuery(queryTemplate: string, params: DbValue[], inStartIndex = 1): {query: string; params: DbValue[]} {
        const inValues = params.slice(inStartIndex);
        const placeholders = inValues.map((_, index) => DatabaseManager.placeholder(inStartIndex + index));
        return {
            query: queryTemplate.replace("__IN__", placeholders.join(", ")),
            params,
        };
    }
}
