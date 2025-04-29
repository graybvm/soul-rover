# System Flow Documentation

## API Flow

### 1. Request Flow
- Client gửi request đến endpoint `/api/prompt`
- Payload phải có định dạng:
```json
{
  "messages": [
    {
      "role": "user",
      "content": "Nội dung tin nhắn"
    }
  ]
}
```

### 2. MCP Client Management
- Mỗi request tạo một MCP client mới
- Client được sử dụng xuyên suốt request cho tất cả tool calls
- Transport được đóng sau khi hoàn thành request hoặc khi có lỗi
- Tool definitions được lấy động từ client thông qua `client.listTools()`

### 3. Tool Execution Flow
- Client kết nối đến MCP server thông qua supergateway
- Lấy danh sách tools từ server thông qua `client.listTools()`
- Chuyển đổi tool definitions sang định dạng OpenAI thông qua `convertMcpToolsToOpenAiFormat`
- Các tool calls được thực hiện tuần tự trong cùng một request
- Mỗi tool call sử dụng cùng một client instance
- Kết quả tool call được thêm vào conversation history

### 4. Error Handling
- Kiểm tra client và transport tồn tại trước khi sử dụng
- Cleanup transport trong block `finally` để đảm bảo luôn được thực hiện
- Log lỗi chi tiết để dễ debug
- Xử lý lỗi khi không thể lấy tool definitions từ server

### 5. Response Flow
- Non-streaming: Trả về kết quả dạng text
- Streaming: Trả về ReadableStream với các chunks

## Important Notes

1. **Client Lifecycle**
   - Một client cho một request
   - Client được tạo ở đầu request
   - Client được sử dụng cho tất cả tool calls
   - Transport được đóng sau khi hoàn thành

2. **Tool Management**
   - Tool definitions được lấy động từ server
   - Không hardcode tool definitions trong code
   - Sử dụng `client.listTools()` để lấy danh sách tools
   - Chuyển đổi tool definitions sang định dạng OpenAI

3. **Tool Calls**
   - Tool calls được thực hiện tuần tự
   - Kết quả tool call được thêm vào conversation history
   - Mỗi tool call sử dụng cùng một client instance

4. **Error Handling**
   - Kiểm tra client và transport tồn tại
   - Cleanup transport trong block `finally`
   - Log lỗi chi tiết
   - Xử lý lỗi khi không thể lấy tool definitions

5. **API Endpoints**
   - `/api/prompt`: Endpoint chính cho chat
   - `/api/version`: Endpoint kiểm tra version
   - `/events`: SSE endpoint cho streaming

## Testing

Test API với curl:
```bash
curl -X POST http://localhost:3000/api/prompt \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Chạy lại chỗ lấy đồ"}]}'
``` 

## Docker
docker build -t soul-rover .
docker run -p 80:80 --env-file .env soul-rover