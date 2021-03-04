import * as TeleBot from 'telebot'
import {MessageContext, prepareMessageContext, upReceivedMessages, upSentMessages} from "./base";
import {parseCommands} from "../commands/base/commands";

export const bot = new TeleBot('1640683270:AAFc4yIbeF_ofkcPtD8U9ReRXZ754rlxYrw')

export function startBot() {
    bot.on('*', async (rawMessage: any) => {
        upReceivedMessages()

        console.log(rawMessage)

        const context = prepareMessageContext(rawMessage)

        if (context.hasInvitedMembers()) {

            return
        }

        await parseCommands(context)
    })

    bot.start()
}

export async function sendMessage(context: MessageContext, text: string): Promise<any> {
    return await bot.sendMessage(context.chatId, text).then(() => {
        upSentMessages()
    })
}