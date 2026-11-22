import { extractWithGemini } from "./gemini";
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("S.A.R.A. Bot is running.", { status: 200 });
    }

    const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (env.WEBHOOK_SECRET && secretHeader !== env.WEBHOOK_SECRET) {
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

    try {
      if (text === "/start") {
        await sendTelegramMessage(
          env.TELEGRAM_BOT_TOKEN,
          chatId,
          [
            "<b>স্বাগতম! আমি S.A.R.A.</b>",
            "<i>Smart Assistant for Reminders &amp; Actions</i>",
            "",
            "যেকোনো আলোচনা বা নোট পাঠালে আমি তা থেকে <b>সিদ্ধান্ত</b> ও <b>করণীয়</b> বের করে মনে রাখব এবং সময়মতো রিমাইন্ডার দেব।",
            "",
            "<b>কমান্ডসমূহ:</b>",
            "/tasks — খোলা করণীয় দেখুন",
            "/done &lt;id&gt; — করণীয় সম্পন্ন করুন",
            "/decisions — সাম্প্রতিক সিদ্ধান্ত দেখুন",
            "/report — সকাল ও রাতের রিপোর্ট এখনই দেখুন",
          ].join("\n")
        );
        return new Response("OK", { status: 200 });
      }

      if (text === "/tasks") {
        const { results } = await env.DB.prepare(
          "SELECT id, title, due_date, status, created_at FROM tasks WHERE status = 'open' ORDER BY id DESC LIMIT 20"
        ).all<TaskRow>();

        if (!results.length) {
          await sendTelegramMessage(
            env.TELEGRAM_BOT_TOKEN,
            chatId,
            "কোনো খোলা করণীয় নেই।"
          );
        } else {
          const lines = results.map((t) => {
            const due = t.due_date ? ` (সময়: ${escapeHtml(t.due_date)})` : "";
            return `• <b>#${t.id}</b> ${escapeHtml(t.title)}${due}`;
          });
          await sendTelegramMessage(
            env.TELEGRAM_BOT_TOKEN,
            chatId,
            `<b>খোলা করণীয়:</b>\n${lines.join("\n")}`
          );
        }
        return new Response("OK", { status: 200 });
      }

      if (text.startsWith("/done")) {
        const parts = text.split(/\s+/);
        const taskId = Number(parts[1]);
        if (!Number.isInteger(taskId) || taskId <= 0) {
          await sendTelegramMessage(
            env.TELEGRAM_BOT_TOKEN,
            chatId,
            "সঠিক নিয়ম: <code>/done 1</code>"
          );
          return new Response("OK", { status: 200 });
        }

        const res = await env.DB.prepare(
          "UPDATE tasks SET status = 'done', completed_at = datetime('now') WHERE id = ? AND status = 'open'"
        )
          .bind(taskId)
          .run();

        const reply =
          res.meta.changes > 0
            ? `করণীয় #${taskId} সম্পন্ন হিসেবে চিহ্নিত হয়েছে।`
            : `খোলা করণীয় #${taskId} পাওয়া যায়নি।`;

        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, reply);
        return new Response("OK", { status: 200 });
      }

      if (text === "/decisions") {
        const { results } = await env.DB.prepare(
          "SELECT id, summary, context, created_at FROM decisions ORDER BY id DESC LIMIT 15"
        ).all<DecisionRow>();

        if (!results.length) {
          await sendTelegramMessage(
            env.TELEGRAM_BOT_TOKEN,
            chatId,
            "এখনো কোনো সিদ্ধান্ত সংরক্ষিত নেই।"
          );
        } else {
          const lines = results.map(
            (d) => `• <b>#${d.id}</b> ${escapeHtml(d.summary)}`
          );
          await sendTelegramMessage(
            env.TELEGRAM_BOT_TOKEN,
            chatId,
            `<b>সাম্প্রতিক সিদ্ধান্তসমূহ:</b>\n${lines.join("\n")}`
          );
        }
        return new Response("OK", { status: 200 });
      }

      if (text === "/report") {
        const morning = await buildMorningReport(env);
        const night = await buildNightReport(env);
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `${morning}\n\n${night}`);
        return new Response("OK", { status: 200 });
      }

      const extracted = await extractWithGemini(
        env.GEMINI_API_KEY,
        env.GEMINI_MODEL || "gemini-2.5-pro",
        env.TIMEZONE || "Asia/Dhaka",
        text
      );

      for (const task of extracted.tasks) {
        await env.DB.prepare(
          "INSERT INTO tasks (title, due_date) VALUES (?, ?)"
        )
          .bind(task.title, task.due_date ?? null)
          .run();
      }

      for (const decision of extracted.decisions) {
        await env.DB.prepare(
          "INSERT INTO decisions (summary, context) VALUES (?, ?)"
        )
          .bind(decision.summary, decision.context || null)
          .run();
      }

      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        escapeHtml(extracted.reply_bn)
      );
    } catch (err) {
      console.error("Handler error:", err);
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        "দুঃখিত, বার্তাটি প্রক্রিয়া করতে একটি সমস্যা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।"
      );
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
