"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const TeleBot = require("telebot");
const base_1 = require("./base");
const commands_1 = require("../commands/base/commands");
exports.bot = new TeleBot('1640683270:AAFc4yIbeF_ofkcPtD8U9ReRXZ754rlxYrw');
function startBot() {
    exports.bot.on('*', async (rawMessage) => {
        base_1.upReceivedMessages();
        console.log(rawMessage);
        const context = base_1.prepareMessageContext(rawMessage);
        if (context.hasInvitedMembers()) {
            return;
        }
        await commands_1.parseCommands(context);
    });
    exports.bot.start();
}
exports.startBot = startBot;
async function sendMessage(context, text) {
    return await exports.bot.sendMessage(context.chatId, text).then(() => {
        base_1.upSentMessages();
    });
}
exports.sendMessage = sendMessage;
//# sourceMappingURL=net.js.map