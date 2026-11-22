# S.A.R.A. বট (Smart Assistant for Reminders & Actions)

Cloudflare Workers + `sara-db` (D1) + Claude (Anthropic API) দিয়ে তৈরি ব্যক্তিগত AI সহকারী।

## যা যা আছে
- বাংলা/ইংরেজি/বাংলিশ মেসেজ থেকে **সিদ্ধান্ত** ও **করণীয়** বের করে `sara-db`-তে সংরক্ষণ (একই জিনিস দুবার যোগ হয় না)
- **পুনরাবৃত্ত কাজ**: "প্রতিদিন / প্রতি সপ্তাহে / প্রতি মাসে" — `/done` দিলে পরের কাজ নিজে তৈরি হয়
- কমান্ড: `/tasks`, `/done <id>`, `/edit <id> <শিরোনাম>`, `/due <id> <তারিখ>`, `/delete <id>`, `/decisions`, `/report`, `/help`
- সকাল ৮:০০ ও রাত ৯:০০টায় অটোমেটিক রিপোর্ট (ঢাকা সময়)
- প্রতি ১৫ মিনিটে ডেডলাইন রিমাইন্ডার (রাত ১১টা–সকাল ৭টা নীরব সময়)

## ফাইল কাঠামো
```
sara-bot/
├── wrangler.toml
├── package.json
├── tsconfig.json
├── schema.sql
├── migration-step3.sql
└── src/
    ├── index.ts
    ├── claude.ts
    ├── scheduler.ts
    ├── telegram.ts
    ├── dates.ts
    └── types.ts
```
> সব `.ts` ফাইল অবশ্যই `src/` ফোল্ডারের ভেতরে রাখতে হবে।

## সেটআপ
1. **নতুন ডেটাবেস:** `sara-db`-এর Console-এ `schema.sql` রান করুন।
   **আগের ডেটাবেস থাকলে:** শুধু `migration-step3.sql` রান করুন (`recurrence` কলাম যোগ হবে)।
2. `wrangler.toml`-এ `database_id` বসান।
3. ডিপেন্ডেন্সি ইনস্টল ও ডিপ্লয়:
   ```
   npm install
   npm run typecheck
   npx wrangler deploy
   ```
   (GitHub থেকে Cloudflare-এ ডিপ্লয় করলে Build command-এ `npm install` যথেষ্ট।)
4. সিক্রেট সেট করুন (Dashboard → Variables and Secrets, অথবা `npx wrangler secret put <নাম>`):
   `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY`, `ALLOWED_TELEGRAM_USER_ID`, `WEBHOOK_SECRET`
   > `WEBHOOK_SECRET` এখন **বাধ্যতামূলক**। সেট না থাকলে বট সব রিকোয়েস্ট বাতিল করবে।
   > এটি ১–২৫৬ অক্ষরের হতে হবে; শুধু A-Z, a-z, 0-9, `_`, `-` ব্যবহার করুন।
5. ব্রাউজারে একবার এই লিংক খুলে ওয়েবহুক চালু করুন:
   ```
   https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=<WORKER_URL>&secret_token=<WEBHOOK_SECRET>
   ```

## নিরাপত্তা নোট
- `database_id` গোপন তথ্য নয়, তবে রিপো পাবলিক করলে জেনে রাখুন।
- টোকেন/API কী কখনো রিপোতে কমিট করবেন না।

## Claude মডেল বদলানো
`wrangler.toml`-এর `CLAUDE_MODEL` বদলান। ডিফল্ট `claude-haiku-5-5` (দ্রুত ও সস্তা)। আরও নিখুঁত বিশ্লেষণ চাইলে `claude-sonnet-5-5` দিন।
API কী নিন: https://console.anthropic.com
