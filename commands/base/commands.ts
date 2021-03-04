import {CREATOR_ID, getExceptionText, includes, MessageContext} from "../../base/base";
import {Command} from "./command";
import {adminsList} from "../../base/db";
import {sendMessage} from "../../base/net";
import {Test} from "../test";
import {Help} from "../help";
import {Ae} from "../ae";
import {Dad} from "../dad";
import {FuckYou} from "../fuckYou";
import {Mom} from "../mom";
import {Mute} from "../mute";
import {Unmute} from "../unmute";
import {Ping} from "../ping";
import {Q} from "../q";
import {RandomString} from "../randomString";
import {SystemSpecs} from "../systemSpecs";

export async function parseCommands(context: MessageContext) {
    try {
        const cmd = searchCommand(context)

        if (!cmd ||
            (cmd.requireChat && !context.isChat()) ||
            (cmd.requireReply && !context.hasRepliedMessage())) return

        if ((cmd.requireCreator && context.senderId != CREATOR_ID) ||
            (cmd.requireAdmin && !includes(adminsList, context.senderId))) {

            await sendMessage(context, 'У вас нет доступа')
            return
        }

        cmd.execute(
            context,
            context.text.match(cmd.regexp),
            context.repliedMessage
        )
    } catch (e) {
        console.log(getExceptionText(e))
    }

    function searchCommand(message, text?: string): Command {
        return commands.find(c => c.regexp.test(message ? message.text : text))
    }
}

let commands: Command[] = [
    new Ae(),
    new Dad(),
    new FuckYou(),
    new Help(),
    new Mom(),
    new Mute(),
    new Unmute(),
    new Ping(),
    new Q(),
    new RandomString(),
    new SystemSpecs(),
    new Test()
]