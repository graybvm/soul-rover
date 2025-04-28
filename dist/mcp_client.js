import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "supergateway", "--sse", "http://172.168.20.195:8080", "--timeout", "120000"]
});
const client = new Client({
    name: "example-client",
    version: "1.0.0"
});
async function listTools() {
    try {
        await client.connect(transport);
        console.log("Connected to server");
        // List all available tools
        console.log("\n=== Listing Available Tools ===");
        const tools = await client.listTools();
        console.log("Available tools:", JSON.stringify(tools, null, 2));
        // For each tool, get its details
        if (tools && tools.length > 0) {
            console.log("\n=== Tool Details ===");
            for (const tool of tools) {
                console.log(`\nTool: ${tool.name}`);
                console.log("Description:", tool.description);
                console.log("Parameters:", JSON.stringify(tool.parameters, null, 2));
            }
        }
        process.exit(0);
    }
    catch (error) {
        console.error("Error:", error.message);
        process.exit(1);
    }
}
// Run the tool listing
listTools();
//# sourceMappingURL=mcp_client.js.map