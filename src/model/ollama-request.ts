export type OllamaRequest = {
    uuid: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stream: any;
    done: boolean;
    fromId: number;
    chatId: number;
}