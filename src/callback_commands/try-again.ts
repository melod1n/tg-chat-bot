import {CallbackCommand} from "../base/callback-command";

export class TryAgain extends CallbackCommand {
    data = "";
    text = "🔁 Повторить";

    constructor(text?: string, data?: string) {
        super();

        this.text = text ?? this.text;
        this.data = data ?? this.data;
    }

    static withData(data?: string): TryAgain {
        return new TryAgain(null, data);
    }

    async execute(): Promise<void> {
        return Promise.resolve();
    }
}