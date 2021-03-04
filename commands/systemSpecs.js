"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const base_1 = require("../base/base");
const net_1 = require("../base/net");
class SystemSpecs {
    constructor() {
        this.regexp = /^\/systemspecs/i;
    }
    async execute(context) {
        await net_1.sendMessage(context, base_1.systemSpecsText);
    }
}
exports.SystemSpecs = SystemSpecs;
//# sourceMappingURL=systemSpecs.js.map