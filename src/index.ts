import { nextOccurrence, normalizeDueDate } from "./dates";
import { extractWithClaude } from "./claude";
import { buildMorningReport, buildNightReport, handleScheduled } from "./scheduler";
import { escapeHtml, sendTelegramMessage } from "./telegram";
import { DecisionRow, Env, TaskRow } from "./types";

interface TelegramUpdate {
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string };
    chat: { id: number };
    text?: string;
  };
}

const RECURRENCE_BN: Record<string, string> = {
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
};

const HELP_TEXT = [
  "<b>Commands:</b>",
  "/tasks — show open tasks",
  "/done &lt;id&gt; — mark a task as done",
  "/edit &lt;id&gt; &lt;new title&gt; — rename a task",
  "/due &lt;id&gt; &lt;YYYY-MM-DD [HH:MM]&gt; — change a deadline (<code>/due 3 clear</code> removes it)",
  "/delete &lt;id&gt; — delete a task",
  "/decisions — show recent decisions",
  "/report — show the morning and night reports now",
  "",
  "Just send me a normal message and I will pull out the tasks and decisions. Words like \"every day\" or \"every week\" create repeating tasks.",
].join("\n");

function formatTask(t: TaskRow): string {
  const due = t.due_date ? ` (due: ${escapeHtml(t.due_date)})` : "";
  const rep = t.recurrence ? ` 🔁 ${RECURRENCE_BN[t.recurrence] ?? ""}` : "";
  return `• <b>#${t.id}</b> ${escapeHtml(t.title)}${due}${rep}`;
}

