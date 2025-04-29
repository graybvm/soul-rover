import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: "",
});

// Tool definitions for LLM
const toolDefinitions = [
  {
    name: "get_local_maps",
    description: "Retrieve list of local maps",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_current_map",
    description: "Retrieve the current map ID",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_destinations",
    description: "Retrieve list of current map destinations",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "navigate_to_destination",
    description: "Navigate to a destination by name",
    input_schema: {
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
    input_schema: {
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
  } catch (error) {
    console.error(`Error executing tool ${toolName}:`, error);
    throw error;
  }
}

export const prompt = async (payload) => {
  try {
    console.log("\n=== Starting Prompt Processing ===");
    console.log("User message:", payload.messages?.[0]?.content);

    // Initialize messages array for conversation
    const messages = [
      { role: "user", content: payload.messages?.[0]?.content || "What can you do?" }
    ];

    // Process messages and handle tool calls
    let finalText = [];
    let currentResponse = null;
    let isProcessing = true;

    while (isProcessing) {
      // Call Claude with current messages
      currentResponse = await anthropic.messages.create({
        model: "claude-3-7-sonnet-20250219",
        max_tokens: 1024,
        messages: messages,
        tools: toolDefinitions,
      });

      console.log("\nReceived response from Claude:", JSON.stringify(currentResponse, null, 2));

      // Process each content item in the response
      for (const content of currentResponse.content) {
        if (content.type === "text") {
          finalText.push(content.text);
          continue;
        }

        if (content.type === "tool_use") {
          const result = await executeRobotTool(content.name, content.input);

          // Add tool call and result to messages
          messages.push({
            role: "assistant",
            content: [content]
          });
          messages.push({
            role: "user",
            content: [{
              type: "tool_result",
              tool_use_id: content.id,
              content: result.content
            }]
          });

          // Get next response from Claude
          currentResponse = await anthropic.messages.create({
            model: "claude-3-7-sonnet-20250219",
            max_tokens: 1024,
            messages: messages,
            tools: toolDefinitions,
          });

          if (currentResponse.content.length > 0) {
            if (currentResponse.content[0].type === "text") {
              finalText.push(currentResponse.content[0].text);
            } else if (currentResponse.content[0].type === "tool_use") {
              // Continue processing if there are more tool calls
              continue;
            }
          }
        }
      }

      // Check if we should continue processing
      if (currentResponse.content.length === 0 || 
          (currentResponse.content.length === 1 && currentResponse.content[0].type === "text")) {
        isProcessing = false;
      }
    }

    return finalText.join("\n");
  } catch (error) {
    console.error("\n=== Error in prompt processing ===");
    console.error("Error details:", error);
    return `Error: ${error.message}`;
  }
};
