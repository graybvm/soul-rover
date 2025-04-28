import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import { ChatCompletionChunk } from "openai/resources/chat/completions";
import { ReadableStreamDefaultController } from "stream/web";
import { v4 as uuidv4 } from "uuid";

// Store screenshot URIs globally
const screenshotUris: string[] = [];

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

export class McpToolError extends Error {
  constructor(
    message: string,
    public readonly toolName: string,
    public readonly args: unknown
  ) {
    super(message);
    this.name = "McpToolError";
  }
}

export const compareToolName = (
  openaiToolName: string | undefined,
  mcpToolName: string | undefined
): boolean => {
  if (!openaiToolName || !mcpToolName) return false;
  return mcpToolName.toLowerCase() === openaiToolName.toLowerCase();
};

export const convertMcpToolsToOpenAiFormat = (
  mcpTools: McpToolsResponse | McpTool[] | Record<string, unknown>
): OpenAI.ChatCompletionTool[] => {
  console.debug("Input mcpTools:", mcpTools);

  const toolsList = (
    Array.isArray(mcpTools)
      ? mcpTools
      : "tools" in mcpTools
      ? mcpTools.tools ?? []
      : Array.isArray((mcpTools as Record<string, McpTool[]>).tools)
      ? (mcpTools as Record<string, McpTool[]>).tools
      : []
  ) as McpTool[];

  console.debug("Processing", toolsList.length, "tools");

  return toolsList
    .filter(
      (tool: unknown): tool is McpTool =>
        typeof tool === "object" &&
        tool !== null &&
        "name" in tool &&
        "description" in tool
    )
    .map((tool: McpTool) => {
      console.debug("Processing tool:", tool.name);
      const toolSchema = {
        type: "object",
        properties:
          (tool.inputSchema as { properties?: Record<string, unknown> })
            ?.properties ?? {},
        required: (tool.inputSchema as { required?: string[] })?.required ?? [],
      };

      const openAiTool: OpenAI.ChatCompletionTool = {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: toolSchema,
        },
      };

      console.debug("Converted tool", tool.name, "to OpenAI format");
      return openAiTool;
    });
};

export const executeToolCall = async (
  toolName: string,
  args: Record<string, unknown>,
  client: Client
): Promise<McpToolExecuteResponse | null> => {
  try {
    console.log("Execute tool call: ", toolName, args);
    const res = (await client.callTool({
      name: toolName,
      arguments: args,
    })) as McpToolExecuteResponse;

    if (res.isError) {
      throw new McpToolError(
        `Tool execution failed: ${toolName}`,
        toolName,
        args
      );
    }

    return res;
  } catch (error) {
    console.error(
      `Error executing tool ${toolName}:`,
      error instanceof Error ? error.message : "Unknown error"
    );
    return null;
  }
};

export const processToolCalls = async (
  toolCalls: OpenAI.ChatCompletionMessageToolCall[],
  client: Client
): Promise<string[]> => {
  const results: string[] = [];

  for (const call of toolCalls) {
    const {
      function: { name, arguments: args },
    } = call;

    try {
      const parsedArgs = JSON.parse(args);
      const result = await executeToolCall(name, parsedArgs, client);

      if (result?.content?.[0]?.text) {
        // Store screenshot URI if found
        if (
          name === "browserbase_screenshot" &&
          result.content[0].text.includes("screenshot://")
        ) {
          const uriMatch = result.content[0].text.match(
            /screenshot:\/\/[^\s]+/
          );
          if (uriMatch) {
            const screenshotUri = uriMatch[0];
            screenshotUris.push(screenshotUri);
          }
        }
        results.push(result.content[0].text);
      }
    } catch (error) {
      if (error instanceof McpToolError) {
        console.error(`Tool execution error for ${name}:`, error.message);
      } else {
        console.error(`Unexpected error executing tool ${name}:`, error);
      }
    }
  }

  return results;
};

export interface ToolCallResult {
  type: "tool_call" | "assistant_message" | "complete";
  content: string;
  toolCalls?: OpenAI.ChatCompletionMessageToolCall[];
  toolResults?: string[];
}

export const enqueueMessage = (
  stop: boolean,
  content: string,
  model: string
): ChatCompletionChunk => {
  return {
    id: uuidv4(),
    object: "chat.completion.chunk",
    created: new Date().getTime(),
    model: model,
    choices: [
      {
        index: 0,
        delta: {
          content: content,
        },
        logprobs: null,
        finish_reason: stop ? "stop" : null,
      },
    ],
  };
};

