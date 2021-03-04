"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const net_1 = require("../base/net");
class Ae {
    constructor() {
        this.regexp = /^\/ae\s([^]+)/i;
    }
    async execute(context, params) {
        const match = params[1];
        try {
            let e = eval(match);
            e = ((typeof e == 'string') ? e : JSON.stringify(e));
            await net_1.sendMessage(context, e);
        }
        catch (e) {
            const text = e.message.toString();
            if (text.includes('is not defined')) {
                await net_1.sendMessage(context, 'variable is not defined');
                return;
            }
            console.error(`${text}
                * Stacktrace: ${e.stack}`);
            await net_1.sendMessage(context, text);
        }
    }
}
exports.Ae = Ae;
//# sourceMappingURL=ae.js.map