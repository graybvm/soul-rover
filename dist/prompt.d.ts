import { PromptPayload } from "./types.js";
export declare const prompt: (payload: PromptPayload) => Promise<string | ReadableStream<Uint8Array>>;
