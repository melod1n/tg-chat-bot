import {Environment} from "../common/environment";
import {AiProvider} from "../model/ai-provider";
import {ProviderListModelsCommand} from "./provider-model-command";

export class OpenAIListModels extends ProviderListModelsCommand {
    constructor() {
        super({
            provider: AiProvider.OPENAI,
            title: Environment.commandTitles.openAiListModels,
            description: Environment.commandDescriptions.openAiListModels,
        });
    }
}