export async function ensureConnection(
  client: Client,
  transport: StdioClientTransport,
  retries = 3
): Promise<void> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      if (!(await client.ping())) {
        await client.connect(transport);
      }
      return;
    } catch (error) {
      if (attempt === retries - 1) {
        throw new Error(
          `Failed to connect to MCP server after ${retries} attempts: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, 1000 * Math.pow(2, attempt))
      );
    }
  }
}

export async function processConversationTurn(
  messages: Array<OpenAI.ChatCompletionMessageParam>,
  availableTools: OpenAI.ChatCompletionTool[],
  usedToolNames: Set<string>,
  openAI: OpenAI,
  client: Client,
  MODEL: string
): Promise<ToolCallResult> {
  const availableToolsForRequest = availableTools.filter(
    (tool) => !usedToolNames.has(tool.function.name)
  );

  const response = await openAI.chat.completions.create({
    model: MODEL,
    messages,
    tools:
      availableToolsForRequest.length > 0
        ? availableToolsForRequest
        : undefined,
  });

  const { finish_reason, message } = response.choices[0];

  if (
    finish_reason === "stop" ||
    !message.tool_calls ||
    message.tool_calls.length === 0
  ) {
    return {
      type: "complete",
      content: message.content || "",
    };
  }

  if (message.content) {
    return {
      type: "assistant_message",
      content: message.content,
    };
  }

  if (message.tool_calls && message.tool_calls.length > 0) {
    const results = await processToolCalls(message.tool_calls, client);
    message.tool_calls.forEach((toolCall) => {
      usedToolNames.add(toolCall.function.name);
    });

    return {
      type: "tool_call",
      content: results.join("\n"),
      toolCalls: message.tool_calls,
      toolResults: results,
    };
  }

  return {
    type: "complete",
    content: message.content || "",
  };
}

export const appendScreenshot = async (client: Client): Promise<string[]> => {
  const results: string[] = [];
  // Append base64 images for all stored screenshot URIs
  if (screenshotUris.length > 0) {
    for (const uri of screenshotUris) {
      try {
        const resource = await getResource(client, uri);
        if (resource && resource.contents[0]?.blob) {
          results.push(
            `\n![Screenshot](data:image/png;base64,${resource.contents[0].blob})`
          );
        }
      } catch (error) {
        console.error(`Error appending screenshot ${uri}:`, error);
      }
    }
    // Clear the URIs array after processing
    screenshotUris.length = 0;
  }
  return results;
};

export async function handleNonStreamingConversation(
  messages: Array<OpenAI.ChatCompletionMessageParam>,
  availableTools: OpenAI.ChatCompletionTool[],
  openAI: OpenAI,
  client: Client,
  MODEL: string
): Promise<string> {
  try {
    let lastResponse = "";
    let attempt = 0;
    const MAX_ATTEMPTS = 20;
    const usedToolNames = new Set<string>();

    while (attempt < MAX_ATTEMPTS) {
      attempt++;
      console.log(`Processing attempt ${attempt}/${MAX_ATTEMPTS}`);

      try {
        const availableToolsForRequest = availableTools.filter(
          (tool) => !usedToolNames.has(tool.function.name)
        );

        const chatPayload = {
          model: MODEL,
          messages,
          temperature: 0,
          seed: 0,
          tools:
            availableToolsForRequest.length > 0
              ? availableToolsForRequest
              : undefined,
        };

        console.log(
          "Sending chat completion request with payload:",
          chatPayload
        );

        const response = await openAI.chat.completions.create(chatPayload);
        const { finish_reason, message } = response.choices[0];

        if (message.content) {
          lastResponse = message.content;
        }

        messages.push({
          role: "assistant",
          content: message.content || "",
          tool_calls: message.tool_calls || undefined,
        } as OpenAI.ChatCompletionAssistantMessageParam);

        if (
          finish_reason === "stop" ||
          !message.tool_calls ||
          message.tool_calls.length === 0
        ) {
          return lastResponse;
        }

        const toolResults = await Promise.all(
          message.tool_calls.map(async (toolCall) => {
            const {
              id,
              function: { name },
            } = toolCall;
            usedToolNames.add(name);

            try {
              const result = await processToolCalls([toolCall], client);
              let toolResponse = result.join("\n");

              messages.push({
                role: "tool",
                tool_call_id: id,
                content: toolResponse,
              } as OpenAI.ChatCompletionToolMessageParam);

              return toolResponse;
            } catch (error) {
              console.error(`Error executing tool ${name}:`, error);
              const errorMessage = `Error: ${
                error instanceof Error ? error.message : "Unknown error"
              }`;

              messages.push({
                role: "tool",
                tool_call_id: id,
                content: errorMessage,
              } as OpenAI.ChatCompletionToolMessageParam);

              return errorMessage;
            }
          })
        );
        if (
          !lastResponse.includes(
            "Screenshot taken. Resource URI: screenshot://"
          )
        ) {
          lastResponse = toolResults.join("\n");
        }
      } catch (error) {
        console.error(`Error in conversation attempt ${attempt}:`, error);
        if (attempt === MAX_ATTEMPTS) {
          throw error;
        }
      }
    }
    return lastResponse;
  } catch (error) {
    console.error("Error in prompt execution:", error);
    throw new Error(
      `Failed to execute prompt: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

export async function handleStreamingConversation(
  messages: Array<OpenAI.ChatCompletionMessageParam>,
  availableTools: OpenAI.ChatCompletionTool[],
  controller: ReadableStreamDefaultController<Uint8Array>,
  openAI: OpenAI,
  client: Client,
  MODEL: string
): Promise<void> {
  let isStreamClosed = false;

  try {
    const encoder = new TextEncoder();
    let lastResponse = "";
    let attempt = 0;
    const MAX_ATTEMPTS = 20;
    const usedToolNames = new Set<string>();
    let isFirstMessage = true;

    const writeToStream = async (data: any) => {
      if (isStreamClosed) {
        console.log("Stream is closed, skipping write:", data);
        return;
      }

      const stepDescription = (() => {
        switch (data.type) {
          // case "state":
          //   const availableToolArray = availableTools
          //     .filter((t) => !usedToolNames.has(t.function.name))
          //     .map((t) => t.function.name);
          //   const totalTools = availableToolArray.length;
          //   return `Step ${
          //     data.attempt
          //   }: Starting new processing attempt. Available tools (${totalTools} total(s)): ${availableToolArray
          //     .slice(0, 3)
          //     .join(", ")}${totalTools > 3 ? "..." : ""}. ${
          //     data.attempt > 1
          //       ? `Remaining attempts: ${data.maxAttempts - (data.attempt - 1)}`
          //       : `Max attempts: ${data.maxAttempts}`
          //   }`;
          case "assistant_message":
            return `<task>💬 Assistant: ${data.content}</task>`;
          case "tool_calls":
            if (!data.tools) return "<task>🛠 Using tools...</task>";

            const toolNames = data.tools
              .slice(0, 3)
              .map(
                (t: { name: string; arguments: Record<string, unknown> }) => {
                  // Simplify arguments to a readable format
                  const args = Object.entries(t.arguments)
                    .map(([key, value]) => {
                      // Convert value to string and truncate if needed
                      let strValue =
                        typeof value === "string"
                          ? value
                          : JSON.stringify(value);
                      if (strValue.length > 120) {
                        strValue = strValue.substring(0, 117) + "...";
                      }
                      return `${key}: ${strValue}`;
                    })
                    .slice(0, 2) // Only show first 2 arguments
                    .join(", ");
                  return `${t.name}(${args}${
                    Object.keys(t.arguments).length > 2 ? ", ..." : ""
                  })`;
                }
              )
              .join(", ");
            return `<task>🛠 Using ${
              data.tools.length > 1 ? "these tools" : "this tool"
            }: ${toolNames}${
              data.tools.length > 3 ? " (and more)" : ""
            }</task>`;

          case "tool_results":
            if (!data.results || data.results.length === 0) {
              return `<task>📝 No results found from the tools</task>`;
            }

            const results = data.results.map((r: string | object) => {
              let strResult = typeof r === "object" ? JSON.stringify(r) : r;
              strResult = strResult
                ?.replace(/\\n/g, " ")
                ?.replace(/\n/g, " ")
                ?.replace(/\s+/g, " ")
                ?.trim();
              return strResult.length > 120
                ? strResult.substring(0, 117) + "..."
                : strResult;
            });

            return `<task>📝 Here's what I found: ${results}</task>`;
          // case "complete":
          //   return `Process Complete: ${data.finalResponse}`;
          case "error":
            return `<task>❌ Oops! Something went wrong on attempt ${data.attempt}: ${data.message}</task>`;
          default:
            return isFirstMessage
              ? `<task>⏳ Processing your request...</task>`
              : "";
        }
      })();

      let content = "";
      if (isFirstMessage) {
        content = `<think>\n${stepDescription}`;
        isFirstMessage = false;
      } else if (data.type === "complete") {
        const screenshots = await appendScreenshot(client);
        content = `</think>\n${data.finalResponse}\n${screenshots.join("\n")}`;
      } else {
        content = `\n${stepDescription}`;
      }

      try {
        if (content !== "" && content !== "\n") {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify(
                enqueueMessage(data.type === "complete", content, MODEL)
              )}\n\n`
            )
          );
        }

        if (data.type === "complete") {
          isStreamClosed = true;
          controller.close();
        }
      } catch (error) {
        console.error("Error writing to stream:", error);
        isStreamClosed = true;
      }
    };

    while (attempt < MAX_ATTEMPTS && !isStreamClosed) {
      attempt++;
      console.log(`Processing attempt ${attempt}/${MAX_ATTEMPTS}`);

      try {
        writeToStream({
          type: "state",
          attempt,
          maxAttempts: MAX_ATTEMPTS,
          toolsAvailable: availableTools.filter(
            (t) => !usedToolNames.has(t.function.name)
          ).length,
        });

        const availableToolsForRequest = availableTools.filter(
          (tool) => !usedToolNames.has(tool.function.name)
        );

        const chatPayload = {
          model: MODEL,
          messages,
          temperature: 0,
          seed: 0,
          tools:
            availableToolsForRequest.length > 0
              ? availableToolsForRequest
              : undefined,
        };

        console.log(
          "Sending chat completion request with payload:",
          chatPayload
        );

        const response = await openAI.chat.completions.create(chatPayload);
        const { finish_reason, message } = response.choices[0];

        if (message.content) {
          lastResponse = message.content;
        }

        messages.push({
          role: "assistant",
          content: message.content || "",
          tool_calls: message.tool_calls || undefined,
        } as OpenAI.ChatCompletionAssistantMessageParam);

        if (
          finish_reason === "stop" ||
          !message.tool_calls ||
          message.tool_calls.length === 0
        ) {
          await writeToStream({
            type: "complete",
            finalResponse: lastResponse,
          });
          return;
        }

        if (message.content) {
          await writeToStream({
            type: "assistant_message",
            content: message?.content,
          });
        }

        await writeToStream({
          type: "tool_calls",
          tools: message.tool_calls.map((call) => ({
            name: call.function.name,
            arguments: JSON.parse(call.function.arguments),
          })),
        });

        const toolResults = await Promise.all(
          message.tool_calls.map(async (toolCall) => {
            const {
              id,
              function: { name },
            } = toolCall;
            usedToolNames.add(name);

            try {
              const result = await processToolCalls([toolCall], client);
              let toolResponse = result.join("\n");

              messages.push({
                role: "tool",
                tool_call_id: id,
                content: toolResponse,
              } as OpenAI.ChatCompletionToolMessageParam);

              return toolResponse;
            } catch (error) {
              console.error(`Error executing tool ${name}:`, error);
              const errorMessage = `Error: ${
                error instanceof Error ? error.message : "Unknown error"
              }`;

              messages.push({
                role: "tool",
                tool_call_id: id,
                content: errorMessage,
              } as OpenAI.ChatCompletionToolMessageParam);

              return errorMessage;
            }
          })
        );

        if (!isStreamClosed) {
          await writeToStream({
            type: "tool_results",
            results: toolResults,
          });
        }

        if (
          !toolResults.includes("Screenshot taken. Resource URI: screenshot://")
        ) {
          lastResponse = toolResults.join("\n");
        }
      } catch (error) {
        console.error(`Error in conversation attempt ${attempt}:`, error);
        if (!isStreamClosed) {
          await writeToStream({
            type: "error",
            message: error instanceof Error ? error.message : "Unknown error",
            attempt,
          });
        }
        if (attempt === MAX_ATTEMPTS) {
          if (!isStreamClosed) {
            controller.error(error);
          }
          return;
        }
      }
    }
  } catch (error) {
    console.error("Error in streaming conversation:", error);
    if (!isStreamClosed) {
      controller.error(
        new Error(
          `Failed to execute streaming conversation: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        )
      );
    }
  }
}

interface ResourceResponse {
  contents: Array<{
    uri: string;
    mimeType?: string;
    blob?: Uint8Array;
    text?: string;
  }>;
}

export async function getResource(
  client: Client,
  resourceUri: string
): Promise<ResourceResponse | null> {
  const response = (await client.readResource({
    uri: resourceUri,
  })) as ResourceResponse;
  return response;
}