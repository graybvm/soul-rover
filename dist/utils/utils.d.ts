import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import { ChatCompletionChunk } from "openai/resources/chat/completions";
import { ReadableStreamDefaultController } from "stream/web";
export interface McpTool {
    name: string;
    description: string;
    inputSchema?: {
        type: string;
        properties?: Record<string, unknown>;
        required?: string[];
    };
}
export interface McpToolsResponse {
    tools?: McpTool[];
}
export interface McpToolExecuteResponse {
    content: Array<{
        type: "text";
        text: string;
    }>;
    isError?: boolean;
}
export declare class McpToolError extends Error {
    readonly toolName: string;
    readonly args: unknown;
    constructor(message: string, toolName: string, args: unknown);
}
export declare const compareToolName: (openaiToolName: string | undefined, mcpToolName: string | undefined) => boolean;
export declare const convertMcpToolsToOpenAiFormat: (mcpTools: McpToolsResponse | McpTool[] | Record<string, unknown>) => OpenAI.ChatCompletionTool[];
export declare const executeToolCall: (toolName: string, args: Record<string, unknown>, client: Client) => Promise<McpToolExecuteResponse | null>;
export declare const processToolCalls: (toolCalls: OpenAI.ChatCompletionMessageToolCall[], client: Client) => Promise<string[]>;
export interface ToolCallResult {
    type: "tool_call" | "assistant_message" | "complete";
    content: string;
    toolCalls?: OpenAI.ChatCompletionMessageToolCall[];
    toolResults?: string[];
}
export declare const enqueueMessage: (stop: boolean, content: string, model: string) => ChatCompletionChunk;
export declare function ensureConnection(client: Client, transport: StdioClientTransport, retries?: number): Promise<void>;
export declare function processConversationTurn(messages: Array<OpenAI.ChatCompletionMessageParam>, availableTools: OpenAI.ChatCompletionTool[], usedToolNames: Set<string>, openAI: OpenAI, client: Client, MODEL: string): Promise<ToolCallResult>;
export declare const appendScreenshot: (client: Client) => Promise<string[]>;
export declare function handleNonStreamingConversation(messages: Array<OpenAI.ChatCompletionMessageParam>, availableTools: OpenAI.ChatCompletionTool[], openAI: OpenAI, client: Client, MODEL: string): Promise<string>;
export declare function handleStreamingConversation(messages: Array<OpenAI.ChatCompletionMessageParam>, availableTools: OpenAI.ChatCompletionTool[], controller: ReadableStreamDefaultController<Uint8Array>, openAI: OpenAI, client: Client, MODEL: string): Promise<void>;
interface ResourceResponse {
    contents: Array<{
        uri: string;
        mimeType?: string;
        blob?: Uint8Array;
        text?: string;
    }>;
}
export declare function getResource(client: Client, resourceUri: string): Promise<ResourceResponse | null>;
export {};
