import { GeminiExtractionResult } from "./types";

export function getLocalDateTimeParts(timezone: string, offsetDays = 0): {
  dateStr: string;
  dateTimeStr: string;
  hour: number;
} {
  const target = new Date(Date.now() + offsetDays * 86400000);
  const formatted = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone || "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(target);

  const [dateStr, timePart] = formatted.split(" ");
  const hour = Number(timePart.split(":")[0]);
  return { dateStr, dateTimeStr: formatted, hour };
}

export async function extractWithGemini(
  apiKey: string,
  model: string,
  timezone: string,
  userMessage: string
): Promise<GeminiExtractionResult> {
  const { dateTimeStr } = getLocalDateTimeParts(timezone);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const systemInstruction = `You are "S.A.R.A." (Smart Assistant for Reminders & Actions), a personal executive assistant for a busy Bangla-speaking user.
Current local date and time (${timezone}): ${dateTimeStr}.

Analyze the user's message (which may be in Bangla, English, or Banglish) and extract:
1. "decisions": concrete decisions already made or agreed upon.
2. "tasks": actionable to-dos / action items. Resolve relative dates (like "আগামীকাল", "পরশু", "next Monday", "রাত ৯টায়") into "YYYY-MM-DD HH:MM" (24-hour) or "YYYY-MM-DD" using the current local time above; use null if no deadline is mentioned.
3. "reply_bn": a concise, natural, helpful confirmation in Bangla summarizing what was saved (or answering directly if it's a general question with no tasks/decisions).`;

  const payload = {
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userMessage }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          decisions: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                summary: { type: "STRING" },
                context: { type: "STRING" },
              },
              required: ["summary", "context"],
            },
          },
          tasks: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                due_date: { type: "STRING", nullable: true },
              },
              required: ["title"],
            },
          },
          reply_bn: { type: "STRING" },
        },
        required: ["decisions", "tasks", "reply_bn"],
      },
    },
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawJson) {
    throw new Error("Empty response from Gemini API");
  }

  return JSON.parse(rawJson) as GeminiExtractionResult;
}
