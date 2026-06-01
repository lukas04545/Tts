/**
 * DeepSeek HTTP Client
 *
 * Transport layer for the phone agent's LLM call:
 *   STT transcript → DeepSeek Chat Completions → validated AgentDecision → Tool Router
 *
 * Responsibilities (this file only):
 *   - ENV-based configuration
 *   - Raw HTTPS request with hard per-attempt timeout
 *   - Retry logic scoped to phone latency budget
 *   - Structural + semantic JSON validation
 *   - Typed error hierarchy for upstream handling
 *
 * NOT responsible for: prompt engineering, tool definitions, conversation history.
 * Those live in deepseek.ts (engine layer).
 */

import https from "https";
import http from "http";
import { URL } from "url";

import type {
  AgentDecision,
  ConversationMessage,
  DeepSeekResponse,
  DeepSeekTool,
  ToolAction,
  ToolArguments,
} from "../types/deepseek";

// ─── Latency Budget ────────────────────────────────────────────────────────────
//
// Phone callers tolerate ~1.5–2.5s of silence before hanging up.
// We give each HTTP attempt 2 200ms. If it times out we fail fast — a "please
// hold" TTS is played upstream rather than blowing the budget on a second attempt.
//
// Retries are reserved for transient transport failures (TCP reset, server
// restart) that resolve in <50ms, not for slow inference.

const PER_ATTEMPT_TIMEOUT_MS = 2_200;
const MAX_ATTEMPTS = 2;           // 1 original + 1 retry max
const RETRY_DELAY_MS = 50;        // near-zero: only lets the TCP stack recover

// HTTP status codes that warrant a retry (server-side transient errors only)
const RETRYABLE_STATUS = new Set([503, 504]);

// ─── Configuration ─────────────────────────────────────────────────────────────

export interface DeepSeekClientConfig {
  /** Falls back to DEEPSEEK_API_KEY env var */
  apiKey?: string;
  /** Falls back to DEEPSEEK_MODEL env var, then "deepseek-chat" */
  model?: string;
  /** Falls back to DEEPSEEK_BASE_URL env var, then api.deepseek.com */
  baseUrl?: string;
  /** Override per-attempt timeout. Default: 2 200ms */
  timeoutMs?: number;
  /** Emit structured log lines for latency tracking */
  onMetric?: (metric: ClientMetric) => void;
}

export interface ClientMetric {
  event: "attempt" | "retry" | "success" | "failure";
  attempt: number;
  latencyMs: number;
  statusCode?: number;
  errorType?: string;
}

function resolveConfig(cfg: DeepSeekClientConfig): Required<Omit<DeepSeekClientConfig, "onMetric">> & Pick<DeepSeekClientConfig, "onMetric"> {
  const apiKey = cfg.apiKey ?? process.env["DEEPSEEK_API_KEY"] ?? "";
  if (!apiKey) {
    throw new DeepSeekConfigError(
      "DeepSeek API key is missing. Set DEEPSEEK_API_KEY or pass apiKey in config."
    );
  }
  return {
    apiKey,
    model: cfg.model ?? process.env["DEEPSEEK_MODEL"] ?? "deepseek-chat",
    baseUrl: (cfg.baseUrl ?? process.env["DEEPSEEK_BASE_URL"] ?? "https://api.deepseek.com").replace(/\/$/, ""),
    timeoutMs: cfg.timeoutMs ?? PER_ATTEMPT_TIMEOUT_MS,
    onMetric: cfg.onMetric,
  };
}

// ─── Error Hierarchy ───────────────────────────────────────────────────────────

export class DeepSeekError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** API key not set or empty */
export class DeepSeekConfigError extends DeepSeekError {}

/** No response within per-attempt timeout — play "please hold" upstream */
export class DeepSeekTimeoutError extends DeepSeekError {
  constructor(public readonly timeoutMs: number) {
    super(`DeepSeek did not respond within ${timeoutMs}ms`);
  }
}

