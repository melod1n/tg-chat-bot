"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const base_1 = require("../base/base");
const net_1 = require("../base/net");
class Dad {
    constructor() {
        this.regexp = /бат(ь|я|ька|ёк)/i;
    }
    async execute(context) {
        if (!base_1.checkDad)
            return;
        await net_1.sendMessage(context, 'ща втащу');
    }
}
exports.Dad = Dad;
//# sourceMappingURL=dad.js.map