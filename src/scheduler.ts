import { getLocalDateTimeParts, utcSqlToLocalDate } from "./dates";
import { escapeHtml, sendTelegramMessage } from "./telegram";
import { DecisionRow, Env, TaskRow } from "./types";

export function isQuietHours(env: Env): boolean {
  const { hour } = getLocalDateTimeParts(env.TIMEZONE || "Asia/Dhaka");
  const start = Number(env.QUIET_START_HOUR ?? 23);
  const end = Number(env.QUIET_END_HOUR ?? 7);

  if (start > end) {
    return hour >= start || hour < end;
  }
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
  const overdueTasks = openTasks.filter(
    (t) => t.due_date && t.due_date.slice(0, 10) < today
  );
  const otherTasks = openTasks.filter(
    (t) => !t.due_date || t.due_date.slice(0, 10) > today
  );

  const lines: string[] = [`<b>সুপ্রভাত! আজকের কাজের তালিকা (${today})</b>`];

  if (todayTasks.length) {
    lines.push("", "<b>আজকের নির্ধারিত কাজ:</b>");
    todayTasks.forEach((t) =>
      lines.push(`• <b>#${t.id}</b> ${escapeHtml(t.title)} (${escapeHtml(t.due_date!)})${repeatMark(t)}`)
    );
  }

  if (overdueTasks.length) {
    lines.push("", "<b>পুরোনো অসম্পন্ন কাজ (সময় পার হয়েছে):</b>");
    overdueTasks.forEach((t) =>
      lines.push(`• <b>#${t.id}</b> ${escapeHtml(t.title)} (${escapeHtml(t.due_date!)})${repeatMark(t)}`)
    );
  }

  if (otherTasks.length) {
    lines.push("", "<b>অন্যান্য খোলা কাজ:</b>");
    otherTasks.slice(0, 10).forEach((t) => {
      const due = t.due_date ? ` (${escapeHtml(t.due_date)})` : "";
      lines.push(`• <b>#${t.id}</b> ${escapeHtml(t.title)}${due}${repeatMark(t)}`);
    });
    if (otherTasks.length > 10) {
      lines.push(`<i>… আরও ${otherTasks.length - 10}টি (/tasks দেখুন)</i>`);
    }
  }

  if (!openTasks.length) {
    lines.push("", "আজ কোনো খোলা করণীয় নেই। আপনার দিনটি শুভ হোক!");
  }

  return lines.join("\n");
}

export async function buildNightReport(env: Env): Promise<string> {
  const tz = env.TIMEZONE || "Asia/Dhaka";
  const { dateStr: today } = getLocalDateTimeParts(tz);
  const { dateStr: tomorrow } = getLocalDateTimeParts(tz, 1);

  // টাইমজোন-নিরপেক্ষ: গত ২ দিনের রেকর্ড এনে JS-এ স্থানীয় তারিখ মিলিয়ে নেওয়া হয়
  const { results: recentDone } = await env.DB.prepare(
    "SELECT id, title, completed_at FROM tasks WHERE status = 'done' AND completed_at >= datetime('now', '-2 days') ORDER BY id DESC"
  ).all<TaskRow>();
  const doneToday = recentDone.filter(
    (t) => utcSqlToLocalDate(t.completed_at, tz) === today
  );

  const { results: recentDecisions } = await env.DB.prepare(
    "SELECT id, summary, created_at FROM decisions WHERE created_at >= datetime('now', '-2 days') ORDER BY id DESC"
  ).all<DecisionRow>();
  const decisionsToday = recentDecisions.filter(
    (d) => utcSqlToLocalDate(d.created_at, tz) === today
  );

  const { results: tomorrowTasks } = await env.DB.prepare(
    "SELECT id, title, due_date, recurrence FROM tasks WHERE status = 'open' AND due_date LIKE ? ORDER BY due_date ASC"
  )
    .bind(`${tomorrow}%`)
    .all<TaskRow>();

  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM tasks WHERE status = 'open'"
  ).first<{ n: number }>();
  const totalOpen = countRow?.n ?? 0;

  const lines: string[] = [`<b>আজকের সারসংক্ষেপ (${today})</b>`];

  lines.push("", `<b>আজ সম্পন্ন হয়েছে (${doneToday.length}টি):</b>`);
  if (doneToday.length) {
    doneToday.forEach((t) => lines.push(`• #${t.id} ${escapeHtml(t.title)}`));
  } else {
    lines.push("• আজ কোনো কাজ সম্পন্ন হিসেবে চিহ্নিত হয়নি।");
  }

  if (decisionsToday.length) {
    lines.push("", `<b>আজকের সিদ্ধান্ত (${decisionsToday.length}টি):</b>`);
    decisionsToday.forEach((d) => lines.push(`• #${d.id} ${escapeHtml(d.summary)}`));
  }

  lines.push("", `<b>আগামীকাল (${tomorrow}) করণীয়:</b>`);
  if (tomorrowTasks.length) {
    tomorrowTasks.forEach((t) =>
      lines.push(`• <b>#${t.id}</b> ${escapeHtml(t.title)} (${escapeHtml(t.due_date!)})${repeatMark(t)}`)
    );
  } else {
    lines.push("• আগামীকালের জন্য নির্দিষ্ট তারিখের কোনো কাজ নেই।");
  }

  if (totalOpen > 0) {
    lines.push("", `<i>মোট অসম্পন্ন খোলা কাজ: ${totalOpen}টি (/tasks দিয়ে দেখুন)</i>`);
  }

  return lines.join("\n");
}

export async function checkDueReminders(env: Env, chatId: number): Promise<void> {
  if (isQuietHours(env)) {
    return;
  }

  const tz = env.TIMEZONE || "Asia/Dhaka";
  const { dateTimeStr } = getLocalDateTimeParts(tz);

  // REPLACE(...'T'...) পুরোনো রেকর্ডে ভুল ফরম্যাট থাকলেও তুলনা ঠিক রাখে
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
      `⏰ <b>S.A.R.A. রিমাইন্ডার:</b> #${task.id} ${escapeHtml(task.title)}\nনির্ধারিত সময়: ${escapeHtml(task.due_date!)}\n<i>সম্পন্ন হলে /done ${task.id}</i>`
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
    const report = await buildMorningReport(env);
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, report);
  } else if (cron === "0 15 * * *") {
    const report = await buildNightReport(env);
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, report);
  } else {
    await checkDueReminders(env, chatId);
  }
}
