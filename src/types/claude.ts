// ─── Shared Decision Types (re-exported from deepseek module) ─────────────────
// AgentDecision, ToolAction, ToolArguments, and conversation types are shared
// across both the DeepSeek and Claude engine layers.

export type {
  AgentDecision,
  BookAppointmentArgs,
  CheckAvailabilityArgs,
  ConversationMessage,
  FaqArgs,
  MessageRole,
  TalkArgs,
  ToolAction,
  ToolArguments,
} from "./deepseek";

// ─── Claude Engine Config ──────────────────────────────────────────────────────

export interface ClaudeEngineConfig {
  /** Falls back to ANTHROPIC_API_KEY env var */
  apiKey?: string;
  /** Falls back to ANTHROPIC_MODEL env var, then "claude-opus-4-8" */
  model?: string;
  /** Max conversation turns kept in context. Default: 10 */
  maxHistoryMessages?: number;
  /** Enable adaptive thinking. Adds latency — disabled by default for phone agents. */
  thinking?: boolean;
  /** Emit debug logs. Default: false */
  debug?: boolean;
}

// ─── Claude Client Config ──────────────────────────────────────────────────────

export interface ClaudeClientConfig {
  /** Falls back to ANTHROPIC_API_KEY env var */
  apiKey?: string;
  /** Falls back to ANTHROPIC_MODEL env var, then "claude-opus-4-8" */
  model?: string;
  /** Per-attempt timeout in ms. Default: 2 200ms (phone latency budget) */
  timeoutMs?: number;
  /** Emit structured metric events for latency tracking */
  onMetric?: (metric: ClaudeClientMetric) => void;
}

export interface ClaudeClientMetric {
  event: "attempt" | "retry" | "success" | "failure";
  attempt: number;
  latencyMs: number;
  statusCode?: number;
  errorType?: string;
}
