import {AiJsonObject, AiJsonValue} from "../tool-types";
import type {ToolRuntimeContext} from "./runtime.js";

export type ToolHandler = (args?: AiJsonObject, context?: ToolRuntimeContext) => Promise<AiJsonValue | string | null | undefined> | AiJsonValue | string | null | undefined;
