// ─── Tool Action Types ────────────────────────────────────────────────────────

export type ToolAction =
  | "book_appointment"
  | "check_availability"
  | "faq"
  | "talk";

// "response" is the spoken sentence read aloud to the caller — present in every tool.

export interface BookAppointmentArgs {
  date: string;         // ISO 8601 YYYY-MM-DD — required by prompt
  time: string;         // HH:MM 24h — required by prompt
  service: string;      // reason / service type — required by prompt
  response: string;     // spoken confirmation sentence
}

export interface CheckAvailabilityArgs {
  date: string;         // ISO 8601 YYYY-MM-DD — required by prompt
  response: string;     // spoken bridge sentence
}

export interface FaqArgs {
  question: string;     // caller's question verbatim or paraphrased
  response: string;     // spoken bridge while answer is looked up
}

export interface TalkArgs {
  response: string;     // spoken text — the only output channel for this tool
}

export type ToolArguments =
  | BookAppointmentArgs
  | CheckAvailabilityArgs
  | FaqArgs
  | TalkArgs
  | Record<string, unknown>;

// ─── Agent Decision (module output) ──────────────────────────────────────────

export interface AgentDecision {
  action: ToolAction;
  arguments: ToolArguments;
  raw?: string;         // original LLM text, present only in debug mode
}

// ─── Conversation History ─────────────────────────────────────────────────────

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ConversationMessage {
  role: MessageRole;
  content: string;
  tool_call_id?: string;  // only for role=tool
  name?: string;          // tool name, only for role=tool
}

// ─── DeepSeek API Wire Types ──────────────────────────────────────────────────

export interface DeepSeekToolFunction {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export interface DeepSeekTool {
  type: "function";
  function: DeepSeekToolFunction;
}

export interface DeepSeekToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface DeepSeekResponseMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: DeepSeekToolCall[];
}

export interface DeepSeekChoice {
  index: number;
  message: DeepSeekResponseMessage;
  finish_reason: "stop" | "tool_calls" | "length" | "content_filter";
}

export interface DeepSeekResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: DeepSeekChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ─── Streaming Delta Types ────────────────────────────────────────────────────

export interface DeepSeekStreamDelta {
  role?: "assistant";
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
  }>;
}

export interface DeepSeekStreamChoice {
  index: number;
  delta: DeepSeekStreamDelta;
  finish_reason: string | null;
}

export interface DeepSeekStreamChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: DeepSeekStreamChoice[];
}

// ─── Module Config ────────────────────────────────────────────────────────────

export interface DeepSeekEngineConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  maxHistoryMessages?: number;
  timeoutMs?: number;
  debug?: boolean;
}
