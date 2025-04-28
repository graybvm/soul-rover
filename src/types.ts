export type ContentPart = {
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string;
    detail?: string;
  };
};

type Content = string | ContentPart[];

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface BaseMessage {
  role: MessageRole;
  content: Content;
}

export interface ToolMessage extends BaseMessage {
  role: "tool";
  name?: string;
  tool_call_id?: string;
}

export type Message = BaseMessage | ToolMessage;

export interface PromptPayload {
  messages: Message[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  streaming?: boolean;
  [key: string]: any;
}
