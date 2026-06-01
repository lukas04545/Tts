import https from "https";
import http from "http";
import { URL } from "url";

import type {
  AgentDecision,
  ConversationMessage,
  DeepSeekEngineConfig,
  DeepSeekResponse,
  DeepSeekStreamChunk,
  DeepSeekTool,
  ToolAction,
  ToolArguments,
} from "../types/deepseek";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_MAX_HISTORY = 10;
const DEFAULT_TIMEOUT_MS = 15_000;

const VALID_ACTIONS = new Set<ToolAction>([
  "book_appointment",
  "check_availability",
  "faq",
  "talk",
]);

// ─── Tool Definitions (sent to DeepSeek) ──────────────────────────────────────

const AGENT_TOOLS: DeepSeekTool[] = [
  {
    type: "function",
    function: {
      name: "book_appointment",
      description:
        "Book a new appointment for the caller. Call this when the user explicitly wants to schedule, book, or make an appointment.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Full name of the caller" },
          date: {
            type: "string",
            description: "Desired date in ISO 8601 format (YYYY-MM-DD)",
          },
          time: {
            type: "string",
            description: "Desired time in HH:MM (24h) format",
          },
          topic: {
            type: "string",
            description: "Topic or reason for the appointment",
          },
          phone: {
            type: "string",
            description: "Callback phone number of the caller",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_availability",
      description:
        "Check available appointment slots. Use this when the caller asks about free times, availability, or open slots before committing to a booking.",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "Date to check in ISO 8601 format (YYYY-MM-DD)",
          },
          time_from: {
            type: "string",
            description: "Start of desired time window in HH:MM",
          },
          time_to: {
            type: "string",
            description: "End of desired time window in HH:MM",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "faq",
      description:
        "Answer a frequently asked question about the business, services, prices, hours, or policies. Use this whenever the caller asks an informational question.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "The caller's question rephrased as a concise search query",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "talk",
      description:
        "Produce a spoken response to the caller with no external side-effects. Use this for greetings, clarifying questions, confirmations, and any response that does not require booking or lookup.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description:
              "The exact text that will be spoken aloud to the caller",
          },
        },
        required: ["text"],
      },
    },
  },
];

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a professional AI phone receptionist. Your only job is to assist callers by using exactly one of the four available tools per turn.

