import {Environment} from "../common/environment";
import {AiProvider} from "../model/ai-provider";
import {ProviderListModelsCommand} from "./provider-model-command";

export class OllamaListModels extends ProviderListModelsCommand {
    constructor() {
        super({
            provider: AiProvider.OLLAMA,
            title: Environment.commandTitles.ollamaListModels,
            description: Environment.commandDescriptions.ollamaListModels,
        });
    }
}
