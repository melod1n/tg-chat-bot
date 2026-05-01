export type OllamaRequest = {
    uuid: string;
    stream: boolean | string | number | object | null | undefined;
    done: boolean;
    fromId: number;
    chatId: number;
}
