import {Environment} from "../common/environment";
import {AiProvider} from "../model/ai-provider";
import {ProviderSetModelCommand} from "./provider-model-command";

export class OllamaSetModel extends ProviderSetModelCommand {
    constructor() {
        super({
            provider: AiProvider.OLLAMA,
            title: Environment.commandTitles.ollamaSetModel,
            description: Environment.commandDescriptions.ollamaSetModel,
        });
    }
}
