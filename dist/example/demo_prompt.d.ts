import { PromptPayload } from "../types";
export declare const prompt: (payload: PromptPayload) => Promise<string | ReadableStream<Uint8Array>>;
