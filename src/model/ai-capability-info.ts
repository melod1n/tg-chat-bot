import {AiProvider} from "./ai-provider.js";

export type AiEndpointInfo = {
    provider?: AiProvider;
    baseUrl?: string;
    external?: boolean;
};

export type AiCapabilityInfo = {
    supported?: boolean,
    external?: boolean,
    model?: string,
    endpoint?: AiEndpointInfo,
};
