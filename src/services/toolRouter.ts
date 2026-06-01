/**
 * Tool Router
 *
 * Receives a validated AgentDecision from the DeepSeek layer and dispatches
 * it to the correct handler. Every handler returns a ToolResult whose "speech"
 * field is passed directly to ElevenLabs TTS.
 *
 * Design principles:
 *   - No unhandled exceptions. Every code path produces a ToolResult.
 *   - Argument shapes are re-validated here (defensive — client may pass
 *     partially-formed objects from other integrations).
 *   - Handler timeout enforced at this layer, not inside handlers, so
 *     adapters never need their own timeout logic.
 *   - Adapters are injected — tests swap them without touching the router.
 */

import type { AgentDecision, ToolArguments } from "../types/deepseek";
import type {
  AppointmentSlot,
  BookingRecord,
  CalendarAdapter,
  FaqAdapter,
  ToolResult,
  ToolRouterConfig,
} from "../types/toolRouter";

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_HANDLER_TIMEOUT_MS = 1_500;

// ─── Fallback Speeches ──────────────────────────────────────────────────────────
//
// Used whenever a handler fails or receives unusable arguments.
// Phrased to sound natural on a phone call.

const FALLBACK = {
  generic:
    "Entschuldigung, da ist leider etwas schiefgelaufen. Wie kann ich Ihnen sonst helfen?",
  timeout:
    "Das hat leider etwas zu lange gedauert. Bitte versuchen Sie es gleich nochmal.",
  missingDate:
    "Für welches Datum möchten Sie einen Termin?",
  missingTime:
    "Zu welcher Uhrzeit soll der Termin stattfinden?",
  missingService:
    "Um welche Art von Termin handelt es sich?",
  noSlots:
    "Für diesen Tag sind leider keine freien Termine verfügbar. Soll ich einen anderen Tag prüfen?",
  faqNotFound:
    "Diese Information habe ich leider gerade nicht zur Hand. Kann ich Ihnen auf andere Weise helfen?",
  unknownAction:
    "Ich habe Ihre Anfrage leider nicht verstanden. Können Sie das bitte wiederholen?",
} as const;

// ─── Argument Guards ───────────────────────────────────────────────────────────
//
// Re-validate argument shapes at runtime. The types from deepseek.ts describe
// what the model *should* return; these guards verify what it *did* return.

function getString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function toRecord(args: ToolArguments): Record<string, unknown> {
  if (typeof args === "object" && args !== null && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return {};
}

// ─── Handler Timeout Wrapper ───────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Handler "${label}" timed out after ${ms}ms`)),
        ms
      )
    ),
  ]);
}

// ─── Built-in Adapters (stubs — replace with real DB/API in production) ────────

class InMemoryCalendarAdapter implements CalendarAdapter {
  private bookings: BookingRecord[] = [];

  async bookAppointment(date: string, time: string, service: string): Promise<BookingRecord> {
    const record: BookingRecord = {
      id: `APT-${Date.now()}`,
      date,
      time,
      service,
      confirmedAt: new Date().toISOString(),
    };
    this.bookings.push(record);
    return record;
  }

  async checkAvailability(date: string): Promise<AppointmentSlot[]> {
    // Stub: return three fixed morning slots
    const times = ["09:00", "10:30", "14:00"];
    const booked = new Set(
      this.bookings.filter((b) => b.date === date).map((b) => b.time)
    );
    return times.map((t) => ({ date, time: t, available: !booked.has(t) }));
  }
}

class StaticFaqAdapter implements FaqAdapter {
  private readonly answers: ReadonlyMap<string, string> = new Map([
    ["öffnungszeiten", "Wir sind Montag bis Freitag von 8 bis 18 Uhr für Sie da."],
    ["stornierung",    "Termine können bis 24 Stunden vorher kostenlos storniert werden."],
    ["parken",         "Direkt vor dem Gebäude stehen kostenlose Parkplätze zur Verfügung."],
    ["adresse",        "Sie finden uns in der Musterstraße 1, 10115 Berlin."],
    ["preis",          "Die Preise variieren je nach Leistung. Ich verbinde Sie gerne mit unserem Team."],
    ["zahlung",        "Wir akzeptieren Barzahlung, EC-Karte und alle gängigen Kreditkarten."],
    ["dauer",          "Ein Standardtermin dauert in der Regel 30 bis 60 Minuten."],
  ]);

  async lookup(question: string): Promise<string | null> {
    const q = question.toLowerCase();
    for (const [keyword, answer] of this.answers) {
      if (q.includes(keyword)) return answer;
    }
    return null;
  }
}

// ─── Handlers ──────────────────────────────────────────────────────────────────

