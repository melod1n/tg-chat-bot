import {Environment} from "../common/environment";
import {AiProvider} from "../model/ai-provider";
import {ProviderGetModelCommand} from "./provider-model-command";

export class OpenAIGetModel extends ProviderGetModelCommand {
    constructor() {
        super({
            provider: AiProvider.OPENAI,
            title: Environment.commandTitles.openAiGetModel,
            description: Environment.commandDescriptions.openAiGetModel,
        });
    }
}
