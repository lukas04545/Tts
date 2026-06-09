export type MessageRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: MessageRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model: string;
  apiKey: string;
  extraConfig?: Record<string, string>;
  maxTokens?: number;
  temperature?: number;
}

export interface ChatResponse {
  content: string;
  model: string;
  provider: string;
  usage?: TokenUsage;
  latencyMs: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ProviderModel {
  id: string;
  name: string;
  notes?: string;
}

export interface ExtraConfigField {
  key: string;
  label: string;
  placeholder?: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  homepage: string;
  baseUrl: string;
  rateLimits: string;
  notes: string;
  envVar: string;
  models: ProviderModel[];
  extraConfig?: ExtraConfigField;
  hasServerKey?: boolean;
}

export interface Provider {
  info: ProviderInfo;
  chat: (req: ChatRequest) => Promise<ChatResponse>;
}