function parseId(s: string | undefined): number | null {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      // Status page: shows which settings are missing (never shows secret values)
      const check = (v: unknown) => (v ? "OK" : "MISSING");
      return new Response(
        [
          "S.A.R.A. Bot is running.",
          `TELEGRAM_BOT_TOKEN: ${check(env.TELEGRAM_BOT_TOKEN)}`,
          `ANTHROPIC_API_KEY: ${check(env.ANTHROPIC_API_KEY)}`,
          `ALLOWED_TELEGRAM_USER_ID: ${check(env.ALLOWED_TELEGRAM_USER_ID)}`,
          `WEBHOOK_SECRET: ${check(env.WEBHOOK_SECRET)}`,
          `DB binding: ${check(env.DB)}`,
          `CLAUDE_MODEL: ${env.CLAUDE_MODEL || "(default claude-haiku-5-5)"}`,
        ].join("\n"),
        { status: 200 }
      );
    }

    // সিক্রেট না থাকলে বা না মিললে অ্যাক্সেস বন্ধ (fail-closed)
    if (!env.WEBHOOK_SECRET) {
      console.error("WEBHOOK_SECRET is not configured; rejecting all requests.");
      return new Response("Server misconfigured", { status: 500 });
    }
    const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (secretHeader !== env.WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    let update: TelegramUpdate;
    try {
      update = (await request.json()) as TelegramUpdate;
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    const msg = update.message;
    if (!msg || !msg.text || !msg.from) {
      return new Response("OK", { status: 200 });
    }

    if (String(msg.from.id) !== String(env.ALLOWED_TELEGRAM_USER_ID).trim()) {
      console.warn(`Ignored unauthorized user: ${msg.from.id}`);
      return new Response("OK", { status: 200 });
    }

    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const tz = env.TIMEZONE || "Asia/Dhaka";
    const send = (t: string) => sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, t);

    try {
      if (text.startsWith("/")) {
        const cmdRaw = text.split(/\s+/)[0];
        const cmd = cmdRaw.split("@")[0].toLowerCase();
        const args = text.slice(cmdRaw.length).trim();
        const argParts = args ? args.split(/\s+/) : [];

        switch (cmd) {
          case "/start":
            await send(
              [
                "<b>Welcome! I am S.A.R.A.</b>",
                "<i>Smart Assistant for Reminders &amp; Actions</i>",
                "",
                "Send me any note or discussion and I will extract the <b>decisions</b> and <b>tasks</b>, remember them, and remind you on time.",
                "",
                HELP_TEXT,
              ].join("\n")
            );
            return new Response("OK", { status: 200 });

          case "/help":
            await send(HELP_TEXT);
            return new Response("OK", { status: 200 });

          case "/tasks": {
            const { results } = await env.DB.prepare(
              "SELECT id, title, due_date, status, created_at, recurrence FROM tasks WHERE status = 'open' ORDER BY id DESC LIMIT 20"
            ).all<TaskRow>();
            const countRow = await env.DB.prepare(
              "SELECT COUNT(*) AS n FROM tasks WHERE status = 'open'"
            ).first<{ n: number }>();
            const total = countRow?.n ?? results.length;

            if (!results.length) {
              await send("No open tasks.");
            } else {
              const more = total > results.length ? `\n<i>… showing the latest ${results.length} of ${total}</i>` : "";
              await send(`<b>Open tasks:</b>\n${results.map(formatTask).join("\n")}${more}`);
            }
            return new Response("OK", { status: 200 });
          }

          case "/done": {
            const taskId = parseId(argParts[0]);
            if (!taskId) {
              await send("Usage: <code>/done 1</code>");
              return new Response("OK", { status: 200 });
            }

            const task = await env.DB.prepare(
              "SELECT id, title, due_date, recurrence FROM tasks WHERE id = ? AND status = 'open'"
            )
              .bind(taskId)
              .first<TaskRow>();

            if (!task) {
              await send(`Open task #${taskId} not found.`);
              return new Response("OK", { status: 200 });
            }

            const stmts = [
              env.DB.prepare(
                "UPDATE tasks SET status = 'done', completed_at = datetime('now') WHERE id = ? AND status = 'open'"
              ).bind(taskId),
            ];

            let nextDue: string | null = null;
            if (task.recurrence) {
              nextDue = nextOccurrence(task.due_date, task.recurrence, tz);
              stmts.push(
                env.DB.prepare(
                  "INSERT INTO tasks (title, due_date, recurrence) VALUES (?, ?, ?)"
                ).bind(task.title, nextDue, task.recurrence)
              );
            }
            await env.DB.batch(stmts);

            await send(
              nextDue
                ? `Task #${taskId} done. 🔁 Next one created for ${escapeHtml(nextDue)}`
                : `Task #${taskId} marked as done.`
            );
            return new Response("OK", { status: 200 });
          }

          case "/edit": {
            const taskId = parseId(argParts[0]);
            const newTitle = argParts.slice(1).join(" ").trim();
            if (!taskId || !newTitle) {
              await send("Usage: <code>/edit 1 new title</code>");
              return new Response("OK", { status: 200 });
            }
            const res = await env.DB.prepare(
              "UPDATE tasks SET title = ? WHERE id = ? AND status = 'open'"
            )
              .bind(newTitle, taskId)
              .run();
            await send(
              res.meta.changes > 0
                ? `Task #${taskId} updated.`
                : `Open task #${taskId} not found.`
            );
            return new Response("OK", { status: 200 });
          }

          case "/due": {
            const taskId = parseId(argParts[0]);
            const rest = argParts.slice(1).join(" ").trim();
            const clear = /^(clear|none|মুছুন)$/i.test(rest);
            const newDue = clear ? null : normalizeDueDate(rest);
            if (!taskId || (!clear && !newDue)) {
              await send(
                "Usage: <code>/due 1 2026-12-01 18:30</code> or <code>/due 1 clear</code>"
              );
              return new Response("OK", { status: 200 });
            }
            // নতুন ডেডলাইনে আবার রিমাইন্ডার পাঠাতে reminded_at রিসেট
            const res = await env.DB.prepare(
              "UPDATE tasks SET due_date = ?, reminded_at = NULL WHERE id = ? AND status = 'open'"
            )
              .bind(newDue, taskId)
              .run();
            await send(
              res.meta.changes > 0
                ? newDue
                  ? `Task #${taskId} deadline set to ${escapeHtml(newDue)}`
                  : `Task #${taskId} deadline removed.`
                : `Open task #${taskId} not found.`
            );
            return new Response("OK", { status: 200 });
          }

          case "/delete": {
            const taskId = parseId(argParts[0]);
            if (!taskId) {
              await send("Usage: <code>/delete 1</code>");
              return new Response("OK", { status: 200 });
            }
            const res = await env.DB.prepare("DELETE FROM tasks WHERE id = ?")
              .bind(taskId)
              .run();
            await send(
              res.meta.changes > 0
                ? `Task #${taskId} deleted.`
                : `Task #${taskId} not found.`
            );
            return new Response("OK", { status: 200 });
          }

          case "/decisions": {
            const { results } = await env.DB.prepare(
              "SELECT id, summary, context, created_at FROM decisions ORDER BY id DESC LIMIT 15"
            ).all<DecisionRow>();
            if (!results.length) {
              await send("No decisions saved yet.");
            } else {
              const lines = results.map((d) => `• <b>#${d.id}</b> ${escapeHtml(d.summary)}`);
              await send(`<b>Recent decisions:</b>\n${lines.join("\n")}`);
            }
            return new Response("OK", { status: 200 });
          }

          case "/report": {
            // আলাদা বার্তায় পাঠানো হয় (৪০৯৬ অক্ষরের সীমা এড়াতে)
            await send(await buildMorningReport(env));
            await send(await buildNightReport(env));
            return new Response("OK", { status: 200 });
          }

          default:
            await send("I do not recognise that command.\n\n" + HELP_TEXT);
            return new Response("OK", { status: 200 });
        }
      }

      // Normal message -> analyse with Claude
      const extracted = await extractWithClaude(
        env.ANTHROPIC_API_KEY,
        env.CLAUDE_MODEL || "claude-haiku-5-5",
        tz,
        text
      );

      let addedTasks = 0;
      let skipped = 0;

      for (const task of extracted.tasks) {
        const dup = await env.DB.prepare(
          "SELECT id FROM tasks WHERE status = 'open' AND lower(title) = lower(?) AND COALESCE(due_date, '') = COALESCE(?, '')"
        )
          .bind(task.title, task.due_date)
          .first();
        if (dup) {
          skipped++;
          continue;
        }
        await env.DB.prepare(
          "INSERT INTO tasks (title, due_date, recurrence) VALUES (?, ?, ?)"
        )
          .bind(task.title, task.due_date, task.recurrence)
          .run();
        addedTasks++;
      }

      for (const decision of extracted.decisions) {
        const dup = await env.DB.prepare(
          "SELECT id FROM decisions WHERE lower(summary) = lower(?)"
        )
          .bind(decision.summary)
          .first();
        if (dup) {
          skipped++;
          continue;
        }
        await env.DB.prepare("INSERT INTO decisions (summary, context) VALUES (?, ?)")
          .bind(decision.summary, decision.context || null)
          .run();
      }

      let reply = escapeHtml(extracted.reply);
      if (skipped > 0) {
        reply += `\n\n<i>(${skipped} item(s) were already saved, so I did not add them again)</i>`;
      }
      await send(reply);
    } catch (err) {
      console.error("Handler error:", err instanceof Error ? err.message : String(err));
      await send("Sorry, something went wrong while processing your message. Please try again in a moment.");
    }

    return new Response("OK", { status: 200 });
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(handleScheduled(controller.cron, env));
  },
};
