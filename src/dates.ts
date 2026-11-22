import { Recurrence } from "./types";

export function getLocalDateTimeParts(
  timezone: string,
  offsetDays = 0
): { dateStr: string; dateTimeStr: string; hour: number } {
  const target = new Date(Date.now() + offsetDays * 86400000);
  const formatted = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone || "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(target)
    .replace(/[\u202f\u00a0]/g, " ");

  // ফরম্যাট: "YYYY-MM-DD HH:MM"
  const dateStr = formatted.slice(0, 10);
  const hour = Number(formatted.slice(11, 13)) % 24;
  return { dateStr, dateTimeStr: formatted, hour };
}

/** D1-এর UTC datetime ("YYYY-MM-DD HH:MM:SS") থেকে নির্ধারিত টাইমজোনের তারিখ বের করে। */
export function utcSqlToLocalDate(
  utcSql: string | null | undefined,
  timezone: string
): string | null {
  if (!utcSql) return null;
  const d = new Date(utcSql.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone || "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * যেকোনো তারিখ-স্ট্রিংকে "YYYY-MM-DD" বা "YYYY-MM-DD HH:MM"-এ আনে।
 * "2026-11-22T14:30:00", "2026-11-22 9:05" ইত্যাদি সবই সামলায়। অবৈধ হলে null।
 */
export function normalizeDueDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = `${y}-${mo}-${d}`;
  if (h === undefined) return date;
  const hour = Number(h);
  const min = Number(mi);
  if (hour > 23 || min > 59) return date;
  return `${date} ${String(hour).padStart(2, "0")}:${mi}`;
}

function shift(y: number, m: number, d: number, rec: Recurrence, n: number): string {
  let date: Date;
  if (rec === "monthly") {
    const total = m - 1 + n;
    const ty = y + Math.floor(total / 12);
    const tm = total % 12;
    const daysInMonth = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    date = new Date(Date.UTC(ty, tm, Math.min(d, daysInMonth)));
  } else {
    const step = rec === "daily" ? 1 : 7;
    date = new Date(Date.UTC(y, m - 1, d + step * n));
  }
  return date.toISOString().slice(0, 10);
}

/** পুনরাবৃত্ত কাজের পরবর্তী ডেডলাইন (সবসময় আজকের পরের তারিখে)। */
export function nextOccurrence(
  due: string | null,
  rec: Recurrence,
  timezone: string
): string {
  const { dateStr: today } = getLocalDateTimeParts(timezone);
  const base = normalizeDueDate(due) ?? today;
  const [y, m, d] = base.slice(0, 10).split("-").map(Number);
  const timePart = base.length > 10 ? base.slice(10) : "";
  for (let n = 1; n <= 400; n++) {
    const next = shift(y, m, d, rec, n);
    if (next > today) return next + timePart;
  }
  return base;
}
