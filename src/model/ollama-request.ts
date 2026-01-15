export type OllamaRequest = {
    uuid: string;
    stream: any;
    done: boolean;
    fromId: number;
    chatId: number;
}