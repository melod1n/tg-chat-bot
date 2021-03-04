"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const net_1 = require("../base/net");
class Q {
    constructor() {
        this.regexp = /^(\/q|умри)/i;
    }
    async execute(context, params, reply) {
        await net_1.sendMessage(context, 'пака');
        process.exit();
    }
}
exports.Q = Q;
//# sourceMappingURL=q.js.map