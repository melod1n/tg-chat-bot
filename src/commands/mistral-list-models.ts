import {Environment} from "../common/environment";
import {AiProvider} from "../model/ai-provider";
import {ProviderListModelsCommand} from "./provider-model-command";

export class MistralListModels extends ProviderListModelsCommand {
    constructor() {
        super({
            provider: AiProvider.MISTRAL,
            title: Environment.commandTitles.mistralListModels,
            description: Environment.commandDescriptions.mistralListModels,
        });
    }
}
