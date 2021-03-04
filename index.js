"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const base_1 = require("./base/base");
const db_1 = require("./base/db");
const net_1 = require("./base/net");
base_1.initSystemSpecs();
db_1.readData();
db_1.retrieveAnswers();
net_1.startBot();
//# sourceMappingURL=index.js.map