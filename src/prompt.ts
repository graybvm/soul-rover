import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import { PromptPayload } from "./types.js";
import {
  convertMcpToolsToOpenAiFormat,
  handleStreamingConversation as handleStreamingConversationUtil,
  McpTool,
} from "./utils/utils.js";
const openAIUrl = "http://localmodel:65534/v1";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: "zzzz",
  baseURL: openAIUrl,
  maxRetries: 3,
});

// Log API configuration
console.log("API Configuration:");
console.log("Base URL:", openAIUrl);
console.log("Full chat completions URL:", `${openAIUrl}/chat/completions`);

// Function to fetch tool definitions from MCP
async function fetchToolDefinitions(): Promise<McpTool[]> {
  try {
    console.log("\n=== Fetching Tool Definitions ===");
    console.log("Creating client connection...");
    const { transport, client } = createClientConnection();

    console.log("Connecting to transport...");
    await client.connect(transport);
    console.log("Connected successfully");

    console.log("Calling listTools...");
    const response = await client.listTools();
    console.log("Raw tool list response:", JSON.stringify(response, null, 2));

    if (!response || !response.tools || !Array.isArray(response.tools)) {
      console.error("Invalid response format:", response);
      throw new Error("Invalid response from listTools");
    }

    console.log(`Successfully fetched ${response.tools.length} tools`);
    return response.tools as McpTool[];
  } catch (error: any) {
    console.error("\n=== Error in fetchToolDefinitions ===");
    console.error("Error type:", error?.constructor?.name || "Unknown");
    console.error("Error message:", error?.message || "Unknown error");
    if (error?.code) {
      console.error("Error code:", error.code);
    }
    if (error?.data) {
      console.error("Error data:", error.data);
    }
    throw new Error("Failed to fetch tool definitions from MCP");
  }
}

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
async function executeRobotTool(toolName: string, parameters: any) {
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
  } catch (error) {
    console.error(`Error executing tool ${toolName}:`, error);
    throw error;
  }
}

export const prompt = async (
  payload: PromptPayload
): Promise<string | ReadableStream<Uint8Array>> => {
  try {
    if (!!payload.ping) {
      return "online";
    }

    console.log("\n=== Starting Prompt Processing ===");
    console.log("User message:", payload.messages?.[0]?.content);

    if (!payload.messages?.length) {
      throw new Error("No messages provided in payload");
    }

    // Fetch tool definitions dynamically
    const toolDefinitions = await fetchToolDefinitions();

    // Convert tools to OpenAI format
    const openAiTools = convertMcpToolsToOpenAiFormat(toolDefinitions);

    // Initialize messages array for conversation
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content:
          "If you don't see any location, please search for that location and then navigate to it",
      },
      ...payload.messages.map((msg) => {
        const content =
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content);
        return {
          role: msg.role || "user",
          content,
        } as OpenAI.ChatCompletionMessageParam;
      }),
    ];

    // Handle streaming vs non-streaming
    const isStreaming = false;

    if (isStreaming) {
      return new ReadableStream({
        async start(controller) {
          try {
            const { transport, client } = createClientConnection();
            await client.connect(transport);

            await handleStreamingConversationUtil(
              messages,
              openAiTools,
              controller,
              openai,
              client,
              "gpt-4-turbo-preview"
            );
            controller.close();
          } catch (error) {
            console.error("Fatal error in stream processing:", error);
            controller.error(error);
          }
        },
      });
    } else {
      const { transport, client } = createClientConnection();
      await client.connect(transport);

      // Process messages and handle tool calls
      let finalText: string[] = [];
      let isProcessing = true;

      while (isProcessing) {
        try {
          const response = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages,
            tools: openAiTools,
            tool_choice: "auto" as const,
          });

          const message = response.choices[0].message;

          if (message.tool_calls) {
            for (const toolCall of message.tool_calls) {
              if (toolCall.function?.name && toolCall.function?.arguments) {
                try {
                  const parsedArgs = JSON.parse(toolCall.function.arguments);
                  const result = await executeRobotTool(
                    toolCall.function.name,
                    parsedArgs
                  );

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
                } catch (error) {
                  console.error(
                    `Error executing tool ${toolCall.function.name}:`,
                    error
                  );
                }
              }
            }
          } else {
            finalText.push(message.content || "");
            isProcessing = false;
          }
        } catch (error: any) {
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
  } catch (error) {
    console.error("\n=== Error in prompt processing ===");
    console.error("Error details:", error);
    throw new Error(
      `Failed to execute prompt: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
};
