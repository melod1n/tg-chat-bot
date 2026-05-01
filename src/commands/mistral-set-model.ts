import {Environment} from "../common/environment";
import {AiProvider} from "../model/ai-provider";
import {ProviderSetModelCommand} from "./provider-model-command";

export class MistralSetModel extends ProviderSetModelCommand {
    constructor() {
        super({
            provider: AiProvider.MISTRAL,
            title: Environment.commandTitles.mistralSetModel,
            description: Environment.commandDescriptions.mistralSetModel,
        });
    }
}
