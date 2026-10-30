/**
 * [INPUT]: Supabase 接口返回的分类、历史日聚合与账目。
 * [OUTPUT]: 页面契约、上海日期、整数金额和跨日扣减统计。
 * [POS]: 前后端共享纯函数；金额保留整数分，覆盖率合并重叠区间。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export type Stage = "anonymous" | "password" | "enroll" | "verify" | "ready";
export interface SessionState {
  stage: Stage;
  factorId?: string;
}
export interface Category {
  id: number;
  name: string;
  code: string;
  kind: "time" | "money";
  nature: "core" | "support" | "recovery" | "leisure" | null;
  direction: string | null;
  is_active?: boolean;
}
export interface TimeEntry {
  id: string;
  start_at: string;
  end_at: string | null;
  category_id: number;
  activity: string;
  note: string | null;
  deduction_minutes?: number;
  deduction_note?: string | null;
  project?: string | null;
  tags?: string[];
  revision?: number;
  updated_at?: string;
}
export interface Transaction {
  id: string;
  occurred_at: string;
  direction: "expense" | "income" | "transfer";
  amount_cents: number;
  currency: string;
  category_id: number;
  account: string | null;
  merchant: string | null;
  note: string | null;
  title?: string | null;
  from_account?: string | null;
  to_account?: string | null;
  project?: string | null;
  tags?: string[];
  details?: Record<string, unknown>;
  revision?: number;
  updated_at?: string;
}
export interface RawInput {
  id: string;
  text: string;
  received_at: string;
  input_kind: string;
  status: string;
  clarification_prompt: string | null;
  error_code: string | null;
  revoked_at: string | null;
}
export interface DailyTime {
  day: string;
  category_id: number;
  minutes: number;
}
export interface DailyMoney {
  day: string;
  category_id: number;
  direction: "expense" | "income";
  currency: string;
  cents: number;
}
export interface DashboardData {
  categories: Category[];
  time: DailyTime[];
  money: DailyMoney[];
  entries: TimeEntry[];
  transactions: Transaction[];
  inbox: RawInput[];
  transactionsMore: boolean;
  inboxMore: boolean;
  fetchedAt: string;
}
export const SHANGHAI = "Asia/Shanghai";
export function today(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: SHANGHAI }).format(now);
}
export function validDay(day: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    !Number.isNaN(Date.parse(day)) &&
    new Date(day).toISOString().slice(0, 10) === day
  );
}
export function moveDay(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function bounds(day: string): [number, number] {
  const start = Date.parse(`${day}T00:00:00+08:00`);
  return [start, start + 86400000];
}
export function periodRange(
  day: string,
  period: "day" | "week" | "month" | "year",
): [string, string] {
  if (period === "day") return [day, day];
  if (period === "week") {
    const weekday = new Date(day + "T12:00:00Z").getUTCDay();
    const start = moveDay(day, -((weekday + 6) % 7));
    return [start, moveDay(start, 6)];
  }
  const year = Number(day.slice(0, 4)),
    month = Number(day.slice(5, 7));
  if (period === "year") return [`${year}-01-01`, `${year}-12-31`];
  return [
    `${day.slice(0, 7)}-01`,
    new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  ];
}
export function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
}
export function money(cents: number, currency = "CNY"): string {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency }).format(
    cents / 100,
  );
}
export function duration(minutes: number): string {
  const n = Math.round(minutes);
  return n < 60
    ? `${n} 分钟`
    : `${Math.floor(n / 60)} 小时${n % 60 ? " " + (n % 60) + " 分钟" : ""}`;
}
export function clock(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: SHANGHAI,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}
export function datetime(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: SHANGHAI,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}
export function clipped(
  entry: TimeEntry,
  day: string,
  ceiling?: number,
): [number, number] {
  const [start, end] = bounds(day);
  return [
    Math.max(Date.parse(entry.start_at), start),
    Math.min(
      entry.end_at ? Date.parse(entry.end_at) : (ceiling ?? Date.now()),
      end,
      ceiling ?? end,
    ),
  ];
}
export function netMinutes(
  entry: TimeEntry,
  day: string,
  ceiling?: number,
): number {
  const [s, e] = clipped(entry, day, ceiling);
  if (e <= s) return 0;
  const start = Date.parse(entry.start_at),
    finish = entry.end_at ? Date.parse(entry.end_at) : e;
  const deduction = entry.deduction_minutes ?? 0;
  const roundEven = (elapsed: number) => {
    if (!deduction || finish <= start) return 0;
    const numerator = BigInt(Math.round(elapsed)) * BigInt(deduction),
      denominator = BigInt(finish - start);
    const q = numerator / denominator,
      r = numerator % denominator;
    return Number(
      q +
        (r * 2n > denominator || (r * 2n === denominator && q % 2n !== 0n)
          ? 1n
          : 0n),
    );
  };
  return (
    Math.floor((e - s) / 60000) - (roundEven(e - start) - roundEven(s - start))
  );
}
export function coverage(
  entries: TimeEntry[],
  day: string,
  now = Date.now(),
): { recorded: number; elapsed: number; gaps: number; percent: number } {
  const [start, end] = bounds(day),
    ceiling = Math.max(start, Math.min(now, end));
  const intervals = entries
    .map((e) => clipped(e, day, ceiling))
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let union = 0,
    last = start;
  for (const [s, e] of intervals) {
    union += Math.max(0, e - Math.max(s, last));
    last = Math.max(last, e);
  }
  const elapsed = (ceiling - start) / 60000,
    recorded = union / 60000;
  return {
    recorded,
    elapsed,
    gaps: Math.max(0, elapsed - recorded),
    percent: elapsed ? Math.round((recorded / elapsed) * 100) : 0,
  };
}
export function sumsByCurrency(
  rows: DailyMoney[],
): Record<string, { expense: number; income: number }> {
  const result: Record<string, { expense: number; income: number }> = {};
  for (const row of rows) {
    const cents = Number(row.cents);
    if (!Number.isSafeInteger(cents)) throw new Error("金额超出精确范围");
    const group = (result[row.currency] ??= { expense: 0, income: 0 });
    group[row.direction] += cents;
    if (!Number.isSafeInteger(group[row.direction]))
      throw new Error("金额超出精确范围");
  }
  return result;
}
