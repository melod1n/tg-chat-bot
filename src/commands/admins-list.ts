import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {Environment} from "../common/environment";
import {escapePlainMarkdownV2, fullName, logError, replyToMessage, sendErrorPlaceholder} from "../util/utils";
import {StoredUser} from "../model/stored-user";
import {UserStore} from "../common/user-store";

export class AdminsList extends Command {

    command = ["adminslist", "admins"];
    argsMode = "none" as const;

    requirements = Requirements.Build(Requirement.BOT_ADMIN);

    async execute(msg: Message): Promise<void> {
        try {
            const adminIds: number[] = [...Environment.ADMIN_IDS];
            const users: (StoredUser | null)[] = [];

            for (let i = 0; i < adminIds.length; i++) {
                const id = adminIds[i];
                const user = await UserStore.get(id);
                if (user) {
                    users.push(user);
                } else {
                    users.push(null);
                }
            }

            let text = Environment.administratorsHeaderText;
            users.forEach(user => {
                text += "\\* ";

                if (user) {
                    text += `[${escapePlainMarkdownV2(fullName(user))}](tg://user?id=${user.id})`;
                } else {
                    text += Environment.noUserInfoText;
                }

                text += "\n";
            });

            await replyToMessage({
                message: msg,
                text: text,
                parse_mode: "MarkdownV2"
            });
        } catch (e) {
            logError(e instanceof Error ? e : String(e));
            await sendErrorPlaceholder(msg).catch(logError);
        }
    }
}
