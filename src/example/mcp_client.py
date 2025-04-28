from anthropic import Anthropic
from fastapi import FastAPI
from fastapi import HTTPException as FastAPIHTTPException
from mcp import ClientSession
from mcp.client.sse import sse_client
from pydantic import BaseModel

app = FastAPI()


class QueryRequest(BaseModel):
    query: str


async def get_session():
    """Initialize MCP session asynchronously."""
    async with sse_client(url="http://192.168.2.117:8000/sse") as transport:
        read, write = transport
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            print(tools)
            return session


# Initialize Anthropic client
anthropic = Anthropic(
    api_key="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"
)


async def process_query(query: str) -> str:
    """Process a query using Claude and available tools"""

    # Get a fresh session for each request
    async with sse_client(url="http://192.168.2.117:8000/sse") as transport:
        read, write = transport
        async with ClientSession(read, write) as session:
            await session.initialize()
            response = await session.list_tools()
            all_tools = response.tools
            print("all_tools ", all_tools)

            available_tools = [
                {
                    "name": tool.name,
                    "description": tool.description,
                    "input_schema": tool.inputSchema,
                }
                for tool in all_tools
            ]

            messages = [
                {"role": "user", "content": query},
            ]

            # Initial Claude API call
            response = anthropic.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=1000,
                messages=messages,
                tools=available_tools,
            )

            # Process response and handle tool calls
            tool_results = []
            final_text = []

            for content in response.content:
                print("processing content", content)
                if content.type == "text":
                    final_text.append(content.text)
                elif content.type == "tool_use":
                    tool_name = content.name
                    tool_args = content.input
                    print(f"Calling tool {tool_name} with args {tool_args}")

                    # Execute tool call
                    result = await session.call_tool(tool_name, tool_args)
                    tool_results.append({"call": tool_name, "result": result})

                    # Add tool result to messages
                    messages.append({"role": "assistant", "content": [content]})
                    messages.append(
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "tool_result",
                                    "tool_use_id": content.id,
                                    "content": result.content,
                                }
                            ],
                        }
                    )

                    # Get next response from Claude
                    response = anthropic.messages.create(
                        model="claude-3-5-sonnet-20241022",
                        max_tokens=1000,
                        messages=messages,
                        tools=available_tools,
                    )

                    if len(response.content) > 0 and response.content[0].type == "text":
                        final_text.append(response.content[0].text)

            return "\n".join(final_text)


@app.post("/prompt")
async def handle_prompt(data: QueryRequest):
    """Handle HTTP POST request from Golang"""
    try:
        print(f"Received query: {data.query}")  # Log the query
        exec_result = await process_query(data.query)
        return {"response": exec_result}
    except Exception as e:
        print(f"Error processing request: {e}")  # Log errors
        raise FastAPIHTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    print("Starting MCP client 111")
    print("anthropic initialized")
    uvicorn.run(app, host="0.0.0.0", port=5000, log_level="debug")
