"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const base_1 = require("../base/base");
const net_1 = require("../base/net");
class Mom {
    constructor() {
        this.regexp = /ма(ма|му|ть|ы|ой)/i;
    }
    async execute(context) {
        if (!base_1.checkMom)
            return;
        await net_1.sendMessage(context, 'мать не трож');
    }
}
exports.Mom = Mom;
//# sourceMappingURL=mom.js.map