import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {fullName, logError, oldSendMessage} from "../util/utils";
import {Environment} from "../common/environment";
import {botUser} from "../index";

export class AdminsRemove extends Command {
    command = "removeAdmin";
    title = Environment.commandTitles.adminsRemove;
    description = Environment.commandDescriptions.adminsRemove;

    requirements = Requirements.Build(
        Requirement.BOT_CREATOR,
        Requirement.REPLY,
        Requirement.CHAT,
    );

    async execute(msg: Message): Promise<void> {
        if (!msg.reply_to_message || !msg.reply_to_message.from) return;

        const id = msg.reply_to_message.from.id;
        const text = fullName(msg.reply_to_message.from);

        if (id === botUser.id) {
            await oldSendMessage(msg, Environment.botCannotRemoveItselfFromAdminsText).catch(logError);
            return;
        }

        if (id === Environment.CREATOR_ID) {
            await oldSendMessage(msg, Environment.botCreatorCannotStopBeingAdminText).catch(logError);
            return;
        }

        if (await Environment.removeAdmin(id)) {
            await oldSendMessage(msg, Environment.getUserNoLongerAdminText(text)).catch(logError);
        } else {
            await oldSendMessage(msg, Environment.getUserWasNotAdminText(text)).catch(logError);
        }
    }
}
