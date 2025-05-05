import "dotenv/config";
import express from "express";
import cors from "cors";
import { prompt } from "./prompt.js";
import { PromptPayload } from "./types.js";

// Log environment variables
console.log("Environment variables:");
console.log("OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? "Set" : "Not set");
console.log("OPENAI_BASE_URL:", process.env.OPENAI_BASE_URL);

const app = express();
const port = 80;

// Middleware
app.use(cors());
app.use(express.json());

// SSE endpoint
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Send initial connection message
  res.write('data: {"status": "connected"}\n\n');

  // Keep connection alive
  const keepAlive = setInterval(() => {
    res.write('data: {"type": "ping"}\n\n');
  }, 15000);

  // Handle client disconnect
  req.on("close", () => {
    clearInterval(keepAlive);
    console.log("Client disconnected");
  });
});

// Version endpoint
app.get("/api/version", (req, res) => {
  res.json({
    version: "1.0.0",
    name: "demo-api",
    description: "Demo API for MCP client",
  });
});

// Prompt endpoint
app.post("/prompt", async (req, res) => {
  try {
    const payload: PromptPayload = req.body;
    const result = await prompt(payload);
    console.log(result);
    res.setHeader("Content-Type", "text/plain");
    res.send(result);
  } catch (error) {
    console.error("Error in prompt endpoint:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
