import {Requirement} from "./requirement";

export class Requirements {
    requirements: Requirement[] = [];

    private constructor(requirements?: Requirement[]) {
        this.requirements = requirements;
    }

    static Build(...requirements: Requirement[]): Requirements {
        return new Requirements(requirements);
    }

    isRequiresBotCreator(): boolean {
        return this.requirements.includes(Requirement.BOT_CREATOR);
    }

    isRequiresBotAdmin(): boolean {
        return this.requirements.includes(Requirement.BOT_ADMIN);
    }

    isRequiresBotChatAdmin(): boolean {
        return this.requirements.includes(Requirement.BOT_CHAT_ADMIN);
    }

    isRequiresChat(): boolean {
        return this.requirements.includes(Requirement.CHAT);
    }

    isRequiresReply(): boolean {
        return this.requirements.includes(Requirement.REPLY);
    }
}