import {Environment} from "../common/environment";
import {AiProvider} from "../model/ai-provider";
import {ProviderGetModelCommand} from "./provider-model-command";

export class MistralGetModel extends ProviderGetModelCommand {
    constructor() {
        super({
            provider: AiProvider.MISTRAL,
            title: Environment.commandTitles.mistralGetModel,
            description: Environment.commandDescriptions.mistralGetModel,
        });
    }
}