async function handleBookAppointment(
  args: Record<string, unknown>,
  calendar: CalendarAdapter
): Promise<ToolResult> {
  const date    = getString(args, "date");
  const time    = getString(args, "time");
  const service = getString(args, "service");
  const speech  = getString(args, "response");

  // Ask for exactly one missing field at a time (mirrors system prompt rule)
  if (!date)    return { status: "fallback", action: "book_appointment", speech: FALLBACK.missingDate };
  if (!time)    return { status: "fallback", action: "book_appointment", speech: FALLBACK.missingTime };
  if (!service) return { status: "fallback", action: "book_appointment", speech: FALLBACK.missingService };

  const record = await calendar.bookAppointment(date, time, service);

  const confirmedSpeech =
    speech ??
    `Ihr Termin am ${formatDate(record.date)} um ${record.time} Uhr wurde erfolgreich gebucht. Ihre Buchungsnummer lautet ${record.id}.`;

  return {
    status: "ok",
    action: "book_appointment",
    speech: confirmedSpeech,
    data: record,
  };
}

async function handleCheckAvailability(
  args: Record<string, unknown>,
  calendar: CalendarAdapter
): Promise<ToolResult> {
  const date   = getString(args, "date");
  const speech = getString(args, "response");

  if (!date) {
    return { status: "fallback", action: "check_availability", speech: FALLBACK.missingDate };
  }

  const slots = await calendar.checkAvailability(date);
  const freeSlots = slots.filter((s) => s.available);

  if (freeSlots.length === 0) {
    return {
      status: "ok",
      action: "check_availability",
      speech: FALLBACK.noSlots,
      data: { date, slots },
    };
  }

  const slotList = freeSlots.map((s) => s.time).join(", ");
  const generatedSpeech = `Am ${formatDate(date)} sind folgende Zeiten frei: ${slotList} Uhr. Welche Zeit passt Ihnen?`;

  return {
    status: "ok",
    action: "check_availability",
    speech: speech ?? generatedSpeech,
    data: { date, slots },
  };
}

async function handleFaq(
  args: Record<string, unknown>,
  faq: FaqAdapter
): Promise<ToolResult> {
  const question = getString(args, "question");
  const speech   = getString(args, "response");

  if (!question) {
    return { status: "fallback", action: "faq", speech: FALLBACK.generic };
  }

  const answer = await faq.lookup(question);

  if (!answer) {
    return {
      status: "fallback",
      action: "faq",
      speech: FALLBACK.faqNotFound,
      data: { question },
    };
  }

  return {
    status: "ok",
    action: "faq",
    speech: speech ? `${speech} ${answer}` : answer,
    data: { question, answer },
  };
}

function handleTalk(args: Record<string, unknown>): ToolResult {
  const speech = getString(args, "response");

  if (!speech) {
    return { status: "fallback", action: "talk", speech: FALLBACK.generic };
  }

  return { status: "ok", action: "talk", speech };
}

// ─── Date Formatter ────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  // "2026-06-05" → "5. Juni 2026"
  try {
    const d = new Date(`${iso}T12:00:00Z`);
    return d.toLocaleDateString("de-DE", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return iso;
  }
}

// ─── Tool Router ───────────────────────────────────────────────────────────────

export class ToolRouter {
  private readonly calendar: CalendarAdapter;
  private readonly faq: FaqAdapter;
  private readonly timeoutMs: number;

  constructor(config: ToolRouterConfig = {}) {
    this.calendar   = config.calendarAdapter ?? new InMemoryCalendarAdapter();
    this.faq        = config.faqAdapter      ?? new StaticFaqAdapter();
    this.timeoutMs  = config.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS;
  }

  /**
   * Route an AgentDecision to the correct handler and return a ToolResult.
   * Never throws — all errors are converted to a ToolResult with status "error".
   */
  async route(decision: AgentDecision): Promise<ToolResult> {
    const args = toRecord(decision.arguments);

    try {
      const result = await withTimeout(
        this.dispatch(decision.action, args),
        this.timeoutMs,
        decision.action
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = message.includes("timed out");

      return {
        status: "error",
        action: decision.action,
        speech: isTimeout ? FALLBACK.timeout : FALLBACK.generic,
        error: message,
      };
    }
  }

  // ─── Private dispatch ──────────────────────────────────────────────────────

  private dispatch(
    action: AgentDecision["action"],
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    switch (action) {
      case "book_appointment":
        return handleBookAppointment(args, this.calendar);

      case "check_availability":
        return handleCheckAvailability(args, this.calendar);

      case "faq":
        return handleFaq(args, this.faq);

      case "talk":
        // Synchronous — wrap in Promise.resolve so dispatch is always async
        return Promise.resolve(handleTalk(args));

      default: {
        // TypeScript exhaustiveness check: if a new action is added to the
        // union without a case, this line produces a compile error.
        const _exhaustive: never = action;
        void _exhaustive;
        return Promise.resolve({
          status: "error" as const,
          action: "talk" as const,
          speech: FALLBACK.unknownAction,
          error: `Unhandled action: ${String(action)}`,
        });
      }
    }
  }
}

// ─── Factory ───────────────────────────────────────────────────────────────────

export function createToolRouter(config?: ToolRouterConfig): ToolRouter {
  return new ToolRouter(config);
}
