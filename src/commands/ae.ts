import {Command} from "../base/command";
import {Message} from "typescript-telegram-bot-api";
import {errorPlaceholder, logError, oldSendMessage} from "../util/utils";
import {Requirements} from "../base/requirements";
import {Requirement} from "../base/requirement";
import {Environment} from "../common/environment";

export class Ae extends Command {
    argsMode = "required" as const;

    command = ["ae"];

    title = Environment.commandTitles.ae;
    description = Environment.commandDescriptions.ae;

    requirements = Requirements.Build(Requirement.BOT_CREATOR);

    async execute(msg: Message, params?: RegExpExecArray) {
        const match = params?.[3] || "";

        try {
            let result = this.executeEvaluation(match);
            await oldSendMessage(msg, result).catch(async () => await errorPlaceholder(msg));
        } catch (error) {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            const text = normalizedError.message.toString();

            if (text.includes("is not defined")) {
                await oldSendMessage(msg, Environment.variableNotDefinedText).catch(logError);
                return;
            }

            logError(`${text}
                * Stacktrace: ${normalizedError.stack}`);

            await oldSendMessage(msg, text).catch(logError);
        }
    }

    executeEvaluation(evaluation: string): string {
        try {
            let e = eval(evaluation);

            e = ((typeof e == "string") ? e : JSON.stringify(e));

            return e;
        } catch (error) {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            const text = normalizedError.message.toString();

            if (text.includes("is not defined")) {
                return Environment.evaluationVariableNotDefinedText;
            }

            logError(`${text}
                * Stacktrace: ${normalizedError.stack}`);

            return text;
        }
    }
}
