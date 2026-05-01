
export type AiJsonPrimitive = string | number | boolean | null;
export interface AiJsonObject {
    readonly [key: string]: AiJsonValue;
}
export type AiJsonValue = AiJsonPrimitive | undefined | readonly AiJsonValue[] | AiJsonObject;
export interface AiToolParameters {
    type: "object" | "string" | "number" | "integer" | "boolean" | "array";
    properties?: Record<string, AiToolParameters>;
    required?: readonly string[];
    items?: AiToolParameters;
    enum?: readonly string[];
    description?: string;
    minItems?: number;
    maxItems?: number;
    minimum?: number;
    maximum?: number;
    default?: AiJsonValue;
    additionalProperties?: boolean | AiToolParameters;
}

export type AiTool = {
    type: "function";
    function: {
        name: string;
        description?: string;
        type?: string;
        parameters?: AiToolParameters;
    };
};

export type AiToolCall = {
    function: {
        name: string;
        arguments: AiJsonObject;
    };
};

