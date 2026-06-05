/**
 * Claude Engine
 *
 * Phone agent LLM engine using the official @anthropic-ai/sdk.
 * Mirrors deepseek.ts architecture: tool definitions, system prompt,
 * history management, and decision parsing all live here.
 *
 * Transport concerns (retry, per-attempt timeout, typed errors) live in
 * claudeClient.ts. Use ClaudeEngine directly when you want simple SDK
 * access; use ClaudeClient when you need the phone-call latency guarantees.
 *
 * Key Anthropic-vs-DeepSeek differences handled here:
 *   - input_schema (not parameters) in tool definitions
 *   - tool_choice: {type:"any"} (not string "required")
 *   - system prompt is a top-level param, not a message
 *   - no temperature / top_p / top_k on Opus 4.8
 *   - role:"tool" history → role:"user" messages
 */

import Anthropic from "@anthropic-ai/sdk";

import type {
  AgentDecision,
  ClaudeEngineConfig,
  ConversationMessage,
  ToolAction,
  ToolArguments,
} from "../types/claude";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_MAX_HISTORY = 10;

const VALID_ACTIONS = new Set<ToolAction>([
  "book_appointment",
  "check_availability",
  "faq",
  "talk",
]);

// ─── Tool Definitions ─────────────────────────────────────────────────────────
//
// Anthropic format uses `input_schema` (not DeepSeek's `parameters`).
// Descriptions are the primary decision signal — kept identical to deepseek.ts.

