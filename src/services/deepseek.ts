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
//
// Tool descriptions are the primary prompt for the model — they must be
// unambiguous decision trees, not vague summaries.

const AGENT_TOOLS: DeepSeekTool[] = [
  {
    type: "function",
    function: {
      name: "book_appointment",
      description: [
        "USE when: caller explicitly says they want to book, make, schedule, or fix an appointment.",
        "DO NOT use if any required field (date, time, service) is still unknown — use 'talk' to collect it first.",
        "DO NOT invent or assume values the caller has not stated.",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description:
              "Appointment date stated by the caller. ISO 8601 format YYYY-MM-DD. REQUIRED — do not call this tool without it.",
          },
          time: {
            type: "string",
            description:
              "Appointment time stated by the caller. HH:MM 24h format. REQUIRED — do not call this tool without it.",
          },
          service: {
            type: "string",
            description:
              "Service or reason for the appointment as stated by the caller. REQUIRED.",
          },
          response: {
            type: "string",
            description:
              "Short spoken confirmation sentence read aloud to the caller after booking. Max 2 sentences.",
          },
        },
        required: ["date", "time", "service", "response"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_availability",
      description: [
        "USE when: caller asks whether a specific date or time is free, available, or open.",
        "USE when: caller says 'when can I come in' or 'what slots do you have'.",
        "DO NOT use for actual booking — only for querying free slots.",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description:
              "Date to check as stated by the caller. ISO 8601 YYYY-MM-DD. REQUIRED.",
          },
          response: {
            type: "string",
            description:
              "Short spoken sentence telling the caller you are checking. Max 1 sentence.",
          },
        },
        required: ["date", "response"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "faq",
      description: [
        "USE when: caller asks a factual question about the business — prices, hours, address, services offered, parking, payment methods, cancellation policy.",
        "USE when: caller asks 'how much', 'where', 'when are you open', 'do you offer', 'what is'.",
        "DO NOT use for booking or availability checks.",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description:
              "The caller's question verbatim or closely paraphrased. REQUIRED.",
          },
          response: {
            type: "string",
            description:
              "Short spoken bridge while the answer is being looked up. Max 1 sentence.",
          },
        },
        required: ["question", "response"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "talk",
      description: [
        "USE when: none of the other three tools apply.",
        "USE when: you need to greet, say goodbye, ask for missing information, confirm an action, or handle an unclear intent.",
        "USE when: you are missing required fields for book_appointment or check_availability.",
        "FORBIDDEN: do not use 'talk' to answer factual business questions — use 'faq' instead.",
        "FORBIDDEN: do not use 'talk' to confirm a booking — use 'book_appointment' instead.",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          response: {
            type: "string",
            description:
              "Spoken text read aloud to the caller. Must be natural, conversational, and concise. Max 2 sentences. REQUIRED.",
          },
        },
        required: ["response"],
      },
    },
  },
];

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `\
IDENTITY
You are the phone receptionist of a business. You speak directly to callers over the phone.

OUTPUT FORMAT — ABSOLUTE RULE
You MUST call exactly one tool per turn. Plain text replies are forbidden.
Every tool has a "response" field — always fill it with the sentence spoken aloud to the caller.

TOOL SELECTION — FOLLOW THIS ORDER
1. Caller wants to book/schedule → book_appointment
   └─ Only if date + time + service are known. Otherwise → talk to collect them.
2. Caller asks about free slots / availability → check_availability
   └─ Only if a date is known. Otherwise → talk to ask for it.
3. Caller asks a factual question about the business → faq
4. Everything else (greeting, goodbye, unclear, missing info) → talk

STRICT PROHIBITIONS
- NEVER invent dates, times, names, prices, or IDs the caller has not stated.
- NEVER reply with free text — always call a tool.
- NEVER call book_appointment if date, time, or service is missing.
- NEVER repeat the same clarifying question twice — rephrase or escalate.
- NEVER reveal that you are an AI unless the caller directly asks.
- NEVER produce responses longer than 2 sentences.

RESPONSE STYLE
- Short. Direct. Spoken German by default, mirror the caller's language.
- Sound human and friendly — no robotic filler phrases.
- One piece of information per sentence.

MISSING DATA HANDLING
If a required field is absent, ask for exactly one missing field at a time using "talk".
Example: date unknown → ask only for the date, not time and service at the same time.`.trim();

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
