/**
 * Claude HTTP Client
 *
 * Transport layer for the phone agent's LLM call:
 *   STT transcript → Claude Messages API → validated AgentDecision → Tool Router
 *
 * Responsibilities (this file only):
 *   - ENV-based configuration
 *   - Anthropic SDK call with hard per-attempt timeout
 *   - Retry logic scoped to phone latency budget
 *   - Structural + semantic validation of the response
 *   - Typed error hierarchy for upstream handling
 *
 * NOT responsible for: prompt engineering, tool definitions, conversation history.
 * Those live in claude.ts (engine layer).
 */

import Anthropic from "@anthropic-ai/sdk";

import type {
  AgentDecision,
  ClaudeClientConfig,
  ClaudeClientMetric,
  ConversationMessage,
  ToolAction,
  ToolArguments,
} from "../types/claude";

// ─── Latency Budget ────────────────────────────────────────────────────────────
//
// Phone callers tolerate ~1.5–2.5s of silence before hanging up.
// We give each HTTP attempt 2 200ms. If it times out we fail fast — a "please
// hold" TTS is played upstream rather than burning the budget on a second attempt.
//
// Retries are reserved for transient transport failures (TCP reset, 503/504)
// that resolve in <50ms, not for slow inference.

const PER_ATTEMPT_TIMEOUT_MS = 2_200;
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 50;

const RETRYABLE_STATUS = new Set([503, 504]);

// ─── Configuration ─────────────────────────────────────────────────────────────

type ResolvedConfig = Required<Omit<ClaudeClientConfig, "onMetric">> &
  Pick<ClaudeClientConfig, "onMetric">;

function resolveConfig(cfg: ClaudeClientConfig): ResolvedConfig {
  const apiKey = cfg.apiKey ?? process.env["ANTHROPIC_API_KEY"] ?? "";
  if (!apiKey) {
    throw new ClaudeConfigError(
      "Anthropic API key is missing. Set ANTHROPIC_API_KEY or pass apiKey in config."
    );
  }
  return {
    apiKey,
    model: cfg.model ?? process.env["ANTHROPIC_MODEL"] ?? "claude-opus-4-8",
    timeoutMs: cfg.timeoutMs ?? PER_ATTEMPT_TIMEOUT_MS,
    onMetric: cfg.onMetric,
  };
}

// ─── Error Hierarchy ───────────────────────────────────────────────────────────

export class ClaudeError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** API key not set or empty */
export class ClaudeConfigError extends ClaudeError {}

/** No response within per-attempt timeout — play "please hold" upstream */
export class ClaudeTimeoutError extends ClaudeError {
  constructor(public readonly timeoutMs: number) {
    super(`Claude did not respond within ${timeoutMs}ms`);
  }
}

/** 429 / 529 rate limit or overload — caller should queue or play a hold message */
export class ClaudeRateLimitError extends ClaudeError {
  constructor(public readonly retryAfterSec: number | null) {
    super(
      retryAfterSec != null
        ? `Claude rate limit hit. Retry after ${retryAfterSec}s`
        : "Claude rate limit hit"
    );
  }
}

/** 4xx client error (bad request, auth, etc.) */
export class ClaudeApiError extends ClaudeError {
  constructor(
    public readonly statusCode: number,
    public readonly responseBody: string
  ) {
    super(`Claude API error ${statusCode}: ${responseBody.slice(0, 200)}`);
  }
}

/** Response arrived but failed structural or semantic validation */
export class ClaudeValidationError extends ClaudeError {
  constructor(message: string, public readonly rawBody?: string) {
    super(`Claude validation: ${message}`);
  }
}

/** All attempts exhausted due to transport or server errors */
export class ClaudeExhaustedError extends ClaudeError {
  constructor(public readonly attempts: number, cause: unknown) {
    super(`Claude failed after ${attempts} attempt(s)`, cause);
  }
}

// ─── Validation Layer ──────────────────────────────────────────────────────────
//
// Three passes:
//   1. Structural — does the response contain a tool_use block?
//   2. Action     — is the tool name one of our four allowed actions?
//   3. Arguments  — do required fields exist and have the right types?

const VALID_ACTIONS: ReadonlySet<ToolAction> = new Set([
  "book_appointment",
  "check_availability",
  "faq",
  "talk",
]);

const REQUIRED_ARGS: Record<ToolAction, ReadonlyArray<string>> = {
  book_appointment: ["date", "time", "service", "response"],
  check_availability: ["date", "response"],
  faq: ["question", "response"],
  talk: ["response"],
};

