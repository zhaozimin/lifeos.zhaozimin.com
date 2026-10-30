/**
 * [INPUT]: 本人 AAL2 客户端、云端账目与本机原版契约。
 * [OUTPUT]: 大类日周时间账、WHOOP来源、财务配置及修改痕迹。
 * [POS]: 只读契约适配；账本仍以 Supabase 原表为真源。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Segment, RangeSummary, Nature } from "../src/dashboard/types";
import type {
  Configuration as FinConfig,
  Transaction as FinTransaction,
} from "../src/dashboard/fin/types";
import {
  sliceSegmentForDay,
  daysInRange,
  deriveDayGaps,
} from "../src/dashboard/lib/timeline";
import { recordNow, isoMinute } from "../src/dashboard/lib/dates";
import { HttpError } from "./auth";
export type Row = Record<string, any>;
export async function rows(
  client: SupabaseClient,
  table: string,
  select = "*",
  apply: (q: any) => any = (q) => q,
): Promise<Row[]> {
  const result: Row[] = [];
  for (let offset = 0; offset < 100000; offset += 1000) {
    const { data, error } = await apply(client.from(table).select(select))
      .order("id")
      .range(offset, offset + 999);
    if (error) throw new HttpError(503, "账本暂时无法读取，请稍后重试");
    result.push(...data);
    if (data.length < 1000) return result;
  }
  throw new HttpError(422, "记录过多，请缩小范围");
}
const wallFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export function wall(value: string | null): string | null {
  return value ? wallFormatter.format(new Date(value)).replace(" ", "T") : null;
}
export function toSegment(record: Row, categories: Row[]): Segment {
  const t = record.data || record,
    c = categories.find((c) => c.id === t.category_id);
  const gross = t.end_at
    ? Math.floor((Date.parse(t.end_at) - Date.parse(t.start_at)) / 60000)
    : null;
  return {
    id: t.id,
    revision: t.revision,
    title: t.activity,
    category: { name: c?.name || "未归类", nature: c?.nature || "support" },
    projectName: t.project,
    startedAt: wall(t.start_at)!,
    endedAt: wall(t.end_at),
    startedUtc: t.start_at,
    endedUtc: t.end_at,
    deductionMinutes: t.deduction_minutes || 0,
    deductionNote: t.deduction_note,
    tags: t.tags || [],
    note: t.note,
    source:
      record.source === "whoop"
        ? "device"
        : record.source === "local-lifeos"
        ? "import"
        : record.source === "web"
          ? "manual"
          : "agent",
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    deletedAt: t.deleted_at,
    deletionReason: t.deletion_reason || null,
    deletedBy: t.deleted_at ? "dashboard" : null,
    grossMinutes: gross,
    pureMinutes: gross === null ? null : gross - (t.deduction_minutes || 0),
    overlong: gross !== null && gross > 480,
  };
}
export async function nativeTime(
  client: SupabaseClient,
  includeDeleted = false,
  range?: { from: string; to: string },
): Promise<{ segments: Segment[]; categories: Row[] }> {
  const [entries, categories] = await Promise.all([
    rows(client, "time_entries", "*,raw_inputs(source)", (q) => {
      if (!includeDeleted) q = q.is("deleted_at", null);
      if (range)
        q = q
          .lt("start_at", range.to)
          .or(`end_at.gt.${range.from},end_at.is.null`);
      return q;
    }),
    rows(client, "categories", "*", (q) => q.eq("kind", "time")),
  ]);
  return {
    segments: entries.map((t) =>
      toSegment({ data: t, source: t.raw_inputs?.source }, categories),
    ),
    categories,
  };
}
export function timeSummary(
  segments: Segment[],
  from: string,
  to: string,
  now = new Date(),
  groupOnly = false,
): RangeSummary {
  const minute = isoMinute(recordNow("Asia/Shanghai", now)),
    clock = { timeZone: "Asia/Shanghai", nowUtc: now.toISOString() };
  const natures: Nature[] = ["core", "support", "recovery", "leisure"];
  const byNature = natures.map((nature) => ({
    nature,
    grossMinutes: 0,
    pureMinutes: 0,
  }));
  const cats = new Map<string, RangeSummary["byCategory"][number]>(),
    projects = new Map<string, RangeSummary["byProject"][number]>();
  let effectiveWorkMinutes = 0,
    grossWorkMinutes = 0,
    recordedMinutes = 0,
    gapMinutes = 0,
    deductionMinutes = 0;
  const days = daysInRange(from, to).map((date) => {
    let work = 0,
      gross = 0;
    for (const s of segments) {
      const cut = sliceSegmentForDay(s, date, minute, clock);
      if (!cut) continue;
      const n = byNature.find((n) => n.nature === s.category.nature)!;
      n.grossMinutes += cut.gross;
      n.pureMinutes += cut.pure;
      const key = s.category.name + "\0" + s.category.nature;
      const c = cats.get(key) || {
        name: s.category.name,
        nature: s.category.nature,
        grossMinutes: 0,
        pureMinutes: 0,
        segmentCount: 0,
      };
      c.grossMinutes += cut.gross;
      c.pureMinutes += cut.pure;
      c.segmentCount++;
      cats.set(key, c);
      if (s.projectName) {
        const p = projects.get(s.projectName) || {
          projectName: s.projectName,
          grossMinutes: 0,
          pureMinutes: 0,
          segmentCount: 0,
        };
        p.grossMinutes += cut.gross;
        p.pureMinutes += cut.pure;
        p.segmentCount++;
        projects.set(s.projectName, p);
      }
      if (groupOnly ? s.category.name === "工作" : s.category.nature === "core") work += cut.pure;
      if (groupOnly ? s.category.name === "工作" : s.category.nature === "core" || s.category.nature === "support")
        grossWorkMinutes += cut.gross;
      deductionMinutes += cut.gross - cut.pure;
      gross += cut.gross;
    }
    const elapsed =
      date < minute.slice(0, 10)
        ? 1440
        : date === minute.slice(0, 10)
          ? Number(minute.slice(11, 13)) * 60 + Number(minute.slice(14, 16))
          : 0;
    const gaps = deriveDayGaps(segments, date, minute, clock).reduce(
        (n, g) => n + g.minutes,
        0,
      ),
      recorded = Math.max(0, elapsed - gaps);
    effectiveWorkMinutes += work;
    recordedMinutes += recorded;
    gapMinutes += gaps;
    return {
      date,
      effectiveWorkMinutes: work,
      grossMinutes: gross,
      recordedMinutes: recorded,
      gapMinutes: gaps,
      coverage: elapsed ? recorded / elapsed : 0,
      partial: date >= minute.slice(0, 10),
    };
  });
  return {
    groupOnly,
    from,
    to,
    byNature,
    byCategory: [...cats.values()].sort(
      (a, b) => b.pureMinutes - a.pureMinutes,
    ),
    byProject: [...projects.values()].sort(
      (a, b) => b.pureMinutes - a.pureMinutes,
    ),
    effectiveWorkMinutes,
    grossWorkMinutes,
    recordedMinutes,
    gapMinutes,
    deductionMinutes,
    coverage:
      recordedMinutes + gapMinutes
        ? recordedMinutes / (recordedMinutes + gapMinutes)
        : 0,
    days,
  };
}
export function decodeArchive(r: Row): Row {
  try {
    return JSON.parse(r.payload?.payload_json || "{}");
  } catch {
    return {};
  }
}
export async function preference(
  client: SupabaseClient,
  domain: string,
): Promise<Row> {
  const { data, error } = await client
    .from("dashboard_preferences")
    .select("data,revision")
    .eq("domain", domain)
    .maybeSingle();
  if (error) throw new HttpError(503, "设置暂时无法读取");
  return data || { data: {}, revision: 1 };
}
export async function timeConfiguration(client: SupabaseClient) {
  const [categories, projects, pref] = await Promise.all([
    rows(client, "categories", "*", (q) =>
      q.eq("kind", "time").eq("is_active", true),
    ),
    rows(client, "local_records", "*", (q) =>
      q.eq("kind", "project").is("deleted_at", null),
    ),
    preference(client, "time"),
  ]);
  return {
    natures: ["core", "support", "recovery", "leisure"],
    categories: categories.map((c) => ({
      id: String(c.id),
      name: c.name,
      nature: c.nature || "support",
      keywords: c.keywords || [],
      builtin: c.code === "uncategorized",
      protected: c.code === "uncategorized",
    })),
    projects: projects
      .filter((p) => p.source_id.startsWith("time:"))
      .map((p) => ({ ...p.data, id: p.id })),
    settings: { weekStart: pref.data.weekStart || "monday" },
    timezone: "Asia/Shanghai",
    timezoneSource: "config",
    resolvedTimezone: "Asia/Shanghai",
    currentSystemTimezone: null,
    overlongSegmentMinutes: 480,
    revision: pref.revision,
  };
}
export function toTransaction(
  record: Row,
  categories: Row[],
  files: Row[] = [],
): FinTransaction {
  const t = record.data || record,
    c = categories.find((c) => c.id === t.category_id),
    d = t.details || {};
  return {
    id: t.id,
    revision: t.revision,
    title: t.title || t.merchant || t.note || "未命名流水",
    amount: Number(t.amount_cents) / 100,
    kind: t.direction,
    occurredAt: wall(t.occurred_at)!,
    category: {
      ...(c?.metadata || {}),
      id: String(c?.id || ""),
      name: c?.name || "未分类",
    },
    tags: t.tags || [],
    accountName: t.account || "",
    fromAccountName: t.from_account,
    toAccountName: t.to_account,
    merchant: t.merchant || "",
    projectName: t.project,
    note: t.note || "",
    reimbursementStatus: d.reimbursement_status || "notApplicable",
    reimbursedBy: d.reimbursed_by,
    source:
      d.source ||
      (record.source === "web" ? "manual" : record.source || "import"),
    sourceName: d.source_name,
    counterpartyId: d.counterparty_id,
    invoiceIssued: !!d.invoice_issued,
    invoiceAttachmentId: d.invoice_attachment_id,
    taxCategory: d.tax_category || "personal",
    currency: t.currency,
    amountInBaseCurrency:
      t.currency === "CNY"
        ? Number(t.amount_cents) / 100
        : d.amount_in_base_currency,
    attachments: files
      .filter((f) => f.transaction_id === t.id && !f.deleted_at)
      .map((f) => ({
        id: f.id,
        mime: f.mime,
        sizeBytes: f.size_bytes,
        originalName: f.filename,
        createdAt: t.created_at,
      })),
    deletedAt: t.deleted_at,
  };
}
export async function nativeFinance(
  client: SupabaseClient,
  includeDeleted = false,
) {
  const [entries, categories, aux, pref, files] = await Promise.all([
    rows(client, "v_records", "*", (q) =>
      includeDeleted
        ? q.eq("kind", "money")
        : q.eq("kind", "money").is("deleted_at", null),
    ),
    rows(client, "categories", "*", (q) => q.eq("kind", "money")),
    rows(client, "local_records", "*", (q) =>
      q.in("kind", ["account", "project"]),
    ),
    preference(client, "finance"),
    rows(
      client,
      "record_attachments",
      "id,transaction_id,filename,mime,size_bytes,deleted_at",
    ),
  ]);
  const transactions = entries.map((t) => toTransaction(t, categories, files));
  const accounts = aux
    .filter((a) => a.kind === "account")
    .map((a) => {
      const account = {
        ...a.data,
        id: a.source_id,
        revision: a.revision,
        cloudId: a.id,
        deletedAt: a.deleted_at,
      };
      let cents = Math.round(Number(account.openingBalance || 0) * 100);
      for (const t of transactions) {
        if (t.deletedAt || t.currency !== (account.currency || "CNY")) continue;
        const value = Math.round(t.amount * 100);
        if (t.kind === "income" && t.accountName === account.name)
          cents += value;
        if (t.kind === "expense" && t.accountName === account.name)
          cents -= value;
        if (t.kind === "transfer") {
          if (t.fromAccountName === account.name) cents -= value;
          if (t.toAccountName === account.name) cents += value;
        }
      }
      return {
        ...account,
        currentBalance:
          (account.classification === "liability"
            ? 2 * Math.round(Number(account.openingBalance || 0) * 100) - cents
            : cents) / 100,
      };
    });
  const configuration = {
    revision: pref.revision,
    categories: categories.map((c) => ({
      ...c.metadata,
      id: String(c.id),
      name: c.name,
      direction:
        c.direction === "income"
          ? "收入"
          : c.direction === "expense"
            ? "支出"
            : undefined,
      keywords: c.keywords || [],
      deletedAt: c.is_active ? null : c.created_at,
    })),
    accounts,
    settings: {
      bookMode: "personal",
      ledgerMode: "personal",
      defaultCurrency: "CNY",
      baseUnit: "元",
      timezone: "Asia/Shanghai",
      allowManualEntry: true,
      ...pref.data,
      projects: aux
        .filter(
          (a) =>
            a.kind === "project" &&
            a.source_id.startsWith("finance:") &&
            !a.deleted_at,
        )
        .map((a) => ({
          ...a.data,
          id: a.source_id.slice(8),
          cloudId: a.id,
          revision: a.revision,
        })),
    },
  } as FinConfig;
  return { configuration, transactions, categories, files };
}
export async function nativeAudits(
  client: SupabaseClient,
  kind: "time" | "money",
) {
  const [changes, categories, archive] = await Promise.all([
    rows(client, "record_changes", "*", (q) => q.eq("kind", kind)),
    rows(client, "categories"),
    rows(client, "local_archive", "id,payload,domain,table_name", (q) =>
      q
        .eq("domain", kind === "time" ? "time" : "finance")
        .eq("table_name", "audit_events"),
    ),
  ]);
  const convert = (data: Row) =>
    kind === "time"
      ? toSegment(data, categories)
      : toTransaction(data, categories);
  const live = changes.map((c) => ({
    id: c.id,
    occurredAt: c.changed_at,
    actor: c.actor === "web" ? "dashboard" : c.actor,
    action:
      !c.before_data || !Object.keys(c.before_data).length
        ? "create"
        : c.after_data.deleted_at
          ? "delete"
          : "update",
    entityType: kind === "time" ? "segment" : "transaction",
    entityId: c.record_id,
    entityName: kind === "time" ? c.after_data.activity : c.after_data.title,
    impact: {},
    payload: {
      before: Object.keys(c.before_data).length ? convert(c.before_data) : null,
      after: convert(c.after_data),
      reason: c.after_data.details?.deletion_reason,
    },
  }));
  const historical = archive.map((a) => {
    const p = a.payload;
    let payload = {};
    try {
      payload = JSON.parse(p.payload_json || "{}");
    } catch {}
    let impact = {};
    try {
      impact = JSON.parse(p.impact_json || "{}");
    } catch {}
    return {
      id: "import:" + p.id,
      occurredAt: p.occurred_at,
      actor: p.actor,
      action: p.action,
      entityType: p.entity_type,
      entityId: p.entity_id,
      entityName: p.entity_name,
      impact,
      payload,
    };
  });
  return [...live, ...historical].sort((a, b) =>
    String(b.occurredAt).localeCompare(String(a.occurredAt)),
  );
}
