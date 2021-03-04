"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("../base/db");
const net_1 = require("../base/net");
class Unmute {
    constructor() {
        this.regexp = /^\/unmute/i;
    }
    async execute(context, params, reply) {
        if (!reply)
            return;
        const id = context.repliedMessage.senderId;
        const text = context.repliedMessage.getFullSenderTitle();
        if (db_1.removeMute(id)) {
            await net_1.sendMessage(context, text + ' больше не в муте! 😁');
        }
        else {
            await net_1.sendMessage(context, text + ' не был в муте 🤔');
        }
    }
}
exports.Unmute = Unmute;
//# sourceMappingURL=unmute.js.map