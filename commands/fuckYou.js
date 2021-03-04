"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const base_1 = require("../base/base");
const net_1 = require("../base/net");
class FuckYou {
    constructor() {
        this.regexp = /(иди|пош([её])л)\s(нахуй|на\sхуй)/i;
    }
    async execute(context) {
        if (!base_1.biteDick)
            return;
        await net_1.sendMessage(context, 'кусай за хуй');
    }
}
exports.FuckYou = FuckYou;
//# sourceMappingURL=fuckYou.js.map