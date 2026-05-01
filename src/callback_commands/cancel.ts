import {CallbackCommand} from "../base/callback-command";
import {Environment} from "../common/environment";

export class Cancel extends CallbackCommand {

    text = Environment.cancelText;
    data = "";

    constructor(text?: string, data?: string) {
        super();

        this.text = text ?? this.text;
        this.data = data ?? this.data;
    }

    static withData(data?: string): Cancel {
        return new Cancel(undefined, data);
    }

    async execute(): Promise<void> {
        return Promise.resolve();
    }
}
