import { getLocalDateTimeParts, normalizeDueDate } from "./dates";
import { ExtractionResult, Recurrence } from "./types";

const RECURRENCES: Recurrence[] = ["daily", "weekly", "monthly"];

// Forced tool-use guarantees schema-shaped JSON back from Claude.
const EXTRACT_TOOL = {
  name: "save_extraction",
  description:
    "Save the decisions and tasks extracted from the user's message, plus a short reply.",
  input_schema: {
    type: "object",
    properties: {
      decisions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            summary: { type: "string" },
            context: { type: "string" },
          },
          required: ["summary", "context"],
        },
      },
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            due_date: {
              type: ["string", "null"],
              description:
                'Exactly "YYYY-MM-DD HH:MM" (24h) or "YYYY-MM-DD", or null if no deadline.',
            },
            recurrence: {
              type: ["string", "null"],
              enum: ["daily", "weekly", "monthly", null],
            },
          },
          required: ["title", "due_date", "recurrence"],
        },
      },
      reply: { type: "string" },
    },
    required: ["decisions", "tasks", "reply"],
  },
};

export async function extractWithClaude(
  apiKey: string,
  model: string,
  timezone: string,
  userMessage: string
): Promise<ExtractionResult> {
  const { dateTimeStr } = getLocalDateTimeParts(timezone);

  const system = `You are "S.A.R.A." (Smart Assistant for Reminders & Actions), a personal executive assistant for a busy user who writes in English, Bangla, or Banglish.
Current local date and time (${timezone}): ${dateTimeStr}.

Analyze the user's message (Bangla, English, or Banglish) and call the save_extraction tool with:
1. "decisions": concrete decisions already made or agreed upon.
2. "tasks": actionable to-dos.
   - "due_date": resolve relative dates ("আগামীকাল", "পরশু", "next Monday", "রাত ৯টায়") using the current local time above.
     STRICT FORMAT: exactly "YYYY-MM-DD HH:MM" (24-hour, single space, no "T", no seconds, no timezone) when a time is given, or "YYYY-MM-DD" when only a date is given. Use null if no deadline is mentioned.
   - "recurrence": "daily", "weekly" or "monthly" ONLY if the user clearly wants it repeated (e.g. "প্রতিদিন", "every week", "প্রতি মাসে"); otherwise null.
3. "reply": a concise, natural, helpful confirmation summarizing what was saved (or answering directly if it's a general question with no tasks/decisions). Write the reply in the SAME language the user wrote in (English by default; Bangla only if the user wrote in Bangla).
If nothing is extractable, return empty arrays and answer helpfully in reply.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: userMessage }],
      tools: [EXTRACT_TOOL],
      tool_choice: { type: "tool", name: EXTRACT_TOOL.name },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API error (${res.status}): ${errText.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; name?: string; input?: unknown }>;
  };
  const block = data.content?.find(
    (b) => b.type === "tool_use" && b.name === EXTRACT_TOOL.name
  );
  if (!block || typeof block.input !== "object" || block.input === null) {
    throw new Error("Claude API returned no tool_use result");
  }

  const parsed = block.input as Partial<ExtractionResult>;

  const tasks = (Array.isArray(parsed.tasks) ? parsed.tasks : [])
    .filter((t) => t && typeof t.title === "string" && t.title.trim())
    .map((t) => ({
      title: t.title.trim(),
      due_date: normalizeDueDate(t.due_date),
      recurrence: RECURRENCES.includes(t.recurrence as Recurrence)
        ? (t.recurrence as Recurrence)
        : null,
    }));

  const decisions = (Array.isArray(parsed.decisions) ? parsed.decisions : [])
    .filter((d) => d && typeof d.summary === "string" && d.summary.trim())
    .map((d) => ({
      summary: d.summary.trim(),
      context: typeof d.context === "string" ? d.context : "",
    }));

  return {
    tasks,
    decisions,
    reply:
      typeof parsed.reply === "string" && parsed.reply.trim()
        ? parsed.reply
        : "Got it.",
  };
}
