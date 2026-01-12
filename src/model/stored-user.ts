export type StoredUser = {
    id: number;
    isBot: boolean;
    firstName: string;
    lastName?: string;
    userName?: string;
    isPremium?: boolean;
}