STRICT RULES — follow these without exception:
1. You MUST always call exactly one tool. Never reply with plain text.
2. Choose the tool whose description best matches the caller's intent.
3. If unsure, use the "talk" tool to ask a clarifying question.
4. Extract arguments from the conversation context. Never invent data you have not heard.
5. The "text" field in the "talk" tool must be natural spoken German (or match the caller's language). Keep it short — one to two sentences maximum.
6. Never mention that you are an AI unless directly asked.
7. Never hallucinate appointment IDs, dates, or phone numbers.

TOOL SELECTION GUIDE:
- Caller wants to make/book/schedule an appointment → book_appointment
- Caller asks about free times or available slots → check_availability
- Caller asks an informational question (hours, prices, address, etc.) → faq
- Everything else (greetings, clarifications, goodbyes, unknown intent) → talk

LANGUAGE: Reply in the same language the caller uses. Default to German.`.trim();

// ─── Safe JSON Parsing ────────────────────────────────────────────────────────

function safeParseJson(raw: string): unknown {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

function isValidAction(value: unknown): value is ToolAction {
  return typeof value === "string" && VALID_ACTIONS.has(value as ToolAction);
}

// ─── Raw HTTP Request (no external dependencies) ──────────────────────────────

function httpPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
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
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        res.on("error", reject);
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── Streaming HTTP (returns line-by-line async generator) ───────────────────

async function* httpPostStream(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number
): AsyncGenerator<string> {
  const parsed = new URL(url);
  const isHttps = parsed.protocol === "https:";
  const lib = isHttps ? https : http;

  const lines = await new Promise<string[]>((resolve, reject) => {
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve(Buffer.concat(chunks).toString("utf8").split("\n"))
        );
        res.on("error", reject);
      }
    );
    req.setTimeout(timeoutMs, () =>
      req.destroy(new Error(`Stream timed out after ${timeoutMs}ms`))
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });

  for (const line of lines) {
    yield line;
  }
}

// ─── Response Parser ──────────────────────────────────────────────────────────

function parseDecisionFromToolCall(
  toolName: string,
  argumentsJson: string,
  debug: boolean,
  rawText: string | null
): AgentDecision {
  if (!isValidAction(toolName)) {
    throw new Error(`Unknown tool action received from LLM: "${toolName}"`);
  }

  let parsedArgs: ToolArguments;
  try {
    parsedArgs = JSON.parse(argumentsJson) as ToolArguments;
  } catch {
    // Partial streaming arguments — propagate to caller
    throw new Error(
      `Failed to parse tool arguments for "${toolName}": ${argumentsJson}`
    );
  }

  const decision: AgentDecision = {
    action: toolName,
    arguments: parsedArgs,
  };

  if (debug && rawText !== null) {
    decision.raw = rawText;
  }

  return decision;
}

function parseDecisionFromPlainText(
  content: string,
  debug: boolean
): AgentDecision {
  // LLM ignored tool_choice=required — try to extract JSON from the text
  let parsed: unknown;
  try {
    parsed = safeParseJson(content);
  } catch {
    // Absolute fallback: wrap as a talk action
    return {
      action: "talk",
      arguments: { text: content.trim() },
      ...(debug ? { raw: content } : {}),
    };
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "action" in parsed &&
    isValidAction((parsed as { action: unknown }).action)
  ) {
    const p = parsed as { action: ToolAction; arguments?: ToolArguments };
    return {
      action: p.action,
      arguments: p.arguments ?? {},
      ...(debug ? { raw: content } : {}),
    };
  }

  return {
    action: "talk",
    arguments: { text: content.trim() },
    ...(debug ? { raw: content } : {}),
  };
}

// ─── DeepSeek Engine ──────────────────────────────────────────────────────────

export class DeepSeekEngine {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly maxHistory: number;
  private readonly timeoutMs: number;
  private readonly debug: boolean;

  constructor(config: DeepSeekEngineConfig) {
    if (!config.apiKey) throw new Error("DeepSeekEngine: apiKey is required");

    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.baseUrl = (config.baseUrl ?? DEEPSEEK_BASE_URL).replace(/\/$/, "");
    this.maxHistory = config.maxHistoryMessages ?? DEFAULT_MAX_HISTORY;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.debug = config.debug ?? false;
  }

  // ─── Main entrypoint ────────────────────────────────────────────────────────

  async decide(
    transcript: string,
    history: ConversationMessage[]
  ): Promise<AgentDecision> {
    const messages = this.buildMessages(transcript, history);
    return this.callApi(messages);
  }

  // ─── Streaming entrypoint (yields text tokens + final decision) ──────────────

  async *decideStream(
    transcript: string,
    history: ConversationMessage[]
  ): AsyncGenerator<{ type: "token"; token: string } | { type: "decision"; decision: AgentDecision }> {
    const messages = this.buildMessages(transcript, history);
    const payload = this.buildPayload(messages, true);
    const url = `${this.baseUrl}/v1/chat/completions`;
    const headers = this.buildHeaders();
    const bodyStr = JSON.stringify(payload);

    // Accumulators for streaming tool call assembly
    let accContent = "";
    let toolName = "";
    let toolArgsBuffer = "";
    let toolCallId = "";
    let finishReason: string | null = null;

    for await (const rawLine of httpPostStream(url, headers, bodyStr, this.timeoutMs)) {
      const line = rawLine.trim();
      if (!line || line === "data: [DONE]") continue;

      const jsonStr = line.startsWith("data: ") ? line.slice(6) : line;
      let chunk: DeepSeekStreamChunk;
      try {
        chunk = JSON.parse(jsonStr) as DeepSeekStreamChunk;
      } catch {
        continue;
      }

      const choice = chunk.choices[0];
      if (!choice) continue;

      finishReason = choice.finish_reason ?? finishReason;
      const delta = choice.delta;

      if (delta.content) {
        accContent += delta.content;
        yield { type: "token", token: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.id) toolCallId = tc.id;
          if (tc.function?.name) toolName += tc.function.name;
          if (tc.function?.arguments) toolArgsBuffer += tc.function.arguments;
        }
      }
    }

    let decision: AgentDecision;

    if (finishReason === "tool_calls" && toolName) {
      decision = parseDecisionFromToolCall(
        toolName,
        toolArgsBuffer,
        this.debug,
        accContent || null
      );
    } else {
      decision = parseDecisionFromPlainText(accContent, this.debug);
    }

    yield { type: "decision", decision };
  }

  // ─── Non-streaming API call ──────────────────────────────────────────────────

  private async callApi(
    messages: ConversationMessage[]
  ): Promise<AgentDecision> {
    const payload = this.buildPayload(messages, false);
    const url = `${this.baseUrl}/v1/chat/completions`;
    const headers = this.buildHeaders();
    const bodyStr = JSON.stringify(payload);

    if (this.debug) {
      console.debug("[DeepSeek] Request messages:", JSON.stringify(messages, null, 2));
    }

    let resp: { statusCode: number; body: string };
    try {
      resp = await httpPost(url, headers, bodyStr, this.timeoutMs);
    } catch (err) {
      throw new Error(
        `DeepSeek HTTP error: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (resp.statusCode !== 200) {
      throw new Error(
        `DeepSeek API returned ${resp.statusCode}: ${resp.body.slice(0, 300)}`
      );
    }

    let apiResponse: DeepSeekResponse;
    try {
      apiResponse = JSON.parse(resp.body) as DeepSeekResponse;
    } catch {
      throw new Error(
        `DeepSeek returned non-JSON response: ${resp.body.slice(0, 200)}`
      );
    }

    if (this.debug) {
      console.debug("[DeepSeek] Response:", JSON.stringify(apiResponse, null, 2));
    }

    const choice = apiResponse.choices[0];
    if (!choice) throw new Error("DeepSeek returned no choices");

    const { finish_reason, message } = choice;

    if (finish_reason === "tool_calls" && message.tool_calls?.length) {
      const tc = message.tool_calls[0];
      return parseDecisionFromToolCall(
        tc.function.name,
        tc.function.arguments,
        this.debug,
        message.content ?? null
      );
    }

    // Fallback: model responded with text instead of a tool call
    const content = message.content ?? "";
    return parseDecisionFromPlainText(content, this.debug);
  }

  // ─── Message Builder ─────────────────────────────────────────────────────────

  private buildMessages(
    transcript: string,
    history: ConversationMessage[]
  ): ConversationMessage[] {
    // Keep last N messages to bound context size
    const trimmedHistory = history.slice(-this.maxHistory);

    return [
      { role: "system", content: SYSTEM_PROMPT },
      ...trimmedHistory,
      { role: "user", content: transcript },
    ];
  }

  // ─── Payload Builder ──────────────────────────────────────────────────────────

  private buildPayload(
    messages: ConversationMessage[],
    stream: boolean
  ): Record<string, unknown> {
    return {
      model: this.model,
      messages,
      tools: AGENT_TOOLS,
      tool_choice: "required",   // Force the model to always call a tool
      parallel_tool_calls: false, // One tool per turn — simplifies audio pipeline
      temperature: 0.2,           // Low temperature for predictable structured output
      max_tokens: 512,
      stream,
    };
  }

  // ─── Headers ─────────────────────────────────────────────────────────────────

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    };
  }
}

