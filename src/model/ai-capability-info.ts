import {AiProvider} from "./ai-provider";

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
