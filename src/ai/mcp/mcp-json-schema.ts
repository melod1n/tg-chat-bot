import type {AiJsonValue, AiToolParameters} from "../tool-types.js";
import type {BoundaryValue} from "../../common/boundary-types.js";

type JsonSchemaRecord = Record<string, BoundaryValue>;

function isRecord(value: BoundaryValue): value is JsonSchemaRecord {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toAiJsonValue(value: BoundaryValue): AiJsonValue | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;

    if (Array.isArray(value)) {
        return value.map(item => toAiJsonValue(item) ?? null);
    }

    if (!isRecord(value)) return undefined;

    const result: Record<string, AiJsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
        const normalized = toAiJsonValue(entry);
        if (normalized !== undefined) {
            result[key] = normalized;
        }
    }

    return result;
}

function normalizeType(value: BoundaryValue): AiToolParameters["type"] | undefined {
    const candidates = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : typeof value === "string"
            ? [value]
            : [];

    const prioritized = candidates.find(item => item !== "null") ?? candidates[0];
    if (!prioritized) return undefined;

    switch (prioritized) {
        case "object":
        case "string":
        case "number":
        case "integer":
        case "boolean":
        case "array":
            return prioritized;
        default:
            return undefined;
    }
}

export function convertJsonSchemaToToolParameters(schema: BoundaryValue): AiToolParameters | undefined {
    if (!isRecord(schema)) return undefined;

    const declaredType = normalizeType(schema.type);
    const inferredType = declaredType
        ?? (schema.properties !== undefined || schema.additionalProperties !== undefined ? "object" : undefined)
        ?? (schema.items !== undefined ? "array" : undefined)
        ?? "object";

    const result: AiToolParameters = {
        type: inferredType,
    };

    const description = typeof schema.description === "string" && schema.description.trim().length > 0
        ? schema.description.trim()
        : undefined;
    if (description) result.description = description;

    const defaultValue = toAiJsonValue(schema.default);
    if (defaultValue !== undefined) result.default = defaultValue;

    if (Array.isArray(schema.enum)) {
        const enumValues = schema.enum
            .filter((item): item is string => typeof item === "string" && item.length > 0);
        if (enumValues.length) result.enum = enumValues;
    }

    if (typeof schema.minItems === "number") result.minItems = schema.minItems;
    if (typeof schema.maxItems === "number") result.maxItems = schema.maxItems;
    if (typeof schema.minimum === "number") result.minimum = schema.minimum;
    if (typeof schema.maximum === "number") result.maximum = schema.maximum;

    if (Array.isArray(schema.required)) {
        const required = schema.required.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
        if (required.length) result.required = required;
    }

    if (inferredType === "object" || schema.properties !== undefined || schema.additionalProperties !== undefined) {
        if (isRecord(schema.properties)) {
            const properties: Record<string, AiToolParameters> = {};
            for (const [key, value] of Object.entries(schema.properties)) {
                const converted = convertJsonSchemaToToolParameters(value);
                if (converted) properties[key] = converted;
            }
            if (Object.keys(properties).length) result.properties = properties;
        }

        if (schema.additionalProperties !== undefined) {
            result.additionalProperties = typeof schema.additionalProperties === "boolean"
                ? schema.additionalProperties
                : convertJsonSchemaToToolParameters(schema.additionalProperties);
        }
    }

    if (inferredType === "array" || schema.items !== undefined) {
        if (Array.isArray(schema.items)) {
            const firstItem = schema.items[0];
            if (firstItem !== undefined) {
                const converted = convertJsonSchemaToToolParameters(firstItem);
                if (converted) result.items = converted;
            }
        } else {
            const converted = convertJsonSchemaToToolParameters(schema.items);
            if (converted) result.items = converted;
        }
    }

    return result;
}
