// import { Client } from "@modelcontextprotocol/sdk/client/index.js";
// import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// import OpenAI from "openai";

// import {
//   CLIENT_NAME,
//   CLIENT_VERSION,
//   MCP_SERVER_URL,
//   MODEL,
//   OPENAI_API_KEY,
//   OPENAI_BASE_URL,
// } from "../constants";

// import {
//   appendScreenshot,
//   convertMcpToolsToOpenAiFormat,
//   ensureConnection,
//   handleNonStreamingConversation,
//   handleStreamingConversation,
//   McpTool,
// } from "../utils/utils";
// import { PromptPayload } from "../types";

// // Initialize OpenAI client with retry configuration
// const openAI = new OpenAI({
//   apiKey: OPENAI_API_KEY,
//   baseURL: OPENAI_BASE_URL,
//   maxRetries: 3,
// });

// // Initialize MCP client
// const client = new Client(
//   {
//     name: CLIENT_NAME,
//     version: CLIENT_VERSION,
//   },
//   {
//     capabilities: {},
//   }
// );

// // Use Studio transport
// const transport = new StdioClientTransport({
//   command: process.env.NODE_ENV === "production" ? "node" : "tsx",
//   env: {
//     ...process.env,
//     NODE_ENV:
//       process.env.NODE_ENV === "production" ? "production" : "development",
//     EXA_API_KEY: "sk-ant-api03-1234567890",
//   },
//   args: [
//     MCP_SERVER_URL,
//     "--tools=web_search,research_paper_search,twitter_search,company_research,crawling,competitor_finder,linkedin_search",
//   ],
// });

// client.connect(transport);

// export const prompt = async (
//   payload: PromptPayload
// ): Promise<string | ReadableStream<Uint8Array>> => {
//   console.log("Starting prompt with payload:", payload);

//   if (!payload.messages?.length) {
//     throw new Error("No messages provided in payload");
//   }

//   try {
//     await ensureConnection(client, transport);
//     console.log("Connected to MCP server");

//     const availableTools = await client.listTools();
//     const openAiTools = convertMcpToolsToOpenAiFormat(
//       availableTools as unknown as McpTool[]
//     );

//     // Initialize messages with system message and user payload
//     const messages: Array<OpenAI.ChatCompletionMessageParam> = [
//       {
//         role: "system",
//         content: `You are an AI assistant with access to powerful web search and research tools through the Exa MCP server. You can use the following tools to help users.
// Use these tools thoughtfully and efficiently to provide accurate, up-to-date information to users. Always verify information from multiple sources when possible.`,
//       },
//       ...(payload.messages as Array<OpenAI.ChatCompletionMessageParam>),
//     ];
//     // Handle streaming vs non-streaming
//     const isStreaming = "stream" in payload && payload.stream === true;
//     // Handle streaming vs non-streaming
//     if (isStreaming) {
//       return new ReadableStream({
//         async start(controller) {
//           try {
//             await handleStreamingConversation(
//               messages,
//               openAiTools,
//               controller,
//               openAI,
//               client,
//               MODEL
//             );
//           } catch (error) {
//             console.error("Fatal error in stream processing:", error);
//             controller.error(error);
//           }
//         },
//       });
//     } else {
//       let response = await handleNonStreamingConversation(
//         messages,
//         openAiTools,
//         openAI,
//         client,
//         MODEL
//       );
//       const screenshots = await appendScreenshot(client);
//       if (screenshots.length > 0) {
//         response += screenshots.join("\n");
//       }
//       return response;
//     }
//   } catch (error) {
//     console.error("Error in prompt execution:", error);
//     throw new Error(
//       `Failed to execute prompt: ${
//         error instanceof Error ? error.message : "Unknown error"
//       }`
//     );
//   }
// };
