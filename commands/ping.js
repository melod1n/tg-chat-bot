"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const base_1 = require("../base/base");
const net_1 = require("../base/net");
class Ping {
    constructor() {
        this.regexp = /^\/ping/i;
    }
    async execute(context) {
        await net_1.sendMessage(context, 'pong').then(async () => {
            const nowMillis = new Date().getMilliseconds();
            const change = Math.abs(nowMillis - base_1.startTime);
            await net_1.sendMessage(context, `ping: ${change} ms`).then(() => {
                base_1.setStartTime(0);
            });
        });
    }
}
exports.Ping = Ping;
//# sourceMappingURL=ping.js.map