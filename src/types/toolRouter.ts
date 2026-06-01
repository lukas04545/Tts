import type { AgentDecision, ToolAction } from "./deepseek";

// ─── Tool Result ───────────────────────────────────────────────────────────────
//
// Every handler returns a ToolResult. "speech" is the only field the TTS layer
// cares about — it's always set, even on error, so the pipeline never stalls.

export type ToolStatus = "ok" | "error" | "fallback";

export interface ToolResult {
  /** Text spoken aloud to the caller. Never empty. */
  speech: string;
  status: ToolStatus;
  action: ToolAction;
  /** Structured payload returned by the handler (stored in DB, passed to next layer, etc.) */
  data?: unknown;
  /** Present when status === "error" */
  error?: string;
}

// ─── Handler Interface ─────────────────────────────────────────────────────────

export type ToolHandler<TArgs = Record<string, unknown>> = (
  args: TArgs,
  decision: AgentDecision
) => Promise<ToolResult>;

// ─── Appointment Types ─────────────────────────────────────────────────────────

export interface AppointmentSlot {
  date: string;   // YYYY-MM-DD
  time: string;   // HH:MM
  available: boolean;
}

export interface BookingRecord {
  id: string;
  date: string;
  time: string;
  service: string;
  confirmedAt: string;  // ISO timestamp
}

// ─── Router Config ─────────────────────────────────────────────────────────────

export interface ToolRouterConfig {
  /**
   * Inject a custom DB/calendar adapter.
   * Falls back to in-memory stub when omitted — useful for development.
   */
  calendarAdapter?: CalendarAdapter;
  /**
   * Inject a custom FAQ data source.
   * Falls back to built-in static answers when omitted.
   */
  faqAdapter?: FaqAdapter;
  /**
   * Global timeout for a single handler call in milliseconds.
   * Default: 1 500ms (keeps total pipeline under phone latency budget).
   */
  handlerTimeoutMs?: number;
}

export interface CalendarAdapter {
  bookAppointment(date: string, time: string, service: string): Promise<BookingRecord>;
  checkAvailability(date: string): Promise<AppointmentSlot[]>;
}

export interface FaqAdapter {
  lookup(question: string): Promise<string | null>;
}