// ─── Conversation History Manager ─────────────────────────────────────────────

export class ConversationHistory {
  private messages: ConversationMessage[] = [];
  private readonly maxMessages: number;

  constructor(maxMessages = DEFAULT_MAX_HISTORY) {
    this.maxMessages = maxMessages;
  }

  push(role: ConversationMessage["role"], content: string, extra?: Partial<ConversationMessage>): void {
    this.messages.push({ role, content, ...extra });
    // Trim oldest non-system messages when over limit
    const nonSystem = this.messages.filter((m) => m.role !== "system");
    if (nonSystem.length > this.maxMessages) {
      const excessCount = nonSystem.length - this.maxMessages;
      let removed = 0;
      this.messages = this.messages.filter((m) => {
        if (m.role !== "system" && removed < excessCount) {
          removed++;
          return false;
        }
        return true;
      });
    }
  }

  addUserTurn(transcript: string): void {
    this.push("user", transcript);
  }

  addAssistantDecision(decision: AgentDecision): void {
    // Record what the agent decided — helps the model understand past turns
    this.push(
      "assistant",
      `[Action: ${decision.action}] ${JSON.stringify(decision.arguments)}`
    );
  }

  addToolResult(result: string, toolCallId = ""): void {
    this.push("tool", result, { tool_call_id: toolCallId, name: "tool_result" });
  }

  getMessages(): ConversationMessage[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
  }

  get length(): number {
    return this.messages.length;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createDeepSeekEngine(
  config: DeepSeekEngineConfig
): DeepSeekEngine {
  return new DeepSeekEngine(config);
}
