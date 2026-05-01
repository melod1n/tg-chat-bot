import {Ollama} from "ollama";
import {toolsLogger} from "./tool-logger";
import {AiJsonObject, AiJsonValue} from "../tool-types";
import type {BoundaryValue} from "../../common/boundary-types";

const logger = toolsLogger.child("utils");

export function asNonEmptyString(value: BoundaryValue): string | undefined {
    return typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : undefined;
}

export function normalizeToolArguments(args: string | AiJsonObject | undefined, userId?: number | null): AiJsonObject {
    if (!args) return {};

    if (typeof args === "string") {
        try {
            const parsed = JSON.parse(args) as AiJsonValue;

            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return parsed as AiJsonObject;
            }
        } catch {
            return {
                raw: args,
            };
        }

        return {};
    }

    if (typeof args === "object" && !Array.isArray(args)) {
        const userIdObject = userId ? {"userId": userId} : {};
        return {
            ...args,
            ...userIdObject,
        } as AiJsonObject;
    }

    return {};
}

export function asBoolean(value: BoundaryValue, defaultValue = false): boolean {
    if (typeof value === "boolean") return value;

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();

        if (normalized === "true") return true;
        if (normalized === "false") return false;
    }

    return defaultValue;
}

export function asString(value: BoundaryValue, defaultValue = ""): string {
    return typeof value === "string" ? value : defaultValue;
}

export function asPositiveInt(value: BoundaryValue, defaultValue: number, maxValue: number): number {
    const n = typeof value === "number"
        ? value
        : typeof value === "string"
            ? Number(value)
            : NaN;

    if (!Number.isFinite(n) || n <= 0) return defaultValue;

    return Math.min(Math.floor(n), maxValue);
}

export async function unloadAllOllamaModels(ollama: Ollama, exceptFor?: string[]) {
    try {
        const runningModels = await ollama.ps();
        const modelsToUnload = runningModels.models
            .filter(m => !exceptFor?.includes(m.model));

        const unloadPromises = modelsToUnload
            .map(model =>
                ollama.generate({
                    model: model.name,
                    keep_alive: 0,
                    stream: false,
                    prompt: ""
                })
            );

        await Promise.all(unloadPromises);
        logger.info("ollama.unload_all.done", {count: modelsToUnload.length, exceptFor});
    } catch (error) {
        logger.error("ollama.unload_all.failed", {exceptFor, error: error instanceof Error ? error : String(error)});
    }
}

export async function loadOllamaModel(model: string, ollama: Ollama, contextLength: number): Promise<boolean> {
    try {
        logger.info("ollama.load.start", {model, contextLength});
        await ollama.generate({
            model: model,
            stream: false,
            prompt: "",
            options: {
                num_ctx: contextLength
            }
        });
        logger.info("ollama.load.done", {model, contextLength});
        return true;
    } catch (error) {
        logger.error("ollama.load.failed", {model, contextLength, error: error instanceof Error ? error : String(error)});
        return false;
    }
}
