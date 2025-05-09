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
// const openAIUrl = "http://localhost:65534/v1";

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
            let hasImageResult = false;
            for (const toolCall of message.tool_calls) {
              if (toolCall.function?.name && toolCall.function?.arguments) {
                try {
                  let parsedArgs = JSON.parse(toolCall.function.arguments);
                  let result;

                  // If the tool call is to navigateTo, search for locations
                  if (toolCall.function.name === "navigate_to_destination") {
                    const locationQuery = parsedArgs.location || parsedArgs.destination;
                    if (locationQuery) {
                      // Call tool to search for locations
                      const searchResult = await executeRobotTool("get_destinations", {
                        query: locationQuery,
                      });
                      const searchResultParsed = JSON.parse(
                        typeof searchResult === "string" ? searchResult : JSON.stringify(searchResult)
                      );

                      // Send the list of locations to LLM
                      const locationsList = searchResultParsed.locations || [];
                      if (locationsList.length > 0) {
                        const locationSelectionPrompt: OpenAI.ChatCompletionSystemMessageParam = {
                          role: "system",
                          content: `
                            User requested to navigate to "${locationQuery}". Here is a list of available locations:
                            ${locationsList.map((loc: any) => `- ${loc.name}`).join("\n")}
                            Select the most relevant location name (case-sensitive) that best matches "${locationQuery}". Return only the exact location name.
                          `,
                        };

                        // Call LLM to select the best match
                        const selectionResponse = await openai.chat.completions.create({
                          model: "gpt-4-turbo-preview",
                          messages: [
                            locationSelectionPrompt,
                            { role: "user", content: `Select the best match for "${locationQuery}".` },
                          ],
                          tools: openAiTools,
                          tool_choice: "auto" as const,
                        });

                        const selectedLocation = selectionResponse.choices[0].message.content?.trim();
                        if (selectedLocation) {
                          // Update parsedArgs with the exact location name
                          parsedArgs.location = selectedLocation;
                        } else {
                          throw new Error(`No matching location found for "${locationQuery}".`);
                        }
                      } else {
                        throw new Error(`No locations found for query "${locationQuery}".`);
                      }
                    }
                  }

                  // Execute tool with standardized arguments
                  result = await executeRobotTool(toolCall.function.name, parsedArgs);

                  // Check if tool returned an image
                  const toolResult = JSON.parse(
                    typeof result === "string" ? result : JSON.stringify(result)
                  );
                  const imageContent = toolResult.content?.find(
                    (item: any) => item.type === "image" && item.mimeType === "image/jpeg"
                  );

                  if (imageContent && imageContent.data) {
                    hasImageResult = true;
                  }

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
                  console.error(`Error executing tool ${toolCall.function.name}:`, error);
                  // Check if error is an Error object and has a message
                  const errorMessage = error instanceof Error ? error.message : String(error);
                  messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ error: errorMessage }),
                  });
                }
              }
            }

            // Exit loop if an image was received
            if (hasImageResult) {
              isProcessing = false;
              const lastToolMessage = messages
                .filter((msg) => msg.role === "tool")
                .pop();

              let responseContent = "Error processing image.";
              if (lastToolMessage && lastToolMessage.content) {
                try {
                  let toolResult;
                  if (typeof lastToolMessage.content === "string") {
                    toolResult = JSON.parse(lastToolMessage.content);
                  } else if (Array.isArray(lastToolMessage.content)) {
                    const textPart = lastToolMessage.content.find(
                      (part) => part.type === "text"
                    );
                    if (textPart && "text" in textPart) {
                      toolResult = JSON.parse(textPart.text);
                    } else {
                      throw new Error("No valid text content found in tool message");
                    }
                  } else {
                    throw new Error("Unexpected content type in tool message");
                  }

                  const imageContent = toolResult.content?.find(
                    (item: any) => item.type === "image" && item.mimeType === "image/jpeg"
                  );

                  if (imageContent && imageContent.data) {
                    const base64Image = imageContent.data;
                    responseContent = `Picture taken!<br><img src="data:image/jpeg;base64,${base64Image}" alt="Captured image" />`;
                    messages.push({
                      role: "assistant",
                      content: responseContent,
                    });
                  }
                } catch (error) {
                  console.error("Error parsing tool result:", error);
                }
              }

              finalText.push(responseContent);
            }
          } else {
            let responseContent = message.content || "";
            const lastToolMessage = messages
              .filter((msg) => msg.role === "tool")
              .pop();

            if (lastToolMessage && lastToolMessage.content) {
              try {
                let toolResult;
                if (typeof lastToolMessage.content === "string") {
                  toolResult = JSON.parse(lastToolMessage.content);
                } else if (Array.isArray(lastToolMessage.content)) {
                  const textPart = lastToolMessage.content.find(
                    (part) => part.type === "text"
                  );
                  if (textPart && "text" in textPart) {
                    toolResult = JSON.parse(textPart.text);
                  } else {
                    throw new Error("No valid text content found in tool message");
                  }
                } else {
                  throw new Error("Unexpected content type in tool message");
                }

                const imageContent = toolResult.content?.find(
                  (item: any) => item.type === "image" && item.mimeType === "image/jpeg"
                );

                if (imageContent && imageContent.data) {
                  const base64Image = imageContent.data;
                  responseContent = `Picture taken!<br><img src="data:image/jpeg;base64,${base64Image}" alt="Captured image" />`;
                  messages.push({
                    role: "assistant",
                    content: responseContent,
                  });
                }
              } catch (error) {
                console.error("Error parsing tool result:", error);
                responseContent = "Error processing image, please try again.";
              }
            }

            finalText.push(responseContent);
            isProcessing = false;
            // console.log("message", message);
            // console.log("finalText", finalText);
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