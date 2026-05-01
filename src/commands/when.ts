import {Command} from "../base/command";
import {getRandomInt, getRangedRandomInt, logError, oldReplyToMessage} from "../util/utils";
import {Message} from "typescript-telegram-bot-api";
import {Environment} from "../common/environment";

export class When extends Command {
    command = ["when", "когда"];
    argsMode = "required" as const;

    title = Environment.commandTitles.when;
    description = Environment.commandDescriptions.when;

    async execute(msg: Message) {
        let text = Environment.getWhenPrefixText();

        const type = getRandomInt(8);

        switch (type) {
            case 0:
                text = Environment.whenNowText;
                break;
            case 1:
                text = Environment.whenNeverText;
                break;
            case 2: //seconds
            {
                const seconds = getRangedRandomInt(1, 60);
                text = Environment.getWhenDurationText(seconds, Environment.whenSecondUnitText);
                break;
            }
            case 3: {
                const minutes = getRangedRandomInt(1, 60);
                text = Environment.getWhenDurationText(minutes, Environment.whenMinuteUnitText);
                break;
            }
            case 4: {
                const hours = getRangedRandomInt(1, 24);
                text = Environment.getWhenDurationText(hours, Environment.whenHourUnitText);
                break;
            }
            case 5: {
                const weeks = getRangedRandomInt(1, 4);
                text = Environment.getWhenDurationText(weeks, Environment.whenWeekUnitText);
                break;
            }
            case 6: {
                const months = getRandomInt(12);
                text = Environment.getWhenDurationText(months, Environment.whenMonthUnitText);
                break;
            }
            case 7: {
                const years = getRangedRandomInt(1, 100);
                text = Environment.getWhenDurationText(years, Environment.whenYearUnitText);
                break;
            }
        }

        await oldReplyToMessage(msg, text).catch(logError);
    }
}
