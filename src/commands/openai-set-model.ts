import {Environment} from "../common/environment";
import {AiProvider} from "../model/ai-provider";
import {ProviderSetModelCommand} from "./provider-model-command";

export class OpenAISetModel extends ProviderSetModelCommand {
    constructor() {
        super({
            provider: AiProvider.OPENAI,
            title: Environment.commandTitles.openAiSetModel,
            description: Environment.commandDescriptions.openAiSetModel,
        });
    }
}
