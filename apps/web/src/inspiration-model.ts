/**
 * [INPUT]: 灵感记录与两层标签体系的共享数据结构。
 * [OUTPUT]: 对外提供前端与 Worker 共用的灵感记录、两层标签树及分页契约类型。
 * [POS]: 灵感领域类型边界；严格约束标签只有概念大类与具体分类两层。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export interface InspirationTagPair {
  group: string;
  name: string;
}

export interface InspirationTag {
  id: string;
  group_id: string;
  group: string;
  name: string;
}

export interface InspirationTagChild {
  id: string;
  parent_id: string;
  name: string;
  description: string | null;
  count: number;
}

export interface InspirationTagGroup {
  id: string;
  name: string;
  description: string | null;
  count: number;
  children: InspirationTagChild[];
}

export interface InspirationRow {
  id: string;
  raw_input_id: string | null;
  source: "wechat" | "web";
  title: string | null;
  summary: string | null;
  content: string;
  pinned: boolean;
  captured_at: string;
  date_shanghai?: string;
  revision: number;
  created_at: string;
  updated_at: string;
  raw_text: string | null;
  tags: InspirationTag[];
}

export interface InspirationsPageData {
  rows: InspirationRow[];
  total: number;
  page: number;
  pageSize: number;
  tagTree: InspirationTagGroup[];
  availableDates?: string[];
  publicMode?: boolean;
}

export interface PublicInspirationItem {
  id: string;
  title: string | null;
  summary: string | null;
  content: string;
  pinned: boolean;
  captured_at: string;
  date_shanghai: string;
  tags: InspirationTag[];
}

export interface PublicInspirationsFeed {
  items: PublicInspirationItem[];
  total: number;
  limit: number;
  offset: number;
  timezone: "Asia/Shanghai";
  date: string | null;
  from: string | null;
  to: string | null;
  tags_tree: InspirationTagGroup[];
  available_dates: string[];
}

const SHANGHAI_DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function shanghaiDayFromIso(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return SHANGHAI_DAY_FMT.format(new Date(ms));
}

