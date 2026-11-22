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
  daily: "প্রতিদিন",
  weekly: "প্রতি সপ্তাহে",
  monthly: "প্রতি মাসে",
};

const HELP_TEXT = [
  "<b>কমান্ডসমূহ:</b>",
  "/tasks — খোলা করণীয় দেখুন",
  "/done &lt;id&gt; — করণীয় সম্পন্ন করুন",
  "/edit &lt;id&gt; &lt;নতুন শিরোনাম&gt; — শিরোনাম বদলান",
  "/due &lt;id&gt; &lt;YYYY-MM-DD [HH:MM]&gt; — ডেডলাইন বদলান (<code>/due 3 clear</code> দিলে মুছে যাবে)",
  "/delete &lt;id&gt; — করণীয় মুছে ফেলুন",
  "/decisions — সাম্প্রতিক সিদ্ধান্ত দেখুন",
  "/report — সকাল ও রাতের রিপোর্ট এখনই দেখুন",
  "",
  "সাধারণ বার্তা পাঠালে আমি নিজেই করণীয় ও সিদ্ধান্ত বের করে নেব। \"প্রতিদিন\", \"প্রতি সপ্তাহে\" লিখলে পুনরাবৃত্ত কাজ হিসেবে সংরক্ষিত হবে।",
].join("\n");

function formatTask(t: TaskRow): string {
  const due = t.due_date ? ` (সময়: ${escapeHtml(t.due_date)})` : "";
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
      return new Response("S.A.R.A. Bot is running.", { status: 200 });
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
                "<b>স্বাগতম! আমি S.A.R.A.</b>",
                "<i>Smart Assistant for Reminders &amp; Actions</i>",
                "",
                "যেকোনো আলোচনা বা নোট পাঠালে আমি তা থেকে <b>সিদ্ধান্ত</b> ও <b>করণীয়</b> বের করে মনে রাখব এবং সময়মতো রিমাইন্ডার দেব।",
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
              await send("কোনো খোলা করণীয় নেই।");
            } else {
              const more = total > results.length ? `\n<i>… মোট ${total}টির মধ্যে সাম্প্রতিক ${results.length}টি দেখানো হলো</i>` : "";
              await send(`<b>খোলা করণীয়:</b>\n${results.map(formatTask).join("\n")}${more}`);
            }
            return new Response("OK", { status: 200 });
          }

          case "/done": {
            const taskId = parseId(argParts[0]);
            if (!taskId) {
              await send("সঠিক নিয়ম: <code>/done 1</code>");
              return new Response("OK", { status: 200 });
            }

            const task = await env.DB.prepare(
              "SELECT id, title, due_date, recurrence FROM tasks WHERE id = ? AND status = 'open'"
            )
              .bind(taskId)
              .first<TaskRow>();

            if (!task) {
              await send(`খোলা করণীয় #${taskId} পাওয়া যায়নি।`);
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
                ? `করণীয় #${taskId} সম্পন্ন হয়েছে। 🔁 পরবর্তী কাজ তৈরি হয়েছে: ${escapeHtml(nextDue)}`
                : `করণীয় #${taskId} সম্পন্ন হিসেবে চিহ্নিত হয়েছে।`
            );
            return new Response("OK", { status: 200 });
          }

          case "/edit": {
            const taskId = parseId(argParts[0]);
            const newTitle = argParts.slice(1).join(" ").trim();
            if (!taskId || !newTitle) {
              await send("সঠিক নিয়ম: <code>/edit 1 নতুন শিরোনাম</code>");
              return new Response("OK", { status: 200 });
            }
            const res = await env.DB.prepare(
              "UPDATE tasks SET title = ? WHERE id = ? AND status = 'open'"
            )
              .bind(newTitle, taskId)
              .run();
            await send(
              res.meta.changes > 0
                ? `করণীয় #${taskId} আপডেট হয়েছে।`
                : `খোলা করণীয় #${taskId} পাওয়া যায়নি।`
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
                "সঠিক নিয়ম: <code>/due 1 2026-12-01 18:30</code> বা <code>/due 1 clear</code>"
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
                  ? `করণীয় #${taskId}-এর ডেডলাইন: ${escapeHtml(newDue)}`
                  : `করণীয় #${taskId}-এর ডেডলাইন মুছে ফেলা হয়েছে।`
                : `খোলা করণীয় #${taskId} পাওয়া যায়নি।`
            );
            return new Response("OK", { status: 200 });
          }

          case "/delete": {
            const taskId = parseId(argParts[0]);
            if (!taskId) {
              await send("সঠিক নিয়ম: <code>/delete 1</code>");
              return new Response("OK", { status: 200 });
            }
            const res = await env.DB.prepare("DELETE FROM tasks WHERE id = ?")
              .bind(taskId)
              .run();
            await send(
              res.meta.changes > 0
                ? `করণীয় #${taskId} মুছে ফেলা হয়েছে।`
                : `করণীয় #${taskId} পাওয়া যায়নি।`
            );
            return new Response("OK", { status: 200 });
          }

          case "/decisions": {
            const { results } = await env.DB.prepare(
              "SELECT id, summary, context, created_at FROM decisions ORDER BY id DESC LIMIT 15"
            ).all<DecisionRow>();
            if (!results.length) {
              await send("এখনো কোনো সিদ্ধান্ত সংরক্ষিত নেই।");
            } else {
              const lines = results.map((d) => `• <b>#${d.id}</b> ${escapeHtml(d.summary)}`);
              await send(`<b>সাম্প্রতিক সিদ্ধান্তসমূহ:</b>\n${lines.join("\n")}`);
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
            await send("কমান্ডটি চিনতে পারিনি।\n\n" + HELP_TEXT);
            return new Response("OK", { status: 200 });
        }
      }

      // সাধারণ বার্তা -> Claude দিয়ে বিশ্লেষণ
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

      let reply = escapeHtml(extracted.reply_bn);
      if (skipped > 0) {
        reply += `\n\n<i>(${skipped}টি আগে থেকেই সংরক্ষিত থাকায় আবার যোগ করা হয়নি)</i>`;
      }
      await send(reply);
    } catch (err) {
      console.error("Handler error:", err instanceof Error ? err.message : String(err));
      await send("দুঃখিত, বার্তাটি প্রক্রিয়া করতে একটি সমস্যা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।");
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