function validateAction(name: string): ToolAction {
  if (!VALID_ACTIONS.has(name as ToolAction)) {
    throw new ClaudeValidationError(
      `Unknown action "${name}". Allowed: ${[...VALID_ACTIONS].join(", ")}`
    );
  }
  return name as ToolAction;
}

function validateArguments(action: ToolAction, args: unknown): ToolArguments {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new ClaudeValidationError(
      `Arguments for "${action}" must be a JSON object`
    );
  }

  const obj = args as Record<string, unknown>;
  for (const field of REQUIRED_ARGS[action]) {
    if (typeof obj[field] !== "string" || (obj[field] as string).trim() === "") {
      throw new ClaudeValidationError(
        `"${action}" is missing required string field "${field}"`
      );
    }
  }

  return obj as ToolArguments;
}

// ─── Response → AgentDecision ──────────────────────────────────────────────────

function toAgentDecision(message: Anthropic.Message): AgentDecision {
  // Primary path: extract the first tool_use block
  const toolUseBlock = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );

  if (toolUseBlock) {
    const action = validateAction(toolUseBlock.name);
    const args = validateArguments(action, toolUseBlock.input);
    return { action, arguments: args };
  }

  // Fallback: model responded with text instead of a tool call
  // (shouldn't happen with tool_choice: {type: "any"} but handled defensively)
  const textBlock = message.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  const content = (textBlock?.text ?? "").trim();

  if (!content) {
    throw new ClaudeValidationError(
      `stop_reason="${message.stop_reason}" but message has no tool_use or text content`
    );
  }

  // Attempt recovery: parse as JSON with an "action" key
  try {
    const cleaned = content
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    if (
      typeof parsed["action"] === "string" &&
      VALID_ACTIONS.has(parsed["action"] as ToolAction)
    ) {
      const action = parsed["action"] as ToolAction;
      const rawArgs =
        typeof parsed["arguments"] === "object" && parsed["arguments"] !== null
          ? parsed["arguments"]
          : {};
      return { action, arguments: validateArguments(action, rawArgs) };
    }
  } catch {
    // fall through to safe fallback
  }

  // Absolute fallback: wrap raw text as a talk action
  return {
    action: "talk",
    arguments: { response: content.slice(0, 300) },
  };
}

// ─── History Conversion ────────────────────────────────────────────────────────
//
// Convert ConversationMessage[] (DeepSeek-compatible format) to Anthropic
// MessageParam[]. System messages are excluded — they belong in the `system`
// parameter, not messages[]. Consecutive same-role messages are allowed by
// Anthropic (combined into a single turn).

function toAnthropicMessages(
  history: ConversationMessage[],
  transcript: string
): Anthropic.MessageParam[] {
  const params: Anthropic.MessageParam[] = [];

  for (const msg of history) {
    switch (msg.role) {
      case "system":
        break; // handled by the top-level `system` param
      case "user":
        params.push({ role: "user", content: msg.content });
        break;
      case "assistant":
        params.push({ role: "assistant", content: msg.content });
        break;
      case "tool":
        // Tool results become user messages in Anthropic format.
        // Consecutive same-role messages are combined by the API.
        params.push({ role: "user", content: `[Tool result]: ${msg.content}` });
        break;
    }
  }

  params.push({ role: "user", content: transcript });
  return params;
}

// ─── Retry Helper ──────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Claude Client ─────────────────────────────────────────────────────────────

export class ClaudeClient {
  private readonly cfg: ResolvedConfig;
  private readonly sdk: Anthropic;

  constructor(config: ClaudeClientConfig = {}) {
    this.cfg = resolveConfig(config);
    // Disable SDK-level retries — we manage the retry loop ourselves for
    // precise latency control within the phone call budget.
    this.sdk = new Anthropic({ apiKey: this.cfg.apiKey, maxRetries: 0 });
  }

  /**
   * Primary call: given a transcript + history + tools + system prompt,
   * returns a validated AgentDecision ready for the Tool Router.
   *
   * Throws:
   *   ClaudeTimeoutError     → play "please hold" and retry later
   *   ClaudeRateLimitError   → queue or return a hold message
   *   ClaudeValidationError  → LLM returned unexpected structure
   *   ClaudeApiError         → bad request (check prompt/tools config)
   *   ClaudeExhaustedError   → all attempts failed
   */
  async decide(
    transcript: string,
    history: ConversationMessage[],
    tools: Anthropic.Tool[],
    systemPrompt: string
  ): Promise<AgentDecision> {
    const messages = toAnthropicMessages(history, transcript);
    const raw = await this.callWithRetry(messages, tools, systemPrompt);
    return toAgentDecision(raw);
  }

