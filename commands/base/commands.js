"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const base_1 = require("../../base/base");
const db_1 = require("../../base/db");
const net_1 = require("../../base/net");
const test_1 = require("../test");
const help_1 = require("../help");
const ae_1 = require("../ae");
const dad_1 = require("../dad");
const fuckYou_1 = require("../fuckYou");
const mom_1 = require("../mom");
const mute_1 = require("../mute");
const unmute_1 = require("../unmute");
const ping_1 = require("../ping");
const q_1 = require("../q");
const randomString_1 = require("../randomString");
const systemSpecs_1 = require("../systemSpecs");
async function parseCommands(context) {
    try {
        const cmd = searchCommand(context);
        if (!cmd ||
            (cmd.requireChat && !context.isChat()) ||
            (cmd.requireReply && !context.hasRepliedMessage()))
            return;
        if ((cmd.requireCreator && context.senderId != base_1.CREATOR_ID) ||
            (cmd.requireAdmin && !base_1.includes(db_1.adminsList, context.senderId))) {
            await net_1.sendMessage(context, 'У вас нет доступа');
            return;
        }
        cmd.execute(context, context.text.match(cmd.regexp), context.repliedMessage);
    }
    catch (e) {
        console.log(base_1.getExceptionText(e));
    }
    function searchCommand(message, text) {
        return commands.find(c => c.regexp.test(message ? message.text : text));
    }
}
exports.parseCommands = parseCommands;
let commands = [
    new ae_1.Ae(),
    new dad_1.Dad(),
    new fuckYou_1.FuckYou(),
    new help_1.Help(),
    new mom_1.Mom(),
    new mute_1.Mute(),
    new unmute_1.Unmute(),
    new ping_1.Ping(),
    new q_1.Q(),
    new randomString_1.RandomString(),
    new systemSpecs_1.SystemSpecs(),
    new test_1.Test()
];
//# sourceMappingURL=commands.js.map