/** 429 rate limit — caller should queue or play a hold message */
export class DeepSeekRateLimitError extends DeepSeekError {
  constructor(public readonly retryAfterSec: number | null) {
    super(
      retryAfterSec != null
        ? `DeepSeek rate limit hit. Retry after ${retryAfterSec}s`
        : "DeepSeek rate limit hit"
    );
  }
}

/** 4xx client error (bad request, auth, etc.) */
export class DeepSeekApiError extends DeepSeekError {
  constructor(
    public readonly statusCode: number,
    public readonly responseBody: string
  ) {
    super(`DeepSeek API error ${statusCode}: ${responseBody.slice(0, 200)}`);
  }
}

/** Response arrived but failed structural or semantic validation */
export class DeepSeekValidationError extends DeepSeekError {
  constructor(message: string, public readonly rawBody?: string) {
    super(`DeepSeek validation: ${message}`);
  }
}

/** All attempts exhausted due to transport or server errors */
export class DeepSeekExhaustedError extends DeepSeekError {
  constructor(public readonly attempts: number, cause: unknown) {
    super(`DeepSeek failed after ${attempts} attempt(s)`, cause);
  }
}

// ─── Raw HTTP Transport ────────────────────────────────────────────────────────

interface RawResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function rawPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        res.on("error", reject);
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(); // triggers "error" event with ECONNRESET — caught below
      reject(new DeepSeekTimeoutError(timeoutMs));
    });

    req.on("error", (err: NodeJS.ErrnoException) => {
      // If we already rejected via timeout, the destroy() error is a duplicate
      if (err.code === "ECONNRESET" || err.message.includes("socket hang up")) {
        // Swallow — timeout rejection already sent
        return;
      }
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

// ─── Retry Wrapper ─────────────────────────────────────────────────────────────
//
// Retry policy for phone latency:
//   Retry  → TCP-level errors (ECONNRESET, ECONNREFUSED, ENOTFOUND)
//   Retry  → 503, 504  (server temporarily unavailable / gateway timeout)
//   NO retry → DeepSeekTimeoutError  (already at latency limit, fail fast)
//   NO retry → 429  (rate limit, needs seconds not milliseconds)
//   NO retry → 4xx  (client error, retrying won't change outcome)

function isRetryableNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code ?? "";
  return ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EPIPE"].includes(code);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function postWithRetry(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
  onMetric?: DeepSeekClientConfig["onMetric"]
): Promise<RawResponse> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const t0 = Date.now();

    try {
      const resp = await rawPost(url, headers, body, timeoutMs);
      const latencyMs = Date.now() - t0;

      // 429 — never retry, surface immediately
      if (resp.statusCode === 429) {
        const retryAfter = resp.headers["retry-after"];
        const secs = retryAfter != null ? parseInt(String(retryAfter), 10) : null;
        onMetric?.({ event: "failure", attempt, latencyMs, statusCode: 429, errorType: "rate_limit" });
        throw new DeepSeekRateLimitError(Number.isNaN(secs) ? null : secs);
      }

      // 4xx (excl. 429) — client error, no retry
      if (resp.statusCode >= 400 && resp.statusCode < 500) {
        onMetric?.({ event: "failure", attempt, latencyMs, statusCode: resp.statusCode, errorType: "api_error" });
        throw new DeepSeekApiError(resp.statusCode, resp.body);
      }

      // 5xx retryable statuses
      if (RETRYABLE_STATUS.has(resp.statusCode)) {
        lastError = new DeepSeekApiError(resp.statusCode, resp.body);
        onMetric?.({ event: attempt < MAX_ATTEMPTS ? "retry" : "failure", attempt, latencyMs, statusCode: resp.statusCode, errorType: "server_error" });
        if (attempt < MAX_ATTEMPTS) {
          await delay(RETRY_DELAY_MS);
          continue;
        }
        throw lastError;
      }

      onMetric?.({ event: "success", attempt, latencyMs, statusCode: resp.statusCode });
      return resp;

    } catch (err) {
      const latencyMs = Date.now() - t0;

      // Re-throw non-retryable typed errors immediately
      if (
        err instanceof DeepSeekRateLimitError ||
        err instanceof DeepSeekApiError ||
        err instanceof DeepSeekTimeoutError  // timeout = fail fast, no retry
      ) {
        throw err;
      }

      lastError = err;

      if (isRetryableNetworkError(err) && attempt < MAX_ATTEMPTS) {
        onMetric?.({ event: "retry", attempt, latencyMs, errorType: (err as NodeJS.ErrnoException).code });
        await delay(RETRY_DELAY_MS);
        continue;
      }

      onMetric?.({ event: "failure", attempt, latencyMs, errorType: String(err) });
      break;
    }
  }

  throw new DeepSeekExhaustedError(MAX_ATTEMPTS, lastError);
}

