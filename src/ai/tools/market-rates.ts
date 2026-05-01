import {AiTool} from "../tool-types";
import axios from "axios";
import {toolsLogger} from "./tool-logger";
import {AiJsonObject} from "../tool-types";

const logger = toolsLogger.child("market-rates");

export const GET_FINANCIAL_MARKET_DATA_TOOL_NAME = "get_financial_market_data";

export const getFinancialMarketData = {
    type: "function",
    function: {
        name: GET_FINANCIAL_MARKET_DATA_TOOL_NAME,
        description:
            "Retrieve the latest exchange rates for supported currency, crypto, and precious metal pairs, including 24-hour change data when available. Supported pairs: USD/RUB, USD/EUR, USD/KZT, USD/UAH, USD/BYN, USD/GBP, USD/CNY, TON/USD, BTC/USD, ETH/USD, SOL/USD, and XAU/USD. Use this tool when the user asks for current rates, currency conversion, crypto prices, gold price, or recent 24-hour movement. This tool takes no parameters.",
        parameters: {
            type: "object",
            properties: {},
            required: [],
        },
    },
} satisfies AiTool;

export const getFinancialMarketDataToolPrompt = [
    "Currency rates tool rules:",
    `- Use \`${GET_FINANCIAL_MARKET_DATA_TOOL_NAME}\` whenever the answer depends on current exchange rates, crypto prices, or gold price.`,
    `- Use \`${GET_FINANCIAL_MARKET_DATA_TOOL_NAME}\` when the user asks whether a supported asset went up or down recently.`,
    `- Use \`${GET_FINANCIAL_MARKET_DATA_TOOL_NAME}\` when the user asks for the 24-hour change, percentage change, or movement direction for a supported pair.`,
    "- Never guess current rates, prices, or 24-hour changes. Call the tool first.",
    "- Do not use this tool for unsupported pairs unless the user asks about one of the supported pairs listed below.",
    "- Do not use this tool for historical rates beyond the provided 24-hour comparison.",
    "",
    "Supported pairs:",
    "- `usd_to_rub`: USD to RUB.",
    "- `usd_to_eur`: USD to EUR.",
    "- `usd_to_kzt`: USD to KZT.",
    "- `usd_to_uah`: USD to UAH.",
    "- `usd_to_byn`: USD to BYN.",
    "- `usd_to_gbp`: USD to GBP.",
    "- `usd_to_cny`: USD to CNY.",
    "- `ton_to_usd`: TON to USD.",
    "- `btc_to_usd`: BTC to USD.",
    "- `eth_to_usd`: ETH to USD.",
    "- `sol_to_usd`: SOL to USD.",
    "- `xau_to_usd`: gold/XAU to USD.",
    "",
    "Arguments:",
    "- This tool takes no arguments.",
    "",
    "Returned data:",
    "- Each supported pair contains `rate` with the latest available rate.",
    "- Each supported pair may contain `change.absolute` with the absolute 24-hour change.",
    "- Each supported pair may contain `change.percent` with the percentage 24-hour change.",
    "- Each supported pair may contain `change.direction` with the movement direction, e.g. `up`, `down`, or `flat`.",
    "- `has_24h_comparison`: whether 24-hour comparison data is available.",
    "",
    "After the tool returns:",
    "- Base the answer only on the returned values.",
    "- If `has_24h_comparison` is false, provide only the current rates and say that 24-hour comparison is unavailable.",
    "- Do not expose raw tool JSON unless asked.",
    "- Format the answer in a user-friendly way.",
    "- For fiat pairs, show the rate with the target currency, for example: `USD/RUB is 75.22 RUB, down 0.16% over 24 hours.`",
    "- For crypto and gold pairs, show the USD price, for example: `BTC/USD is $81,451.66, up 0.22% over 24 hours.`",
    "- When the user asks for all rates, group fiat currencies separately from crypto and gold.",
].join("\n");

export async function getMarketRates(): Promise<AiJsonObject | undefined> {
    const startedAt = Date.now();
    try {
        logger.info("start");
        const response = await axios.get("https://apid.r00t.top/api/v2/currency/rates");
        logger.debug("done", {duration: logger.duration(startedAt), status: response.status});
        return response.data;
    } catch (error) {
        logger.error("failed", {duration: logger.duration(startedAt), error: error instanceof Error ? error : String(error)});
        return undefined;
    }
}
