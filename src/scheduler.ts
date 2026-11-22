import { getLocalDateTimeParts, utcSqlToLocalDate } from "./dates";
import { escapeHtml, sendTelegramMessage } from "./telegram";
import { DecisionRow, Env, TaskRow } from "./types";

export function isQuietHours(env: Env): boolean {
  const { hour } = getLocalDateTimeParts(env.TIMEZONE || "Asia/Dhaka");
  const start = Number(env.QUIET_START_HOUR ?? 23);
  const end = Number(env.QUIET_END_HOUR ?? 7);
  if (start > end) return hour >= start || hour < end;
  return hour >= start && hour < end;
}

function repeatMark(t: TaskRow): string {
  return t.recurrence ? " 🔁" : "";
}

export async function buildMorningReport(env: Env): Promise<string> {
  const tz = env.TIMEZONE || "Asia/Dhaka";
  const { dateStr: today } = getLocalDateTimeParts(tz);

  const { results: openTasks } = await env.DB.prepare(
    `SELECT id, title, due_date, recurrence FROM tasks
     WHERE status = 'open'
     ORDER BY due_date IS NULL, due_date ASC, id DESC LIMIT 50`
  ).all<TaskRow>();

  const todayTasks = openTasks.filter((t) => t.due_date && t.due_date.startsWith(today));
  const overdueTasks = openTasks.filter((t) => t.due_date && t.due_date.slice(0, 10) < today);
  const otherTasks = openTasks.filter((t) => !t.due_date || t.due_date.slice(0, 10) > today);

  const lines: string[] = [`<b>Good morning! Your plan for today (${today})</b>`];

  if (todayTasks.length) {
    lines.push("", "<b>Due today:</b>");
    todayTasks.forEach((t) =>
      lines.push(`• <b>#${t.id}</b> ${escapeHtml(t.title)} (${escapeHtml(t.due_date!)})${repeatMark(t)}`)
    );
  }

  if (overdueTasks.length) {
    lines.push("", "<b>Overdue:</b>");
    overdueTasks.forEach((t) =>
      lines.push(`• <b>#${t.id}</b> ${escapeHtml(t.title)} (${escapeHtml(t.due_date!)})${repeatMark(t)}`)
    );
  }

  if (otherTasks.length) {
    lines.push("", "<b>Other open tasks:</b>");
    otherTasks.slice(0, 10).forEach((t) => {
      const due = t.due_date ? ` (${escapeHtml(t.due_date)})` : "";
      lines.push(`• <b>#${t.id}</b> ${escapeHtml(t.title)}${due}${repeatMark(t)}`);
    });
    if (otherTasks.length > 10) {
      lines.push(`<i>… and ${otherTasks.length - 10} more (see /tasks)</i>`);
    }
  }

  if (!openTasks.length) {
    lines.push("", "No open tasks today. Have a great day!");
  }

  return lines.join("\n");
}

export async function buildNightReport(env: Env): Promise<string> {
  const tz = env.TIMEZONE || "Asia/Dhaka";
  const { dateStr: today } = getLocalDateTimeParts(tz);
  const { dateStr: tomorrow } = getLocalDateTimeParts(tz, 1);

  const { results: recentDone } = await env.DB.prepare(
    "SELECT id, title, completed_at FROM tasks WHERE status = 'done' AND completed_at >= datetime('now', '-2 days') ORDER BY id DESC"
  ).all<TaskRow>();
  const doneToday = recentDone.filter((t) => utcSqlToLocalDate(t.completed_at, tz) === today);

  const { results: recentDecisions } = await env.DB.prepare(
    "SELECT id, summary, created_at FROM decisions WHERE created_at >= datetime('now', '-2 days') ORDER BY id DESC"
  ).all<DecisionRow>();
  const decisionsToday = recentDecisions.filter((d) => utcSqlToLocalDate(d.created_at, tz) === today);

  const { results: tomorrowTasks } = await env.DB.prepare(
    "SELECT id, title, due_date, recurrence FROM tasks WHERE status = 'open' AND due_date LIKE ? ORDER BY due_date ASC"
  )
    .bind(`${tomorrow}%`)
    .all<TaskRow>();

  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM tasks WHERE status = 'open'"
  ).first<{ n: number }>();
  const totalOpen = countRow?.n ?? 0;

  const lines: string[] = [`<b>Daily summary (${today})</b>`];

  lines.push("", `<b>Completed today (${doneToday.length}):</b>`);
  if (doneToday.length) {
    doneToday.forEach((t) => lines.push(`• #${t.id} ${escapeHtml(t.title)}`));
  } else {
    lines.push("• Nothing marked as done today.");
  }

  if (decisionsToday.length) {
    lines.push("", `<b>Decisions today (${decisionsToday.length}):</b>`);
    decisionsToday.forEach((d) => lines.push(`• #${d.id} ${escapeHtml(d.summary)}`));
  }

  lines.push("", `<b>Tomorrow (${tomorrow}):</b>`);
  if (tomorrowTasks.length) {
    tomorrowTasks.forEach((t) =>
      lines.push(`• <b>#${t.id}</b> ${escapeHtml(t.title)} (${escapeHtml(t.due_date!)})${repeatMark(t)}`)
    );
  } else {
    lines.push("• Nothing scheduled for tomorrow.");
  }

  if (totalOpen > 0) {
    lines.push("", `<i>Total open tasks: ${totalOpen} (see /tasks)</i>`);
  }

  return lines.join("\n");
}

export async function checkDueReminders(env: Env, chatId: number): Promise<void> {
  if (isQuietHours(env)) return;

  const tz = env.TIMEZONE || "Asia/Dhaka";
  const { dateTimeStr } = getLocalDateTimeParts(tz);

  const { results } = await env.DB.prepare(
    `SELECT id, title, due_date FROM tasks
     WHERE status = 'open'
       AND due_date IS NOT NULL
       AND length(due_date) >= 16
       AND REPLACE(due_date, 'T', ' ') <= ?
       AND reminded_at IS NULL
     ORDER BY due_date ASC LIMIT 10`
  )
    .bind(dateTimeStr)
    .all<TaskRow>();

  for (const task of results) {
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `⏰ <b>S.A.R.A. reminder:</b> #${task.id} ${escapeHtml(task.title)}\nDue: ${escapeHtml(task.due_date!)}\n<i>When finished: /done ${task.id}</i>`
    );
    await env.DB.prepare("UPDATE tasks SET reminded_at = datetime('now') WHERE id = ?")
      .bind(task.id)
      .run();
  }
}

export async function handleScheduled(cron: string, env: Env): Promise<void> {
  const chatId = Number(env.ALLOWED_TELEGRAM_USER_ID);
  if (!Number.isFinite(chatId)) {
    console.error("ALLOWED_TELEGRAM_USER_ID is not configured.");
    return;
  }

  if (cron === "0 2 * * *") {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, await buildMorningReport(env));
  } else if (cron === "0 15 * * *") {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, await buildNightReport(env));
  } else {
    await checkDueReminders(env, chatId);
  }
}
