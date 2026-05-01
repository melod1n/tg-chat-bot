import {Message} from "typescript-telegram-bot-api";
import {Command} from "../base/command";
import {Requirement} from "../base/requirement";
import {Requirements} from "../base/requirements";
import {createOllamaClient, resolveAiRuntimeTarget} from "../ai/ai-runtime-target";
import {formatRuntimeModelInfo, getRuntimeModel, listProviderModels, setRuntimeModel} from "../ai/provider-model-runtime";
import {Environment} from "../common/environment";
import {AiProvider} from "../model/ai-provider";
import {appLogger} from "../logging/logger";
import {escapeHtml, logError, replyToMessage} from "../util/utils";

const logger = appLogger.child("commands:models");

type ProviderModelCommandOptions = {
    provider: AiProvider;
    title: string;
    description: string;
};

export abstract class ProviderModelCommand extends Command {
    protected readonly provider: AiProvider;

    title: string;
    description: string;

    protected constructor(options: ProviderModelCommandOptions) {
        super();
        this.provider = options.provider;
        this.title = options.title;
        this.description = options.description;
    }
}

export class ProviderGetModelCommand extends ProviderModelCommand {
    async execute(msg: Message): Promise<void> {
        logger.debug("get_model", {provider: this.provider, chatId: msg.chat?.id, messageId: msg.message_id});
        await replyToMessage({message: msg, text: await formatRuntimeModelInfo(this.provider)}).catch(logError);
    }
}

export class ProviderSetModelCommand extends ProviderModelCommand {
    argsMode = "required" as const;
    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message, match?: RegExpExecArray | null): Promise<void> {
        const newModel = match?.[3]?.trim();
        logger.info("set_model.request", {provider: this.provider, hasModel: !!newModel, chatId: msg.chat?.id, messageId: msg.message_id});

        if (newModel) setRuntimeModel(this.provider, newModel);

        const model = getRuntimeModel(this.provider);
        const text = newModel
            ? Environment.getSelectedModelWithInfoText(model, await formatRuntimeModelInfo(this.provider))
            : Environment.getModelIsNotSetCurrentText(model);

        logger.debug("set_model.reply", {provider: this.provider, model});
        await replyToMessage({message: msg, text}).catch(logError);
    }
}

export class ProviderListModelsCommand extends ProviderModelCommand {
    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message): Promise<void> {
        try {
            logger.info("list_models.request", {provider: this.provider, chatId: msg.chat?.id, messageId: msg.message_id});
            const models = (await listProviderModels(this.provider)).sort((a, b) => a.localeCompare(b));
            const modelsString = escapeHtml(models.join("\n").substring(0, 4000));
            const text = await this.buildListText(modelsString);

            logger.debug("list_models.reply", {provider: this.provider, count: models.length, textChars: text.length});
            await replyToMessage({message: msg, text, parse_mode: "HTML"});
        } catch (e) {
            logger.error("list_models.failed", {provider: this.provider, error: e instanceof Error ? e : String(e)});
            logError(e instanceof Error ? e : String(e));
            await replyToMessage({message: msg, text: Environment.modelListLoadFailedText}).catch(logError);
        }
    }

    private async buildListText(modelsString: string): Promise<string> {
        if (this.provider !== AiProvider.OLLAMA) {
            return Environment.modelListHeaderText + "<blockquote expandable>" + modelsString + "</blockquote>";
        }

        const target = resolveAiRuntimeTarget(AiProvider.OLLAMA, "chat");
        const loadedModels = ((await createOllamaClient(target).ps())?.models ?? [])
            .map(model => model.model || model.name)
            .filter((model): model is string => !!model);

        logger.debug("list_models.loaded", {provider: this.provider, loaded: loadedModels.length});
        return Environment.getLoadedModelsText(loadedModels)
            + "\n\n"
            + Environment.modelListHeaderText
            + "<blockquote expandable>"
            + modelsString
            + "</blockquote>";
    }
}
