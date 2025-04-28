// Client configuration
export const CLIENT_NAME = "mcp-server-client";
export const CLIENT_VERSION = "1.0.0";
// Model configuration
export const OPENAI_API_KEY = "sk-proj-1234567890";
export const OPENAI_BASE_URL = process.env.NODE_ENV === "production"
    ? "http://localmodel:65534"
    : "http://localhost:65534";
export const MODEL = "gpt-4.1-mini";
export const ETERNALAI_MCP_PROXY_URL = process.env.NODE_ENV === "production"
    ? "http://84532-proxy/prompt"
    : "http://localhost:1111/prompt";
export const MCP_SERVER_URL = process.env.NODE_ENV === "production"
    ? "./dist/src/mcp-server/index.js"
    : "./src/mcp-server/index.ts";
//# sourceMappingURL=constants.js.map