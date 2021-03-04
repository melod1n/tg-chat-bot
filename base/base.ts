import * as si from 'systeminformation'

export const IS_DEBUG: boolean = true
export const CREATOR_ID: number = 0

export let startTime: number = 0
export let systemSpecsText: string = ''
export let testAnswer: boolean = true
export let checkMom: boolean = true
export let checkDad: boolean = true
export let biteDick: boolean = true

export let messagesReceived = 0
export let messagesSent = 0

export let testAnswers: string[] = []

export function upReceivedMessages() {
    messagesReceived++
}

export function upSentMessages() {
    messagesSent++
}

export function setTestAnswers(answers: string[]) {
    this.testAnswers = answers
}

export function setStartTime(startTime: number) {
    this.startTime = startTime
}

export function initSystemSpecs() {
    let text = ''

    si.osInfo().then(async (os) => {
        text += `OS: ${os.distro}\n`
        si.cpu().then(async (cpu) => {
            text += `CPU: ${cpu.manufacturer} ${cpu.brand} ${cpu.physicalCores} cores ${cpu.cores} threads\n`

            si.mem().then(async (memory) => {
                const totalRam = Math.round(memory.total / Math.pow(2, 30))
                text += `RAM: ${totalRam} GB\n`

                systemSpecsText = text
            })
        })
    })
}

export class Chat {
    id: number
    firstName: string
    lastName?: string
    username?: string
    type: string
}

export class From {
    id: number
    isBot: boolean
    firstName: string
    lastName?: string
    username?: string
}

export class Message {
    id: number
    from: From
    chat: Chat
    date: number
    reply_to_message?: Message
    body: string
    new_chat_members?: From[]
    left_chat_member?: From
}

export class MessageContext {
    message: Message
    reply: any
    senderId: number
    chatId: number
    repliedMessage?: MessageContext
    text: string
    invitedMembers?: From[]
    leftMember?: From

    hasInvitedMembers(): boolean {
        return !!this.message.new_chat_members
    }

    hasLeftMembers(): boolean {
        return !!this.message.left_chat_member
    }

    isChat(): boolean {
        return this.message.chat.type !== 'private'
    }

    getFullSenderTitle(): string {
        return this.message.from.firstName + (this.message.from.lastName ? ' ' + this.message.from.lastName : '')
    }

    getFullChatTitle(): string {
        return this.message.chat.firstName + (this.message.chat.lastName ? ' ' + this.message.chat.lastName : '')
    }

    hasRepliedMessage(): boolean {
        return !!this.message.reply_to_message
    }
}

export function prepareMessageContext(rawMessage: any): MessageContext {
    if (!rawMessage) return null

    const context = new MessageContext()
    context.message = this.prepareMessage(rawMessage)
    context.senderId = context.message.from.id
    context.chatId = context.message.chat.id
    context.invitedMembers = context.message.new_chat_members
    context.leftMember = context.message.left_chat_member

    context.reply = rawMessage.reply

    if (context.message.reply_to_message !== null)
        context.repliedMessage = this.prepareMessageContext(rawMessage.reply_to_message)

    context.text = context.message.body

    return context
}

export function prepareMessage(rawMessage: any) {
    if (!rawMessage) return null

    const message = new Message()
    message.id = rawMessage.message_id
    message.date = rawMessage.date
    message.body = rawMessage.text

    message.new_chat_members = rawMessage.new_chat_members
    message.left_chat_member = rawMessage.left_chat_member

    const from = new From()
    from.id = rawMessage.from.id
    from.isBot = rawMessage.from.is_bot
    from.firstName = rawMessage.from.first_name
    from.lastName = rawMessage.from.last_name
    from.username = rawMessage.from.username

    message.from = from

    const chat = new Chat()
    chat.id = rawMessage.chat.id
    chat.firstName = rawMessage.chat.first_name
    chat.lastName = rawMessage.chat.last_name
    chat.username = rawMessage.chat.username
    chat.type = rawMessage.chat.type

    message.chat = chat

    if (rawMessage.reply_to_message) message.reply_to_message = this.prepareMessage(rawMessage.reply_to_message)

    return message
}


export function includes(array: any[], object: any) {
    return array.indexOf(object) > -1
}

export function getRandomInt(max: number) {
    return Math.floor(Math.random() * Math.floor(max));
}

export function arrayRemove(arr: any[], value: any) {
    return arr.filter(function (ele: any) {
        return ele != value;
    });
}

export function deepEqual(object1: { [x: string]: any }, object2: { [x: string]: any; year?: number; month?: number; day?: number }) {
    if ((object1 == null || object2 == null) && object1 != object2) return false

    const keys1 = Object.keys(object1);
    const keys2 = Object.keys(object2);

    if (keys1.length !== keys2.length) {
        return false;
    }

    for (const key of keys1) {
        const val1 = object1[key];
        const val2 = object2[key];
        const areObjects = isObject(val1) && isObject(val2);
        if (
            areObjects && !deepEqual(val1, val2) ||
            !areObjects && val1 !== val2
        ) {
            return false;
        }
    }

    return true;
}

export function isObject(object: any) {
    return object != null && typeof object === 'object';
}


export function getUptime() {
    const processSeconds = Math.ceil(process.uptime())

    let minutes = 0
    let hours = 0
    let days = 0

    let i = 0
    let seconds = 0

    while (i < processSeconds) {
        i++

        seconds++

        if (seconds == 60) {
            minutes++
            seconds = 0
        }

        if (minutes == 60) {
            hours++
            minutes = 0
        }

        if (hours == 24) {
            days++
            hours = 0
        }
    }

    let text = ''

    if (days > 0) text += `${days} д. `
    if (hours > 0) text += `${hours} ч. `
    if (minutes > 0) text += `${minutes} м. `
    if (seconds > 0) text += `${seconds} с. `

    return text
}


export function getExceptionText(e: Error) {
    return `Произошел троллинг
    * Error : ${e.name}
    * Message : ${e.message}
    * StackTrace : 
       ${e.stack}`
}