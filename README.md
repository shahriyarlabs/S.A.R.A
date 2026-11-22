# S.A.R.A. বট (Smart Assistant for Reminders & Actions)

Cloudflare Workers + `sara-db` (D1) + Gemini Pro দিয়ে তৈরি ব্যক্তিগত AI সহকারী।

## যা যা থাকছে
- সাধারণ বাংলা/ইংরেজি/বাংলিশ মেসেজ থেকে **সিদ্ধান্ত** ও **করণীয়** বের করে `sara-db`-তে সংরক্ষণ
- `/tasks`, `/done <id>`, `/decisions`, `/report` কমান্ড
- প্রতিদিন সকাল ৮:০০টায় ও রাত ৯:০০টায় অটোমেটিক রিপোর্ট (ঢাকা সময়)
- প্রতি ১৫ মিনিটে ডেডলাইন রিমাইন্ডার চেক (রাত ১১টা–সকাল ৭টা নীরব সময়)

## সেটআপ ধাপ
1. Cloudflare Dashboard-এ **`sara-db`**-এর `Console` ট্যাবে গিয়ে `schema.sql` রান করুন।
2. `wrangler.toml`-এ `sara-db`-র `database_id` বসান।
3. ফাইলগুলো GitHub রিপোজিটরিতে তুলে Cloudflare Workers থেকে Deploy করুন।
4. Worker-এর **Settings → Bindings**-এ `DB` নামে `sara-db` যুক্ত করুন এবং **Variables and Secrets**-এ `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `ALLOWED_TELEGRAM_USER_ID`, ও `WEBHOOK_SECRET` সেট করুন।
5. ব্রাউজার দিয়ে Telegram-এর `setWebhook` লিংকটি একবার কল করে বট চালু করুন।
"# S.A.R.A" 
