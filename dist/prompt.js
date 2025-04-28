import OpenAI from "openai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { convertMcpToolsToOpenAiFormat, handleStreamingConversation as handleStreamingConversationUtil, } from "./utils/utils.js";
// Initialize OpenAI client
const openai = new OpenAI({
    baseURL: process.env.OPENAI_BASE_URL,
    maxRetries: 3,
});
// Log API configuration
console.log("API Configuration:");
console.log("Base URL:", process.env.OPENAI_BASE_URL);
console.log("Full chat completions URL:", `${process.env.OPENAI_BASE_URL}/chat/completions`);
// Tool definitions for LLM
const toolDefinitions = [
    {
        name: "get_local_maps",
        description: "Retrieve list of local maps",
        inputSchema: {
            type: "object",
            properties: {},
            required: [],
        },
    },
    {
        name: "get_current_map",
        description: "Retrieve the current map ID",
        inputSchema: {
            type: "object",
            properties: {},
            required: [],
        },
    },
    {
        name: "get_destinations",
        description: "Retrieve list of current map destinations",
        inputSchema: {
            type: "object",
            properties: {},
            required: [],
        },
    },
    {
        name: "navigate_to_destination",
        description: "Navigate to a destination by name",
        inputSchema: {
            type: "object",
            properties: {
                destinationName: {
                    type: "string",
                    description: "Name of destination (e.g., table_091)",
                },
            },
            required: ["destinationName"],
        },
    },
    {
        name: "take_picture",
        description: "Take a picture using the device camera and return Base64 string",
        inputSchema: {
            type: "object",
            properties: {},
            required: [],
        },
    },
];
// Function to create a new client connection
function createClientConnection() {
    const transport = new StdioClientTransport({
        command: "npx",
        args: [
            "-y",
            "supergateway",
            "--sse",
            "http://172.168.20.195:8080",
            "--timeout",
            "120000",
        ],
    });
    const client = new Client({
        name: "example-client",
        version: "1.0.0",
    });
    return { transport, client };
}
// Function to execute robot tool calls
async function executeRobotTool(toolName, parameters) {
    try {
        console.log(`\n=== Executing Tool: ${toolName} ===`);
        console.log("Parameters:", JSON.stringify(parameters, null, 2));
        const { transport, client } = createClientConnection();
        await client.connect(transport);
        const result = await client.callTool({
            name: toolName,
            arguments: parameters,
        });
        console.log("Tool execution result:", JSON.stringify(result, null, 2));
        return result;
    }
    catch (error) {
        console.error(`Error executing tool ${toolName}:`, error);
        throw error;
    }
}
export const prompt = async (payload) => {
    try {
        console.log("\n=== Starting Prompt Processing ===");
        console.log("User message:", payload.messages?.[0]?.content);
        if (!payload.messages?.length) {
            throw new Error("No messages provided in payload");
        }
        // Convert tools to OpenAI format
        const openAiTools = convertMcpToolsToOpenAiFormat(toolDefinitions);
        // Initialize messages array for conversation
        const messages = [
            {
                role: "system",
                content: "You are an AI assistant with access to robot control tools. You can use these tools to help users navigate and interact with the robot environment. When users ask you to do something, use the appropriate tools to help them. Don't ask for more information unless absolutely necessary. Use the tools provided in the tools array, not by writing code. For example, if user asks to go to a location, use the navigate_to_destination tool.",
            },
            ...payload.messages.map((msg) => {
                const content = typeof msg.content === "string"
                    ? msg.content
                    : JSON.stringify(msg.content);
                return {
                    role: msg.role || "user",
                    content,
                };
            }),
        ];
        // Handle streaming vs non-streaming
        const isStreaming = "stream" in payload && payload.stream === true;
        if (isStreaming) {
            return new ReadableStream({
                async start(controller) {
                    try {
                        const { transport, client } = createClientConnection();
                        await client.connect(transport);
                        await handleStreamingConversationUtil(messages, openAiTools, controller, openai, client, "gpt-4-turbo-preview");
                        controller.close();
                    }
                    catch (error) {
                        console.error("Fatal error in stream processing:", error);
                        controller.error(error);
                    }
                },
            });
        }
        else {
            const { transport, client } = createClientConnection();
            await client.connect(transport);
            // Process messages and handle tool calls
            let finalText = [];
            let isProcessing = true;
            while (isProcessing) {
                try {
                    const response = await openai.chat.completions.create({
                        model: "gpt-4-turbo-preview",
                        messages,
                        tools: openAiTools,
                        tool_choice: "auto",
                    });
                    const message = response.choices[0].message;
                    if (message.tool_calls) {
                        for (const toolCall of message.tool_calls) {
                            if (toolCall.function?.name && toolCall.function?.arguments) {
                                try {
                                    const parsedArgs = JSON.parse(toolCall.function.arguments);
                                    const result = await executeRobotTool(toolCall.function.name, parsedArgs);
                                    messages.push({
                                        role: "assistant",
                                        content: null,
                                        tool_calls: [toolCall],
                                    });
                                    messages.push({
                                        role: "tool",
                                        tool_call_id: toolCall.id,
                                        content: JSON.stringify(result),
                                    });
                                }
                                catch (error) {
                                    console.error(`Error executing tool ${toolCall.function.name}:`, error);
                                }
                            }
                        }
                    }
                    else {
                        finalText.push(message.content || "");
                        isProcessing = false;
                    }
                }
                catch (error) {
                    console.error("\n=== API Error Details ===");
                    console.error("Error:", error);
                    if (error?.response) {
                        console.error("Response status:", error.response.status);
                        console.error("Response data:", error.response.data);
                    }
                    throw error;
                }
            }
            return finalText.join("\n");
        }
    }
    catch (error) {
        console.error("\n=== Error in prompt processing ===");
        console.error("Error details:", error);
        throw new Error(`Failed to execute prompt: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
};
//# sourceMappingURL=prompt.js.map