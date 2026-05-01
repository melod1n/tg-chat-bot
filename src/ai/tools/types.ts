import {AiJsonObject, AiJsonValue} from "../tool-types";

export type ToolHandler = (args?: AiJsonObject) => Promise<AiJsonValue | string | null | undefined> | AiJsonValue | string | null | undefined;
