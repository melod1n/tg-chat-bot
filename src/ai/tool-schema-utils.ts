import type {BoundaryValue} from "../common/boundary-types.js";

function isRecord(value: BoundaryValue): value is Record<string, BoundaryValue> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asOptionalString(value: BoundaryValue): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function toolSchemaName(tool: BoundaryValue): string | undefined {
    if (!isRecord(tool)) return undefined;
    const fn = isRecord(tool.function) ? tool.function : undefined;
    const directName = fn?.name ?? tool.name ?? (typeof tool.type === "string" && tool.type !== "function" ? tool.type : undefined);
    return asOptionalString(directName);
}

export function toolSchemaNames(tool: BoundaryValue): string[] {
    if (!isRecord(tool)) return [];

    if (Array.isArray(tool.functionDeclarations)) {
        return tool.functionDeclarations
            .map(declaration => isRecord(declaration) ? asOptionalString(declaration.name) : undefined)
            .filter((name): name is string => !!name);
    }

    const name = toolSchemaName(tool);
    return name ? [name] : [];
}

export function allToolSchemaNames(tools: readonly BoundaryValue[]): string[] {
    return [...new Set(tools.flatMap(toolSchemaNames))];
}