// ─── JSON Validation Layer ─────────────────────────────────────────────────────
//
// Three validation passes:
//   1. Structural — does the response match the DeepSeek wire format?
//   2. Action — is the tool name one of our four allowed actions?
//   3. Arguments — do required fields exist and have the right types?

const VALID_ACTIONS: ReadonlySet<ToolAction> = new Set([
  "book_appointment",
  "check_availability",
  "faq",
  "talk",
]);

// Required fields per action. All must be non-empty strings.
const REQUIRED_ARGS: Record<ToolAction, ReadonlyArray<string>> = {
  book_appointment: ["date", "time", "service", "response"],
  check_availability: ["date", "response"],
  faq: ["question", "response"],
  talk: ["response"],
};

function validateStructure(body: string): DeepSeekResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new DeepSeekValidationError("Response is not valid JSON", body.slice(0, 300));
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new DeepSeekValidationError("Response root is not an object");
  }

  const r = parsed as Record<string, unknown>;

  if (!Array.isArray(r["choices"]) || r["choices"].length === 0) {
    throw new DeepSeekValidationError("Missing or empty 'choices' array");
  }

  const choice = r["choices"][0] as Record<string, unknown>;

  if (typeof choice["message"] !== "object" || choice["message"] === null) {
    throw new DeepSeekValidationError("choices[0].message is missing or not an object");
  }

  const msg = choice["message"] as Record<string, unknown>;

  const hasToolCalls = Array.isArray(msg["tool_calls"]) && (msg["tool_calls"] as unknown[]).length > 0;
  const hasContent = typeof msg["content"] === "string";

  if (!hasToolCalls && !hasContent) {
    throw new DeepSeekValidationError(
      "choices[0].message has neither tool_calls nor content"
    );
  }

  return parsed as DeepSeekResponse;
}

function validateAction(name: string): ToolAction {
  if (!VALID_ACTIONS.has(name as ToolAction)) {
    throw new DeepSeekValidationError(
      `Unknown action "${name}". Allowed: ${[...VALID_ACTIONS].join(", ")}`
    );
  }
  return name as ToolAction;
}

function validateArguments(action: ToolAction, argsJson: string): ToolArguments {
  let args: unknown;
  try {
    args = JSON.parse(argsJson);
  } catch {
    throw new DeepSeekValidationError(
      `tool_calls[0].function.arguments is not valid JSON for action "${action}"`,
      argsJson.slice(0, 200)
    );
  }

  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new DeepSeekValidationError(`Arguments for "${action}" must be a JSON object`);
  }

  const obj = args as Record<string, unknown>;
  const required = REQUIRED_ARGS[action];

  for (const field of required) {
    if (typeof obj[field] !== "string" || (obj[field] as string).trim() === "") {
      throw new DeepSeekValidationError(
        `"${action}" is missing required string field "${field}"`
      );
    }
  }

  return obj as ToolArguments;
}

// ─── Response → AgentDecision ──────────────────────────────────────────────────

