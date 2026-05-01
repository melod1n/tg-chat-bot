import {Command} from "../base/command";
import {logError, replyToMessage} from "../util/utils";
import {Message} from "typescript-telegram-bot-api";
import {Environment} from "../common/environment";
import {ShellCommandRunner} from "../util/shell-command-runner";

export class SystemInfo extends Command {
    title = Environment.commandTitles.systemInfo;
    description = Environment.commandDescriptions.systemInfo;

    private static systemInfoParams: Parameters<typeof Environment.getSystemSpecsText>[0] | null = null;

    static setSystemInfo(params: Parameters<typeof Environment.getSystemSpecsText>[0]) {
        SystemInfo.systemInfoParams = params;
    }

    async execute(msg: Message) {
        if (!SystemInfo.systemInfoParams) return;

        const loadAverageResult = await ShellCommandRunner.run("awk '{printf \"%.2f;%.2f;%.2f\\n\", $1, $2, $3}' /proc/loadavg");
        const split = loadAverageResult.stdout?.split(";").map(s => parseFloat(s)) ?? [];
        const loadAverageText = split.length
            ? `LOAD_AVERAGE: ${split.map(value => value.toFixed(2)).join(", ")}`
            : null;

        const finalText = [
            Environment.getSystemSpecsText(SystemInfo.systemInfoParams),
            loadAverageText,
        ].filter(Boolean).join("\n");

        await replyToMessage({message: msg, text: finalText}).catch(logError);
    }
}
