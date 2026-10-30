/**
 * [INPUT]: 历史记录视图、字段补丁与上海时间。
 * [OUTPUT]: 编辑契约、精确金额输入及本地墙钟转换。
 * [POS]: 历史页面与 Worker 共用的纯数据边界。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { Category, TimeEntry, Transaction } from "./model";
export const RECORD_KINDS = {
  time: "时间记录",
  money: "收支流水",
  task: "任务计划",
  task_group: "任务分组",
  account: "账户",
  project: "项目",
} as const;
export type RecordKind = keyof typeof RECORD_KINDS;
export interface LocalRecord {
  id: string;
  kind: RecordKind;
  source_id: string;
  data: Record<string, unknown>;
  revision: number;
  updated_at: string;
}
export interface RecordRow {
  id: string;
  kind: RecordKind;
  event_at: string;
  title: string;
  source: string;
  data: TimeEntry | Transaction | LocalRecord;
}
export interface RecordPage {
  rows: RecordRow[];
  total: number;
  page: number;
  pageSize: number;
}
export interface RecordChange {
  revision: number;
  before_data: Record<string, unknown>;
  after_data: Record<string, unknown>;
  changed_at: string;
  actor: string;
}
export interface RecordDetail {
  record: RecordRow;
  changes: RecordChange[];
  changesMore: boolean;
  categories: Category[];
  choices: LocalRecord[];
  source: { source: string; text: string; received_at: string } | null;
  attachments: Array<{
    id: string;
    filename: string;
    mime: string;
    size_bytes: number;
  }>;
}
export type EditTarget = { kind: RecordKind; id: string };
export type OnEdit = (kind: RecordKind, id: string) => void;
export function decimalCents(value: string): number {
  const text = value.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(text))
    throw new Error("金额请填写数字，最多两位小数");
  const [whole, frac = ""] = text.replace(/^-/, "").split(".");
  const amount =
    (BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"))) *
    (text.startsWith("-") ? -1n : 1n);
  const result = Number(amount);
  if (!Number.isSafeInteger(result)) throw new Error("金额超出精确范围");
  return result;
}
export function amountInput(value: number | string): string {
  const amount = BigInt(value);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}
export function shanghaiInput(value: string | null | undefined): string {
  if (!value) return "";
  const p = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
  return p.replace(" ", "T");
}
export function shanghaiInstant(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value))
    throw new Error("请填写完整日期和时间");
  const iso = new Date(value + "+08:00").toISOString();
  if (shanghaiInput(iso).slice(0, value.length) !== value)
    throw new Error("日期或时间无效");
  return iso;
}
