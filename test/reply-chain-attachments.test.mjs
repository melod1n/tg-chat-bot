import test from "node:test";
import assert from "node:assert/strict";

const {filterUserInputStoredAttachments} = await import("../dist/common/attachment-visibility.js");
const {mergeReplyChainDownloads, shouldPreferCurrentDownloads} = await import("../dist/ai/reply-chain-downloads.js");

test("reply chain attachment visibility keeps only user input attachments", () => {
    const attachments = filterUserInputStoredAttachments([
        {
            kind: "document",
            fileId: "user-doc",
            fileName: "user.txt",
            cachePath: "/tmp/user.txt",
            scope: "user_input",
        },
        {
            kind: "document",
            fileId: "bot-doc",
            fileName: "bot.txt",
            cachePath: "/tmp/bot.txt",
            scope: "bot_output",
        },
        {
            kind: "document",
            fileId: "internal-doc",
            fileName: "internal.json",
            cachePath: "/tmp/internal.json",
            scope: "internal_artifact",
        },
    ]);

    assert.equal(attachments.length, 1);
    assert.equal(attachments[0].fileId, "user-doc");
});

test("reply chain downloads keep current input first and deduplicate chain copies", () => {
    const merged = mergeReplyChainDownloads(
        [
            {
                kind: "document",
                fileId: "new-doc",
                fileName: "new.txt",
                buffer: Buffer.from("new"),
                path: "/tmp/new.txt",
            },
            {
                kind: "document",
                fileId: "shared-doc",
                fileName: "shared.txt",
                buffer: Buffer.from("current"),
                path: "/tmp/current-shared.txt",
            },
        ],
        [
            {
                kind: "document",
                fileId: "shared-doc",
                fileName: "shared.txt",
                buffer: Buffer.from("reply-chain"),
                path: "/tmp/reply-shared.txt",
            },
            {
                kind: "document",
                fileId: "old-doc",
                fileName: "old.txt",
                buffer: Buffer.from("old"),
                path: "/tmp/old.txt",
            },
        ],
    );

    assert.equal(merged.length, 3);
    assert.equal(merged[0].fileId, "new-doc");
    assert.equal(merged[1].fileId, "shared-doc");
    assert.equal(merged[2].fileId, "old-doc");
});

test("reply chain downloads are used when there is no new document", () => {
    const merged = mergeReplyChainDownloads([], [
        {
            kind: "document",
            fileId: "reply-doc",
            fileName: "reply.txt",
            buffer: Buffer.from("reply"),
            path: "/tmp/reply.txt",
        },
    ]);

    assert.equal(merged.length, 1);
    assert.equal(merged[0].fileId, "reply-doc");
});

test("reply chain prefers current downloads when user points to this file", () => {
    assert.equal(
        shouldPreferCurrentDownloads("Please answer about this file", [{
            kind: "document",
            fileId: "new-doc",
            fileName: "new.txt",
            buffer: Buffer.from("new"),
            path: "/tmp/new.txt",
        }]),
        true,
    );

    assert.equal(
        shouldPreferCurrentDownloads("ответь по этому файлу", [{
            kind: "document",
            fileId: "new-doc",
            fileName: "new.txt",
            buffer: Buffer.from("new"),
            path: "/tmp/new.txt",
        }]),
        false,
    );

    assert.equal(
        shouldPreferCurrentDownloads("ответь на этот файл", [{
            kind: "document",
            fileId: "new-doc",
            fileName: "new.txt",
            buffer: Buffer.from("new"),
            path: "/tmp/new.txt",
        }]),
        true,
    );

    assert.equal(
        shouldPreferCurrentDownloads("this file", []),
        false,
    );
});
