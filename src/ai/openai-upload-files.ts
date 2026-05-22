import {Message} from "typescript-telegram-bot-api";
import fs from "node:fs";
import path from "node:path";
import {bot} from "../index.js";
import {Environment} from "../common/environment.js";
import {logError} from "../util/utils.js";
import {errorMessage} from "./unified-ai-runner.shared.js";
import {SendFileAttachmentResult, SendFileAttachmentResultSchema} from "./tools/files.js";

export async function tryToUploadFiles(
    msg: Message,
    toolResults: string[]
): Promise<
    | { found: false }
    | { found: true, uploaded: true }
    | { found: boolean, uploaded: false, error: string, toolIndex: number }
> {
    let sendFileAttachment: {
        result: SendFileAttachmentResult & { success: true },
        toolIndex: number
    } | null = null;

    let found = false;

    try {
        for (const [index, toolResult] of toolResults.entries()) {
            const raw = JSON.parse(toolResult);
            const res = SendFileAttachmentResultSchema.safeParse(raw);

            if (res.success) {
                found = true;

                if (res.data.success) {
                    sendFileAttachment = {result: res.data, toolIndex: index};
                }
            }
        }

        if (!found) {
            return {found: false};
        }

        const attachmentRoot = Environment.FILE_TOOLS_ROOT_DIR;
        const attachmentPath = attachmentRoot
            ? path.join(
                attachmentRoot,
                String(msg.from?.id),
                sendFileAttachment?.result?.attachment?.relativePath ?? "",
            )
            : "";

        if (!fs.existsSync(attachmentPath)) {
            throw new Error(`Attachment file does not exist: ${attachmentPath}`);
        }

        await bot.sendDocument({
            chat_id: msg.chat.id,
            reply_parameters: {
                message_id: msg.message_id,
            },
            document: fs.createReadStream(attachmentPath),
        });

        return {found: true, uploaded: true};
    } catch (e) {
        logError(e instanceof Error ? e : String(e));
        return {
            found: found,
            uploaded: false,
            error: errorMessage(e instanceof Error ? e : String(e)),
            toolIndex: sendFileAttachment?.toolIndex ?? -1
        };
    }
}
