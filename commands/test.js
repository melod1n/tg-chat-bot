"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const base_1 = require("../base/base");
const net_1 = require("../base/net");
class Test {
    constructor() {
        this.regexp = /^(test|тест|еуые|ntcn|инноке(нтий|ш|нтич))/i;
    }
    async execute(context) {
        if (!base_1.testAnswer)
            return;
        const index = base_1.getRandomInt(base_1.testAnswers.length);
        await net_1.sendMessage(context, base_1.testAnswers[index]);
    }
}
exports.Test = Test;
//# sourceMappingURL=test.js.map