import {Environment} from "../common/environment";
import {AiProvider} from "../model/ai-provider";
import {ProviderGetModelCommand} from "./provider-model-command";

export class OllamaGetModel extends ProviderGetModelCommand {
    constructor() {
        super({
            provider: AiProvider.OLLAMA,
            title: Environment.commandTitles.ollamaGetModel,
            description: Environment.commandDescriptions.ollamaGetModel,
        });
    }
}
