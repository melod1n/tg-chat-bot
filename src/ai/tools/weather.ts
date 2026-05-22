import axios from "axios";
import {toolsLogger} from "./tool-logger.js";

const logger = toolsLogger.child("weather");
import {Environment} from "../../common/environment.js";
import {logError} from "../../util/utils.js";
import {AiJsonObject, AiTool} from "../tool-types.js";
import {asNonEmptyString} from "./utils.js";

export const getWeatherTool = {
    type: "function",
    function: {
        name: "get_weather",
        description: "Get the current temperature for a city.",
        parameters: {
            type: "object",
            properties: {
                city: {
                    type: "string",
                    description: "The name of the city."
                },
                lang: {
                    type: "string",
                    description: "language code for the response/content. Must be a valid ISO 639-1 two-letter language code, for example: \"en\", \"ru\", \"de\", \"fr\".Determine the value automatically from the language the user is using to communicate with the LLM. If the user explicitly requests a specific language, use that requested language instead. Do not use language names, locales, or regional variants such as \"English\", \"ru-RU\", or \"en_US\"; return only the ISO 639-1 code."
                }
            },
            required: ["city", "lang"],
        }
    }
} satisfies AiTool;

export const weatherToolPrompt = [
    "Weather tool rules:",
    "- Use `get_weather` for current weather, current temperature, conditions, hot/cold/rainy/snowy questions, and weather follow-ups.",
    "- Weather is live/current data. Never answer it from memory.",
    "- A weather tool result is valid only for the exact city used in that tool call.",
    "- If the user changes the city, call `get_weather` again.",
    "- Follow-up questions like `what about Moscow?`, `and for Krasnodar?`, `what about there?`, `what about Berlin?` inherit the previous weather intent and require a new tool call for the new city.",
    "",
    "Arguments:",
    "- `city`: the city from the latest user request or resolved from the follow-up context.",
    "- `lang`: ISO 639-1 two-letter language code only: `ru`, `en`, `de`, etc.",
    "",
    "Do not guess, compare, or reuse weather from another city.",
    "If the city is missing or unclear, ask the user to specify it.",
].join("\n");

export async function getWeather(args?: AiJsonObject): Promise<AiJsonObject | null> {
    const startedAt = Date.now();
    logger.info("start", {args});
    try {
        const city = asNonEmptyString(args?.city);
        const lang = asNonEmptyString(args?.lang);

        if (!city) {
            return null;
        }

        const apiKey = Environment.OPEN_WEATHER_MAP_API_KEY;

        const geocodeResponse = (await axios.get("https://api.openweathermap.org/geo/1.0/direct", {
            params: {
                q: city,
                limit: 1,
                appid: apiKey,
            },
        })).data[0];
        logger.debug("geocode.done", {city, country: geocodeResponse?.country, hasResult: !!geocodeResponse, geocodeResponse});
        if (!geocodeResponse) {
            return {
                ok: false,
                tool: "get_weather",
                error: `City not found: ${city}`,
                city,
                lang,
            };
        }
        const lat = geocodeResponse.lat;
        const lon = geocodeResponse.lon;

        const response = (await axios.get("https://api.openweathermap.org/data/2.5/weather", {
            params: {
                lat,
                lon,
                units: "metric",
                appid: apiKey,
                ...(lang ? {lang} : {}),
            },
        })).data;
        logger.debug("weather_api.done", {city, country: geocodeResponse.country, lang, units: "metric", hasResponse: !!response});

        const main = response.main;
        const sys = response.sys;
        const wind = response.wind;
        const weather = response.weather[0];

        let date = new Date(sys.sunrise * 1000);

        const sunrise = [
            date.getUTCHours(),
            date.getUTCMinutes(),
            date.getUTCSeconds(),
        ]
            .map((v) => String(v).padStart(2, "0"))
            .join(":");

        date = new Date(sys.sunset * 1000);

        const sunset = [
            date.getUTCHours(),
            date.getUTCMinutes(),
            date.getUTCSeconds(),
        ]
            .map((v) => String(v).padStart(2, "0"))
            .join(":");

        return {
            ok: true,
            tool: "get_weather",
            scope: {
                city,
                lang,
                validOnlyForExactCity: true,
                liveData: true,
                note: "If the user asks about another city, call get_weather again.",
            },
            weather: {
                main: weather.main,
                description: weather.description,
                temperature: main.temp,
                temperatureMax: main.temp_max,
                temperatureMin: main.temp_min,
                feelsLike: main.feels_like,
                humidity: main.humidity,
                pressure: main.pressure,
                seaLevel: main.sea_level ?? null,
                groundLevel: main.grnd_level ?? null,
                sunriseUtc: sunrise,
                sunsetUtc: sunset,
                windDegree: wind.deg,
                windSpeed: wind.speed,
            },
        };
    } catch (error) {
        logger.error("failed", {duration: logger.duration(startedAt), error: error instanceof Error ? error : String(error)});
        logError(error instanceof Error ? error : String(error));
        return null;
    } finally {
        logger.debug("done", {duration: logger.duration(startedAt)});
    }
}
