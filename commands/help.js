"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const net_1 = require("../base/net");
class Help {
    constructor() {
        this.regexp = /^\/help/i;
    }
    async execute(context) {
        const text = "Все вопросы к @melodaaa";
        return net_1.sendMessage(context, text);
    }
}
exports.Help = Help;
//# sourceMappingURL=help.js.map