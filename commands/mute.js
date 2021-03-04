"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("../base/db");
const net_1 = require("../base/net");
class Mute {
    constructor() {
        this.regexp = /^\/mute/i;
    }
    async execute(context, params, reply) {
        if (!reply)
            return;
        const id = context.repliedMessage.senderId;
        const text = context.repliedMessage.getFullSenderTitle();
        if (db_1.addMute(id)) {
            await net_1.sendMessage(context, text + ' в муте! 🚫');
        }
        else {
            await net_1.sendMessage(context, text + ' уже в муте 🤔');
        }
    }
}
exports.Mute = Mute;
//# sourceMappingURL=mute.js.map