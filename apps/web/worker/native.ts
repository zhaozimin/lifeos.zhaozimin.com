/**
 * [INPUT]: 本人 AAL2 请求、原版 API 契约与云端读写适配器。
 * [OUTPUT]: 大类时间与WHOOP实睡统计、财务配置和修改痕迹响应。
 * [POS]: /api/native 路由；所有写入经过同源门禁和数据库事务。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./auth";
import { databaseError } from "./records";
import {
  rows,
  wall,
  nativeTime,
  nativeFinance,
  nativeAudits,
  timeConfiguration,
  timeSummary,
  toSegment,
  toTransaction,
  type Row,
} from "./native-data";
import { nativeFiles } from "./native-files";
import { validDay, daysBetween, bounds } from "../src/model";
import { decimalCents } from "../src/record-model";
const inputSchema = z
  .object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: z.string().max(250),
    params: z.record(z.string(), z.unknown()).default({}),
    body: z.unknown().optional(),
  })
  .strict();
export async function rpc(client: SupabaseClient, name: string, args: Row) {
  const { data, error } = await client.rpc(name, args);
  if (error) databaseError(error);
  return data;
}
function date(value: unknown) {
  const s = String(value || "");
  if (!validDay(s)) throw new HttpError(400, "日期范围无效");
  return s;
}
function timestamp(value: unknown) {
  const s = z.string().max(60).parse(value);
  const v = /([zZ]|[+-]\d\d:\d\d)$/.test(s) ? s : s + "+08:00";
  if (!Number.isFinite(Date.parse(v))) throw new HttpError(400, "时间无效");
  return new Date(v).toISOString();
}
function changed(patch: Row, key: string, value: unknown, previous: unknown) {
  if (JSON.stringify(value ?? null) !== JSON.stringify(previous ?? null))
    patch[key] = value;
}
export async function saveTime(
  client: SupabaseClient,
  method: string,
  id: string | undefined,
  body: Row,
) {
  const { segments, categories } = await nativeTime(client, true);
  const current = id ? segments.find((s) => s.id === id) : undefined;
  if (id && !current) throw new HttpError(404, "时段不存在");
  if (method === "DELETE")
    return {
      segment: toSegment(
        await rpc(client, "dashboard_record", {
          p_kind: "time",
          p_action: "delete",
          p_id: id,
          p_revision: z.number().int().positive().parse(body.revision),
          p_data: { reason: body.reason || "网页确认删除" },
        }),
        categories,
      ),
    };
  const patch: Row = {};
  for (const [source, target] of Object.entries({
    title: "activity",
    projectName: "project",
    note: "note",
    deductionMinutes: "deduction_minutes",
    deductionNote: "deduction_note",
    tags: "tags",
  })) {
    if (source in body)
      changed(
        patch,
        target,
        body[source],
        current?.[source as keyof typeof current],
      );
  }
  if ("startedAt" in body && body.startedAt !== current?.startedAt)
    patch.start_at = timestamp(body.startedAt);
  if ("endedAt" in body && body.endedAt !== current?.endedAt)
    patch.end_at = body.endedAt ? timestamp(body.endedAt) : null;
  if ("categoryName" in body) {
    const c = categories.find(
      (c) => c.kind === "time" && c.name === body.categoryName,
    );
    if (!c) throw new HttpError(400, "请选择有效时间分类");
    if (!current || current.category.name !== c.name) patch.category_id = c.id;
  }
  if (!id) {
    patch.start_at ??= new Date().toISOString();
    patch.end_at ??= null;
    patch.deduction_minutes ??= 0;
  }
  if (id && !Object.keys(patch).length) return { segment: current };
  const saved = await rpc(client, "dashboard_record", {
    p_kind: "time",
    p_action: id ? "update" : "create",
    p_id: id || z.uuid().parse(body.requestId),
    p_revision: id ? z.number().int().positive().parse(body.revision) : null,
    p_data: patch,
  });
  return {
    segment: toSegment(
      {
        data: saved,
        source: current
          ? current.source === "import"
            ? "local-lifeos"
            : current.source === "manual"
              ? "web"
              : "wechat"
          : "web",
      },
      categories,
    ),
    closedPrevious: null,
  };
}
export async function saveMoney(
  client: SupabaseClient,
  method: string,
  id: string | undefined,
  body: Row,
) {
  const { categories, transactions } = await nativeFinance(client, true);
  const current = id ? transactions.find((t) => t.id === id) : undefined;
  if (id && !current) throw new HttpError(404, "流水不存在");
  if (method === "DELETE") {
    await rpc(client, "dashboard_record", {
      p_kind: "money",
      p_action: "delete",
      p_id: id,
      p_revision: z.number().int().positive().parse(body.revision),
      p_data: { reason: "在原版流水页确认删除" },
    });
    return { ok: true, id };
  }
  const patch: Row = {},
    details: Row = {};
  for (const [source, target] of Object.entries({
    title: "title",
    kind: "direction",
    accountName: "account",
    fromAccountName: "from_account",
    toAccountName: "to_account",
    merchant: "merchant",
    projectName: "project",
    note: "note",
    tags: "tags",
    currency: "currency",
  })) {
    if (
      (source === "fromAccountName" || source === "toAccountName") &&
      current?.kind !== "transfer" &&
      (body.kind || current?.kind) !== "transfer"
    )
      continue;
    if (source in body)
      changed(
        patch,
        target,
        body[source],
        current?.[source as keyof typeof current],
      );
  }
  if ("occurredAt" in body && body.occurredAt !== current?.occurredAt)
    patch.occurred_at = timestamp(body.occurredAt);
  if ("amount" in body) {
    const amount = decimalCents(String(body.amount));
    if (!current || amount !== decimalCents(String(current.amount)))
      patch.amount_cents = amount;
  }
  if (body.category) {
    const c =
      categories.find((c) => String(c.id) === String(body.category.id)) ||
      categories.find((c) => c.name === body.category.name);
    if (!c) throw new HttpError(400, "请选择有效流水分类");
    if (!current || current.category.id !== String(c.id))
      patch.category_id = c.id;
  }
  for (const [source, target] of Object.entries({
    reimbursementStatus: "reimbursement_status",
    reimbursedBy: "reimbursed_by",
    sourceName: "source_name",
    counterpartyId: "counterparty_id",
    invoiceIssued: "invoice_issued",
    invoiceAttachmentId: "invoice_attachment_id",
    taxCategory: "tax_category",
  })) {
    if (
      source in body &&
      JSON.stringify(body[source] ?? null) !==
        JSON.stringify(current?.[source as keyof typeof current] ?? null)
    )
      details[target] = body[source];
  }
  if (Object.keys(details).length) patch.details = details;
  if (!id) {
    patch.occurred_at ??= new Date().toISOString();
    patch.currency ??= "CNY";
    patch.title ??= "手动流水";
    patch.details = {
      source: "manual",
      reimbursement_status: "notApplicable",
      ...details,
    };
    patch.category_id ??=
      categories.find((c) => c.direction === body.kind && c.is_active)?.id ||
      categories.find((c) => c.code === "uncategorized")?.id;
  }
  if (id && !Object.keys(patch).length) return current;
  const saved = await rpc(client, "dashboard_record", {
    p_kind: "money",
    p_action: id ? "update" : "create",
    p_id: id || z.uuid().parse(body.requestId),
    p_revision: id ? z.number().int().positive().parse(body.revision) : null,
    p_data: patch,
  });
  return toTransaction(
    { ...saved, source: id ? current?.source : "web" },
    categories,
  );
}
export async function native(client: SupabaseClient, input: unknown) {
  const { method, path, params, body: raw } = inputSchema.parse(input);
  const body = (raw ?? {}) as Row;
  if (method === "GET" && path === "/v1/health")
    return {
      status: "ok",
      version: "LifeOS Cloud",
      buildId: "original-ui",
      port: 443,
      dbPath: "",
      pid: 0,
      timezone: "Asia/Shanghai",
      timezoneSource: "config",
      resolvedTimezone: "Asia/Shanghai",
      currentSystemTimezone: null,
    };
  if (method === "GET" && path === "/v1/time/configuration")
    return timeConfiguration(client);
  if (method === "PUT" && path === "/v1/time/configuration") {
    const config = await timeConfiguration(client);
    if (body.timezone !== undefined) {
      if (body.timezone !== "Asia/Shanghai")
        throw new HttpError(422, "云端账本使用北京时间，时区迁移暂不开放");
      return { ...config, convertedSegments: 0, historyMode: body.historyMode };
    }
    await rpc(client, "dashboard_configuration", {
      p_domain: "time",
      p_revision: body.revision,
      p_data: body,
    });
    return timeConfiguration(client);
  }
  if (method === "GET" && path === "/v1/time/segments") {
    const from = params.from ? timestamp(params.from) : null,
      to = params.to ? timestamp(params.to) : null;
    const { segments } = await nativeTime(
      client,
      params.includeDeleted === true || params.includeDeleted === "true",
      from && to ? { from, to } : undefined,
    );
    const filtered = segments
      .filter(
        (s) =>
          (!from || !s.endedUtc || Date.parse(s.endedUtc) > Date.parse(from)) &&
          (!to || Date.parse(s.startedUtc) < Date.parse(to)) &&
          (!params.source || s.source === params.source),
      )
      .sort((a, b) => a.startedUtc.localeCompare(b.startedUtc));
    const offset = z.coerce
        .number()
        .int()
        .min(0)
        .max(100000)
        .parse(params.offset ?? 0),
      limit = z.coerce
        .number()
        .int()
        .min(1)
        .max(100000)
        .parse(params.limit ?? 100000);
    return {
      segments: filtered.slice(offset, offset + limit),
      total: filtered.length,
    };
  }
  if (method === "GET" && path === "/v1/time/summary/range") {
    const from = date(params.from),
      to = date(params.to);
    if (to < from || daysBetween(from, to) > 366)
      throw new HttpError(400, "请选择不超过一年的范围");
    const current = await nativeTime(client, false, {
          from: new Date(bounds(from)[0]).toISOString(),
          to: new Date(bounds(to)[1]).toISOString(),
        });
    const groupOnly = current.categories.some((c) => c.metadata?.bigGroup === true);
    const summary = timeSummary(current.segments, from, to, new Date(), groupOnly);
    if (groupOnly) {
      const {data,error} = await client.rpc('get_time_sleep_summary',{p_from:from,p_to:to});
      if (error) throw new HttpError(503,'WHOOP睡眠统计暂时无法读取');
      summary.sleepAuthority = data;
    }
    return summary;
  }
  if (method === "GET" && path === "/v1/time/audit/events")
    return nativeAudits(client, "time");
  const segment = /^\/v1\/time\/segments(?:\/([0-9a-f-]{36}))?$/.exec(path);
  if (segment && ["POST", "PUT", "DELETE"].includes(method))
    return saveTime(client, method, segment[1], body);
  if (method === "POST" && path === "/v1/time/agent/operations") {
    const operation = z
      .object({
        entity: z.enum(["category", "project"]),
        action: z.enum(["create", "update", "delete"]),
        payload: z.record(z.string(), z.unknown()),
      })
      .passthrough()
      .parse(body);
    const config = await timeConfiguration(client);
    const selected =
      operation.entity === "category"
        ? config.categories.find((c) => c.name === body.name)
        : config.projects.find((p) => p.name === body.name);
    const result = await rpc(client, "dashboard_master", {
      p_entity: operation.entity,
      p_action: operation.action,
      p_id: selected?.id || null,
      p_data: operation.payload,
    });
    return { ok: true, entity: result };
  }
  if (method === "GET" && path === "/v1/fin/configuration")
    return (await nativeFinance(client)).configuration;
  if (method === "PUT" && path === "/v1/fin/configuration") {
    await rpc(client, "dashboard_configuration", {
      p_domain: "finance",
      p_revision: body.revision,
      p_data: body,
    });
    return (await nativeFinance(client)).configuration;
  }
  if (method === "GET" && path === "/v1/fin/transactions") {
    const { transactions } = await nativeFinance(
      client,
      !!params.includeDeleted,
    );
    return transactions
      .filter(
        (t) =>
          (!params.month || t.occurredAt.startsWith(String(params.month))) &&
          (!params.kind || t.kind === params.kind) &&
          (!params.categoryId || t.category.id === params.categoryId) &&
          (!params.accountName ||
            [t.accountName, t.fromAccountName, t.toAccountName].includes(
              String(params.accountName),
            )) &&
          (!params.q ||
            [t.title, t.note, t.merchant, t.accountName]
              .join(" ")
              .toLowerCase()
              .includes(String(params.q).toLowerCase())),
      )
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }
  if (method === "GET" && path === "/v1/fin/audit/events")
    return { events: await nativeAudits(client, "money") };
  if (method === "GET" && path === "/v1/fin/budget/status") {
    const { configuration, transactions } = await nativeFinance(client);
    const month = String(
      params.month || wall(new Date().toISOString())!.slice(0, 7),
    );
    const items = configuration.categories
      .filter((c) => Number(c.monthlyBudget) > 0 && !c.deletedAt)
      .map((c) => {
        const budget = Number(c.monthlyBudget);
        const spent =
          transactions
            .filter(
              (t) =>
                t.kind === "expense" &&
                t.category.id === c.id &&
                t.occurredAt.startsWith(month),
            )
            .reduce((n, t) => n + Math.round(t.amount * 100), 0) / 100;
        return {
          categoryId: c.id!,
          name: c.name,
          budget,
          spent,
          remaining: budget - spent,
          percentUsed: (spent / budget) * 100,
          color: c.tintHex || "#c96442",
        };
      });
    const totalBudget = items.reduce((n, c) => n + c.budget, 0),
      totalSpent = items.reduce((n, c) => n + c.spent, 0);
    return {
      month,
      items,
      totalBudget,
      totalSpent,
      totalRemaining: totalBudget - totalSpent,
    };
  }
  const tx = /^\/v1\/fin\/transactions(?:\/([0-9a-f-]{36}))?$/.exec(path);
  if (tx && ["POST", "PUT", "DELETE"].includes(method))
    return saveMoney(client, method, tx[1], body);
  const reimbursement =
    /^\/v1\/fin\/transactions\/([0-9a-f-]{36})\/reimbursement$/.exec(path);
  if (reimbursement && method === "PATCH") {
    await saveMoney(client, "PUT", reimbursement[1], {
      reimbursementStatus: body.status,
      revision: body.revision,
    });
    return {
      ok: true,
      id: reimbursement[1],
      status: body.status,
      operations: [],
    };
  }
  const file = await nativeFiles(client, { method, path, params, body });
  if (file !== undefined) return file;
  throw new HttpError(404, "接口不存在");
}
