const MAX_LEN = 4000; // Telegram-এর সীমা ৪০৯৬

function splitMessage(text: string): string[] {
  if (text.length <= MAX_LEN) return [text];
  const parts: string[] = [];
  let cur = "";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.length > MAX_LEN ? rawLine.slice(0, MAX_LEN) : rawLine;
    if (cur && cur.length + 1 + line.length > MAX_LEN) {
      parts.push(cur);
      cur = line;
    } else {
      cur = cur ? `${cur}\n${line}` : line;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: number,
  text: string
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  for (const part of splitMessage(text)) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: part, parse_mode: "HTML" }),
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error("Telegram sendMessage error:", response.status, errText);
    }
  }
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
