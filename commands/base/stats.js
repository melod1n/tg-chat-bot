"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const base_1 = require("../../base/base");
const net_1 = require("../../base/net");
class Stats {
    constructor() {
        this.regexp = /^\/stats/i;
    }
    async execute(context) {
        const text = `Статистика бота.\n\n⏳ Время работы: ${base_1.getUptime()}\n📥 Сообщений получено: ${base_1.messagesReceived}\n📤 Сообщений отправлено: ${base_1.messagesSent}`;
        await net_1.sendMessage(context, text);
    }
}
exports.Stats = Stats;
//# sourceMappingURL=stats.js.map