  /**
   * Lower-level: raw completion call, returns the Anthropic Message.
   * Use when you need access to usage stats or the full content array.
   */
  async complete(
    messages: Anthropic.MessageParam[],
    tools: Anthropic.Tool[],
    systemPrompt: string
  ): Promise<Anthropic.Message> {
    return this.callWithRetry(messages, tools, systemPrompt);
  }

  // ─── Retry Loop ────────────────────────────────────────────────────────────

  private async callWithRetry(
    messages: Anthropic.MessageParam[],
    tools: Anthropic.Tool[],
    systemPrompt: string
  ): Promise<Anthropic.Message> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const t0 = Date.now();

      try {
        const message = await this.sdk.messages.create(
          {
            model: this.cfg.model,
            max_tokens: 256,
            system: systemPrompt,
            tools,
            tool_choice: { type: "any", disable_parallel_tool_use: true },
            messages,
          },
          { timeout: this.cfg.timeoutMs }
        );

        const latencyMs = Date.now() - t0;
        this.emit({ event: "success", attempt, latencyMs, statusCode: 200 });
        return message;

      } catch (err) {
        const latencyMs = Date.now() - t0;
        lastError = err;

        // Timeout — fail fast, no retry (already at phone latency limit)
        if (err instanceof Anthropic.APIConnectionTimeoutError) {
          this.emit({ event: "failure", attempt, latencyMs, errorType: "timeout" });
          throw new ClaudeTimeoutError(this.cfg.timeoutMs);
        }

        // Rate limit or overload — never retry, surface immediately
        if (
          err instanceof Anthropic.RateLimitError ||
          (err instanceof Anthropic.InternalServerError && err.status === 529)
        ) {
          const retryAfterRaw = err.headers?.get("retry-after");
          const secs =
            retryAfterRaw != null ? parseInt(String(retryAfterRaw), 10) : null;
          this.emit({
            event: "failure",
            attempt,
            latencyMs,
            statusCode: err.status,
            errorType: "rate_limit",
          });
          throw new ClaudeRateLimitError(Number.isNaN(secs) ? null : secs);
        }

        // 4xx client errors (auth, bad request, etc.) — no retry
        if (
          err instanceof Anthropic.APIError &&
          typeof err.status === "number" &&
          err.status >= 400 &&
          err.status < 500
        ) {
          this.emit({
            event: "failure",
            attempt,
            latencyMs,
            statusCode: err.status,
            errorType: "api_error",
          });
          throw new ClaudeApiError(err.status, err.message);
        }

        // 5xx retryable statuses or connection errors — retry once
        const isRetryableStatus =
          err instanceof Anthropic.APIError &&
          typeof err.status === "number" &&
          RETRYABLE_STATUS.has(err.status);
        const isConnectionError =
          err instanceof Anthropic.APIConnectionError &&
          !(err instanceof Anthropic.APIConnectionTimeoutError);

        if ((isRetryableStatus || isConnectionError) && attempt < MAX_ATTEMPTS) {
          this.emit({
            event: "retry",
            attempt,
            latencyMs,
            errorType: String(err),
          });
          await delay(RETRY_DELAY_MS);
          continue;
        }

        this.emit({
          event: "failure",
          attempt,
          latencyMs,
          errorType: String(err),
        });
        break;
      }
    }

    throw new ClaudeExhaustedError(MAX_ATTEMPTS, lastError);
  }

  private emit(metric: ClaudeClientMetric): void {
    this.cfg.onMetric?.(metric);
  }
}

// ─── Singleton Factory ──────────────────────────────────────────────────────────

let _singleton: ClaudeClient | null = null;

/**
 * Returns a shared client instance configured from ENV.
 * Call once at startup — subsequent calls return the same instance.
 */
export function getClaudeClient(config?: ClaudeClientConfig): ClaudeClient {
  if (!_singleton) {
    _singleton = new ClaudeClient(config ?? {});
  }
  return _singleton;
}

/** Replaces the singleton — useful in tests. */
export function setClaudeClient(client: ClaudeClient): void {
  _singleton = client;
}