function toAgentDecision(resp: DeepSeekResponse): AgentDecision {
  const choice = resp.choices[0];
  const { message, finish_reason } = choice;

  if (finish_reason === "tool_calls" && message.tool_calls?.length) {
    const tc = message.tool_calls[0];
    const action = validateAction(tc.function.name);
    const args = validateArguments(action, tc.function.arguments);
    return { action, arguments: args };
  }

  // Model ignored tool_choice=required — attempt recovery from plain text
  const content = (message.content ?? "").trim();
  if (!content) {
    throw new DeepSeekValidationError(
      `finish_reason="${finish_reason}" but message has no content or tool_calls`
    );
  }

  // Try to parse content as JSON with an "action" key
  try {
    const parsed = JSON.parse(
      content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    ) as Record<string, unknown>;

    if (typeof parsed["action"] === "string" && VALID_ACTIONS.has(parsed["action"] as ToolAction)) {
      const action = parsed["action"] as ToolAction;
      const rawArgs = typeof parsed["arguments"] === "object" && parsed["arguments"] !== null
        ? JSON.stringify(parsed["arguments"])
        : "{}";
      const args = validateArguments(action, rawArgs);
      return { action, arguments: args };
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

// ─── DeepSeekClient ────────────────────────────────────────────────────────────

export class DeepSeekClient {
  private readonly cfg: Required<Omit<DeepSeekClientConfig, "onMetric">> & Pick<DeepSeekClientConfig, "onMetric">;

  constructor(config: DeepSeekClientConfig = {}) {
    this.cfg = resolveConfig(config);
  }

  /**
   * Primary call: given a transcript + history + tool definitions, returns a
   * validated AgentDecision ready for the Tool Router.
   *
   * Throws:
   *   DeepSeekTimeoutError     → play "please hold" and retry the call later
   *   DeepSeekRateLimitError   → queue or return a hold message
   *   DeepSeekValidationError  → LLM returned unexpected structure
   *   DeepSeekApiError         → bad request (check prompt/tools config)
   *   DeepSeekExhaustedError   → all attempts failed
   */
  async decide(
    transcript: string,
    history: ConversationMessage[],
    tools: DeepSeekTool[],
    systemPrompt: string
  ): Promise<AgentDecision> {
    const messages: ConversationMessage[] = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: transcript },
    ];

    const payload = this.buildPayload(messages, tools);
    const url = `${this.cfg.baseUrl}/v1/chat/completions`;
    const headers = this.buildHeaders();
    const body = JSON.stringify(payload);

    const raw = await postWithRetry(url, headers, body, this.cfg.timeoutMs, this.cfg.onMetric);

    const validated = validateStructure(raw.body);
    return toAgentDecision(validated);
  }

  /**
   * Lower-level: raw completion call, returns the validated DeepSeekResponse.
   * Use when you need access to usage stats or multiple choices.
   */
  async complete(
    messages: ConversationMessage[],
    tools: DeepSeekTool[]
  ): Promise<DeepSeekResponse> {
    const payload = this.buildPayload(messages, tools);
    const url = `${this.cfg.baseUrl}/v1/chat/completions`;
    const headers = this.buildHeaders();
    const body = JSON.stringify(payload);

    const raw = await postWithRetry(url, headers, body, this.cfg.timeoutMs, this.cfg.onMetric);
    return validateStructure(raw.body);
  }

  // ─── Payload ──────────────────────────────────────────────────────────────

  private buildPayload(
    messages: ConversationMessage[],
    tools: DeepSeekTool[]
  ): Record<string, unknown> {
    return {
      model: this.cfg.model,
      messages,
      tools,
      tool_choice: "required",      // no free text, always a tool call
      parallel_tool_calls: false,   // one decision per STT turn
      temperature: 0.2,             // deterministic tool selection
      max_tokens: 256,              // phone responses are short; hard cap
      stream: false,                // client handles non-streaming only
    };
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.cfg.apiKey}`,
      Accept: "application/json",
      // Helps DeepSeek route to lower-latency inference tier
      "X-Request-Priority": "realtime",
    };
  }
}

// ─── Singleton factory (reads from ENV, zero-config for most callers) ──────────

let _singleton: DeepSeekClient | null = null;

/**
 * Returns a shared client instance configured from ENV.
 * Call once at startup — subsequent calls return the same instance.
 */
export function getDeepSeekClient(config?: DeepSeekClientConfig): DeepSeekClient {
  if (!_singleton) {
    _singleton = new DeepSeekClient(config ?? {});
  }
  return _singleton;
}

/**
 * Replaces the singleton — useful in tests.
 */
export function setDeepSeekClient(client: DeepSeekClient): void {
  _singleton = client;
}
