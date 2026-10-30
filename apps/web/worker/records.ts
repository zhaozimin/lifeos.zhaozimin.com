/**
 * [INPUT]: 经过本人 AAL2 校验的客户端、筛选及编辑补丁。
 * [OUTPUT]: 分页历史、记录详情、版本和受限人工编辑。
 * [POS]: 账目访问边界；只通过事务 RPC 写入，不读取微信上下文。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validDay, bounds } from "../src/model";
import {
  RECORD_KINDS,
  type RecordKind,
  type RecordPage,
  type RecordDetail,
  type RecordRow,
} from "../src/record-model";
import { HttpError } from "./auth";
const kinds = Object.keys(RECORD_KINDS) as [RecordKind, ...RecordKind[]];
const kindSchema = z.enum(kinds);
const nullableText = z.string().max(10000).nullable();
const common = {
  note: nullableText.optional(),
  project: z.string().max(500).nullable().optional(),
  tags: z.array(z.string().max(80)).max(50).optional(),
};
const timestamp = z.iso.datetime({ offset: true });
const category = z.number().int().positive().max(32767);
const patches = {
  time: z
    .object({
      ...common,
      start_at: timestamp.optional(),
      end_at: timestamp.nullable().optional(),
      activity: z.string().trim().min(1).max(500).optional(),
      category_id: category.optional(),
      deduction_minutes: z.number().int().nonnegative().optional(),
      deduction_note: z.string().max(2000).nullable().optional(),
    })
    .strict(),
  money: z
    .object({
      ...common,
      occurred_at: timestamp.optional(),
      title: z.string().max(500).nullable().optional(),
      direction: z.enum(["expense", "income", "transfer"]).optional(),
      amount_cents: z
        .number()
        .int()
        .min(-Number.MAX_SAFE_INTEGER)
        .max(Number.MAX_SAFE_INTEGER)
        .optional(),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .optional(),
      category_id: category.optional(),
      account: z.string().max(500).nullable().optional(),
      from_account: z.string().max(500).nullable().optional(),
      to_account: z.string().max(500).nullable().optional(),
      merchant: z.string().max(500).nullable().optional(),
    })
    .strict(),
  account: z
    .object({
      name: z.string().trim().min(1).max(500).optional(),
      openingBalance: z.number().finite().optional(),
      note: nullableText.optional(),
    })
    .strict(),
  task: z
    .object({
      title: z.string().trim().min(1).max(500).optional(),
      task_date: z.string().refine(validDay).nullable().optional(),
      start_time: z
        .string()
        .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
        .nullable()
        .optional(),
      end_time: z
        .string()
        .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
        .nullable()
        .optional(),
      status: z.enum(["pending", "completed"]).optional(),
      group_id: z.string().max(200).nullable().optional(),
      note: nullableText.optional(),
    })
    .strict(),
  task_group: z
    .object({
      title: z.string().trim().min(1).max(500).optional(),
      note: nullableText.optional(),
    })
    .strict(),
  project: z
    .object({
      name: z.string().trim().min(1).max(500).optional(),
      note: nullableText.optional(),
    })
    .strict(),
};
export function databaseError(error: { code?: string; message?: string }): never {
  if (error.code === "23514" && error.message?.includes("overlap")) throw new HttpError(409,"时段与已有记录重叠，请调整起止时间");
  if (error.code === "23514" && error.message?.includes("future")) throw new HttpError(400,"时间记录不能晚于当前时刻");
  if (error.code === "40001")
    throw new HttpError(409, "这条记录已被更新，请重新载入后再保存");
  if (error.code === "23505")
    throw new HttpError(409, "名称已存在，请使用其他名称");
  if (error.code === "42501")
    throw new HttpError(403, "请重新完成本人动态码验证");
  if (error.code === "P0002" || error.code === "PGRST116")
    throw new HttpError(404, "记录不存在");
  if (
    error.code?.startsWith("22") ||
    error.code === "23514" ||
    error.code === "23502"
  )
    throw new HttpError(
      400,
      "内容不符合账本规则，请检查时间、金额、分类和账户",
    );
  throw new HttpError(503, "记录暂时无法保存，请稍后重试");
}
export async function editRecord(client: SupabaseClient, input: unknown) {
  const value = z
    .object({
      kind: kindSchema,
      id: z.uuid(),
      revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      patch: z.record(z.string(), z.unknown()),
    })
    .strict()
    .parse(input);
  const patch = patches[value.kind].parse(value.patch);
  if (!Object.keys(patch).length)
    throw new HttpError(400, "没有需要保存的修改");
  const { data, error } = await client.rpc("edit_record", {
    p_kind: value.kind,
    p_id: value.id,
    p_revision: value.revision,
    p_patch: patch,
  });
  if (error) databaseError(error);
  return data;
}
export async function records(
  client: SupabaseClient,
  url: URL,
): Promise<RecordPage> {
  const kind = kindSchema.parse(url.searchParams.get("kind") ?? "time");
  const page = z.coerce
    .number()
    .int()
    .min(0)
    .max(100000)
    .parse(url.searchParams.get("page") ?? 0);
  const search = z
    .string()
    .max(100)
    .parse(url.searchParams.get("q") ?? "")
    .trim();
  const start = url.searchParams.get("start"),
    end = url.searchParams.get("end");
  if (
    (start || end) &&
    (!start || !end || !validDay(start) || !validDay(end) || end < start)
  )
    throw new HttpError(400, "日期范围无效");
  let query = client
    .from("v_records")
    .select("id,kind,event_at,title,source,data", { count: "exact" })
    .eq("kind", kind)
    .is("deleted_at", null);
  if (start && end)
    query = query
      .gte("event_at", new Date(bounds(start)[0]).toISOString())
      .lt("event_at", new Date(bounds(end)[1]).toISOString());
  if (search) query = query.ilike("search_text", `%${search}%`);
  const { data, error, count } = await query
    .order("event_at", { ascending: false })
    .order("id")
    .range(page * 50, page * 50 + 49);
  if (error) throw new HttpError(503, "历史记录暂时无法读取");
  return { rows: data as RecordRow[], total: count ?? 0, page, pageSize: 50 };
}
export async function recordDetail(
  client: SupabaseClient,
  url: URL,
): Promise<RecordDetail> {
  const kind = kindSchema.parse(url.searchParams.get("kind")),
    id = z.uuid().parse(url.searchParams.get("id"));
  const { data: record, error } = await client
    .from("v_records")
    .select("id,kind,event_at,title,source,data")
    .eq("kind", kind)
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error) databaseError(error);
  const [changes, categories, choices, attachments] = await Promise.all([
    client
      .from("record_changes")
      .select("revision,before_data,after_data,changed_at,actor")
      .eq("kind", kind)
      .eq("record_id", id)
      .order("revision", { ascending: false })
      .limit(51),
    client
      .from("categories")
      .select("id,name,code,kind,nature,direction,is_active")
      .order("id"),
    client
      .from("local_records")
      .select("id,kind,source_id,data,revision,updated_at")
      .is("deleted_at", null)
      .in("kind", ["account", "task_group", "project"])
      .order("id"),
    kind === "money"
      ? client
          .from("record_attachments")
          .select("id,filename,mime,size_bytes")
          .eq("transaction_id", id)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (changes.error || categories.error || choices.error || attachments.error)
    throw new HttpError(503, "记录详情暂时无法读取");
  let source = null;
  if (record.data.raw_input_id) {
    const original = await client
      .from("raw_inputs")
      .select("source,text,received_at")
      .eq("id", record.data.raw_input_id)
      .single();
    if (original.error) throw new HttpError(503, "来源暂时无法读取");
    source = original.data;
  }
  return {
    record: record as RecordRow,
    changes: changes.data.slice(0, 50),
    changesMore: changes.data.length > 50,
    categories: categories.data,
    choices: choices.data as RecordDetail["choices"],
    attachments: attachments.data,
    source,
  };
}
export async function attachment(client: SupabaseClient, id: string) {
  z.uuid().parse(id);
  const { data, error } = await client.rpc("read_attachment", { p_id: id });
  if (error) databaseError(error);
  const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
  if (bytes.length !== data.size_bytes)
    throw new HttpError(503, "附件校验失败");
  return {
    bytes,
    filename: String(data.filename),
    mime: ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(
      data.mime,
    )
      ? String(data.mime)
      : "application/octet-stream",
  };
}