const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "book_appointment",
    description: [
      "USE when: caller explicitly says they want to book, make, schedule, or fix an appointment.",
      "DO NOT use if any required field (date, time, service) is still unknown — use 'talk' to collect it first.",
      "DO NOT invent or assume values the caller has not stated.",
    ].join(" "),
    input_schema: {
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
  {
    name: "check_availability",
    description: [
      "USE when: caller asks whether a specific date or time is free, available, or open.",
      "USE when: caller says 'when can I come in' or 'what slots do you have'.",
      "DO NOT use for actual booking — only for querying free slots.",
    ].join(" "),
    input_schema: {
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
  {
    name: "faq",
    description: [
      "USE when: caller asks a factual question about the business — prices, hours, address, services offered, parking, payment methods, cancellation policy.",
      "USE when: caller asks 'how much', 'where', 'when are you open', 'do you offer', 'what is'.",
      "DO NOT use for booking or availability checks.",
    ].join(" "),
    input_schema: {
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
  {
    name: "talk",
    description: [
      "USE when: none of the other three tools apply.",
      "USE when: you need to greet, say goodbye, ask for missing information, confirm an action, or handle an unclear intent.",
      "USE when: you are missing required fields for book_appointment or check_availability.",
      "FORBIDDEN: do not use 'talk' to answer factual business questions — use 'faq' instead.",
      "FORBIDDEN: do not use 'talk' to confirm a booking — use 'book_appointment' instead.",
    ].join(" "),
    input_schema: {
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidAction(value: unknown): value is ToolAction {
  return typeof value === "string" && VALID_ACTIONS.has(value as ToolAction);
}

// ─── Claude Engine ─────────────────────────────────────────────────────────────

export class ClaudeEngine {
  private readonly sdk: Anthropic;
  private readonly model: string;
  private readonly maxHistory: number;
  private readonly thinking: boolean;
  private readonly debug: boolean;

  constructor(config: ClaudeEngineConfig) {
    const apiKey = config.apiKey ?? process.env["ANTHROPIC_API_KEY"] ?? "";
    if (!apiKey) {
      throw new Error(
        "ClaudeEngine: API key is required. Set ANTHROPIC_API_KEY or pass apiKey in config."
      );
    }

    // SDK-level retries disabled — retry logic belongs in ClaudeClient
    this.sdk = new Anthropic({ apiKey, maxRetries: 0 });
    this.model = config.model ?? process.env["ANTHROPIC_MODEL"] ?? DEFAULT_MODEL;
    this.maxHistory = config.maxHistoryMessages ?? DEFAULT_MAX_HISTORY;
    this.thinking = config.thinking ?? false;
    this.debug = config.debug ?? false;
  }

  // ─── Main entrypoint ────────────────────────────────────────────────────────

  async decide(
    transcript: string,
    history: ConversationMessage[]
  ): Promise<AgentDecision> {
    const messages = this.buildMessages(transcript, history);

    if (this.debug) {
      console.debug("[ClaudeEngine] Messages:", JSON.stringify(messages, null, 2));
    }

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      tools: AGENT_TOOLS,
      tool_choice: { type: "any", disable_parallel_tool_use: true },
      messages,
    };

    if (this.thinking) {
      params.thinking = { type: "adaptive" };
    }

    const message = await this.sdk.messages.create(params);

    if (this.debug) {
      console.debug("[ClaudeEngine] Response:", JSON.stringify(message, null, 2));
    }

    return this.parseDecision(message);
  }

  // ─── Streaming entrypoint ────────────────────────────────────────────────────
  //
  // Yields text tokens as they arrive, then a final "decision" event once the
  // stream is complete. The decision is parsed from the full buffered message.

  async *decideStream(
    transcript: string,
    history: ConversationMessage[]
  ): AsyncGenerator<
    | { type: "token"; token: string }
    | { type: "decision"; decision: AgentDecision }
  > {
    const messages = this.buildMessages(transcript, history);

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      tools: AGENT_TOOLS,
      tool_choice: { type: "any", disable_parallel_tool_use: true },
      messages,
    };

    if (this.thinking) {
      params.thinking = { type: "adaptive" };
    }

    const stream = this.sdk.messages.stream(
      params as Anthropic.MessageStreamParams
    );

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield { type: "token", token: event.delta.text };
      }
    }

    const finalMessage = await stream.finalMessage();

    if (this.debug) {
      console.debug(
        "[ClaudeEngine] Stream final:",
        JSON.stringify(finalMessage, null, 2)
      );
    }

    yield { type: "decision", decision: this.parseDecision(finalMessage) };
  }

  // ─── Response → AgentDecision ─────────────────────────────────────────────────

  private parseDecision(message: Anthropic.Message): AgentDecision {
    // Primary path: first tool_use block
    const toolBlock = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (toolBlock) {
      if (!isValidAction(toolBlock.name)) {
        throw new Error(`ClaudeEngine: unknown action "${toolBlock.name}"`);
      }
      return {
        action: toolBlock.name as ToolAction,
        arguments: toolBlock.input as ToolArguments,
        ...(this.debug ? { raw: JSON.stringify(message.content) } : {}),
      };
    }

    // Fallback: model replied with text (shouldn't happen with tool_choice: any)
    const textBlock = message.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    const content = (textBlock?.text ?? "").trim();

    if (!content) {
      return { action: "talk", arguments: { response: "Einen Moment bitte." } };
    }

    // Attempt JSON recovery from text
    try {
      const cleaned = content
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      if (isValidAction(parsed["action"])) {
        return {
          action: parsed["action"] as ToolAction,
          arguments: (
            typeof parsed["arguments"] === "object" &&
            parsed["arguments"] !== null
              ? parsed["arguments"]
              : {}
          ) as ToolArguments,
          ...(this.debug ? { raw: content } : {}),
        };
      }
    } catch {
      // fall through to absolute fallback
    }

    return {
      action: "talk",
      arguments: { response: content.slice(0, 300) },
      ...(this.debug ? { raw: content } : {}),
    };
  }

  // ─── Message Builder ──────────────────────────────────────────────────────────
  //
  // Converts ConversationMessage[] to Anthropic.MessageParam[].
  // System messages are excluded — they belong in the top-level `system` param.
  // role:"tool" becomes role:"user" with a [Tool result]: prefix.

  private buildMessages(
    transcript: string,
    history: ConversationMessage[]
  ): Anthropic.MessageParam[] {
    const params: Anthropic.MessageParam[] = [];
    const trimmed = history.slice(-this.maxHistory);

    for (const msg of trimmed) {
      switch (msg.role) {
        case "system":
          break;
        case "user":
          params.push({ role: "user", content: msg.content });
          break;
        case "assistant":
          params.push({ role: "assistant", content: msg.content });
          break;
        case "tool":
          params.push({
            role: "user",
            content: `[Tool result]: ${msg.content}`,
          });
          break;
      }
    }

    params.push({ role: "user", content: transcript });
    return params;
  }
}

// ─── Conversation History Manager ─────────────────────────────────────────────
//
// Drop-in replacement for the deepseek.ts ConversationHistory — identical API.

export class ConversationHistory {
  private messages: ConversationMessage[] = [];
  private readonly maxMessages: number;

  constructor(maxMessages = DEFAULT_MAX_HISTORY) {
    this.maxMessages = maxMessages;
  }

  push(
    role: ConversationMessage["role"],
    content: string,
    extra?: Partial<ConversationMessage>
  ): void {
    this.messages.push({ role, content, ...extra });
    const nonSystem = this.messages.filter((m) => m.role !== "system");
    if (nonSystem.length > this.maxMessages) {
      const excess = nonSystem.length - this.maxMessages;
      let removed = 0;
      this.messages = this.messages.filter((m) => {
        if (m.role !== "system" && removed < excess) {
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

export function createClaudeEngine(config: ClaudeEngineConfig): ClaudeEngine {
  return new ClaudeEngine(config);
}
