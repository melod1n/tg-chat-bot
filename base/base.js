"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const si = require("systeminformation");
exports.IS_DEBUG = true;
exports.CREATOR_ID = 0;
exports.startTime = 0;
exports.systemSpecsText = '';
exports.testAnswer = true;
exports.checkMom = true;
exports.checkDad = true;
exports.biteDick = true;
exports.messagesReceived = 0;
exports.messagesSent = 0;
exports.testAnswers = [];
function upReceivedMessages() {
    exports.messagesReceived++;
}
exports.upReceivedMessages = upReceivedMessages;
function upSentMessages() {
    exports.messagesSent++;
}
exports.upSentMessages = upSentMessages;
function setTestAnswers(answers) {
    this.testAnswers = answers;
}
exports.setTestAnswers = setTestAnswers;
function setStartTime(startTime) {
    this.startTime = startTime;
}
exports.setStartTime = setStartTime;
function initSystemSpecs() {
    let text = '';
    si.osInfo().then(async (os) => {
        text += `OS: ${os.distro}\n`;
        si.cpu().then(async (cpu) => {
            text += `CPU: ${cpu.manufacturer} ${cpu.brand} ${cpu.physicalCores} cores ${cpu.cores} threads\n`;
            si.mem().then(async (memory) => {
                const totalRam = Math.round(memory.total / Math.pow(2, 30));
                text += `RAM: ${totalRam} GB\n`;
                exports.systemSpecsText = text;
            });
        });
    });
}
exports.initSystemSpecs = initSystemSpecs;
class Chat {
}
exports.Chat = Chat;
class From {
}
exports.From = From;
class Message {
}
exports.Message = Message;
class MessageContext {
    hasInvitedMembers() {
        return !!this.message.new_chat_members;
    }
    hasLeftMembers() {
        return !!this.message.left_chat_member;
    }
    isChat() {
        return this.message.chat.type !== 'private';
    }
    getFullSenderTitle() {
        return this.message.from.firstName + (this.message.from.lastName ? ' ' + this.message.from.lastName : '');
    }
    getFullChatTitle() {
        return this.message.chat.firstName + (this.message.chat.lastName ? ' ' + this.message.chat.lastName : '');
    }
    hasRepliedMessage() {
        return !!this.message.reply_to_message;
    }
}
exports.MessageContext = MessageContext;
function prepareMessageContext(rawMessage) {
    if (!rawMessage)
        return null;
    const context = new MessageContext();
    context.message = this.prepareMessage(rawMessage);
    context.senderId = context.message.from.id;
    context.chatId = context.message.chat.id;
    context.invitedMembers = context.message.new_chat_members;
    context.leftMember = context.message.left_chat_member;
    context.reply = rawMessage.reply;
    if (context.message.reply_to_message !== null)
        context.repliedMessage = this.prepareMessageContext(rawMessage.reply_to_message);
    context.text = context.message.body;
    return context;
}
exports.prepareMessageContext = prepareMessageContext;
function prepareMessage(rawMessage) {
    if (!rawMessage)
        return null;
    const message = new Message();
    message.id = rawMessage.message_id;
    message.date = rawMessage.date;
    message.body = rawMessage.text;
    message.new_chat_members = rawMessage.new_chat_members;
    message.left_chat_member = rawMessage.left_chat_member;
    const from = new From();
    from.id = rawMessage.from.id;
    from.isBot = rawMessage.from.is_bot;
    from.firstName = rawMessage.from.first_name;
    from.lastName = rawMessage.from.last_name;
    from.username = rawMessage.from.username;
    message.from = from;
    const chat = new Chat();
    chat.id = rawMessage.chat.id;
    chat.firstName = rawMessage.chat.first_name;
    chat.lastName = rawMessage.chat.last_name;
    chat.username = rawMessage.chat.username;
    chat.type = rawMessage.chat.type;
    message.chat = chat;
    if (rawMessage.reply_to_message)
        message.reply_to_message = this.prepareMessage(rawMessage.reply_to_message);
    return message;
}
exports.prepareMessage = prepareMessage;
function includes(array, object) {
    return array.indexOf(object) > -1;
}
exports.includes = includes;
function getRandomInt(max) {
    return Math.floor(Math.random() * Math.floor(max));
}
exports.getRandomInt = getRandomInt;
function arrayRemove(arr, value) {
    return arr.filter(function (ele) {
        return ele != value;
    });
}
exports.arrayRemove = arrayRemove;
function deepEqual(object1, object2) {
    if ((object1 == null || object2 == null) && object1 != object2)
        return false;
    const keys1 = Object.keys(object1);
    const keys2 = Object.keys(object2);
    if (keys1.length !== keys2.length) {
        return false;
    }
    for (const key of keys1) {
        const val1 = object1[key];
        const val2 = object2[key];
        const areObjects = isObject(val1) && isObject(val2);
        if (areObjects && !deepEqual(val1, val2) ||
            !areObjects && val1 !== val2) {
            return false;
        }
    }
    return true;
}
exports.deepEqual = deepEqual;
function isObject(object) {
    return object != null && typeof object === 'object';
}
exports.isObject = isObject;
function getUptime() {
    const processSeconds = Math.ceil(process.uptime());
    let minutes = 0;
    let hours = 0;
    let days = 0;
    let i = 0;
    let seconds = 0;
    while (i < processSeconds) {
        i++;
        seconds++;
        if (seconds == 60) {
            minutes++;
            seconds = 0;
        }
        if (minutes == 60) {
            hours++;
            minutes = 0;
        }
        if (hours == 24) {
            days++;
            hours = 0;
        }
    }
    let text = '';
    if (days > 0)
        text += `${days} д. `;
    if (hours > 0)
        text += `${hours} ч. `;
    if (minutes > 0)
        text += `${minutes} м. `;
    if (seconds > 0)
        text += `${seconds} с. `;
    return text;
}
exports.getUptime = getUptime;
function getExceptionText(e) {
    return `Произошел троллинг
    * Error : ${e.name}
    * Message : ${e.message}
    * StackTrace : 
       ${e.stack}`;
}
exports.getExceptionText = getExceptionText;
//# sourceMappingURL=base.js.map