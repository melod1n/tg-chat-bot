import {MessageContext} from "../../base/base";

export declare class Command {
    regexp: RegExp
    title?: string
    description?: string
    requireAdmin?: boolean
    requireReply?: boolean
    requireCreator?: boolean
    requireChat?: boolean

    execute: (context: MessageContext, params: string[], reply?: MessageContext) => {}
}