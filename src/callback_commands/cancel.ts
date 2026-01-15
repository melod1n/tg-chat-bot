import {CallbackCommand} from "../base/callback-command";

export class Cancel extends CallbackCommand {

    text = "❌ Отменить";
    data = null;

    constructor(text?: string, data?: string) {
        super();

        this.text = text ?? this.text;
        this.data = data ?? this.data;
    }

    static withData(data?: string): Cancel {
        return new Cancel(null, data);
    }

    async execute(): Promise<void> {
        return Promise.resolve();
    }
}