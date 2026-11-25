/**
 * [INPUT]: 经过本人 AAL2 校验的 Supabase 客户端、查询参数（含 date/from/to）及编辑载荷。
 * [OUTPUT]: 灵感分页检索、可用日期索引、两层标签树聚合，以及经由事务 RPC 的增删改与标签治理。
 * [POS]: 灵感记录本人 AAL2 读写边界；公开只读抓取由 visitor-inspirations.ts 单独提供。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./auth";
import { databaseError } from "./records";
import { bounds, today, validDay } from "../src/model";
import {
  shanghaiDayFromIso,
  type InspirationRow,
  type InspirationsPageData,
  type InspirationTag,
  type InspirationTagGroup,
} from "../src/inspiration-model";

const PAGE_SIZE = 30;
const tagSegment = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine((v) => !v.includes("/"), "标签名称不能包含斜杠");

const tagPairSchema = z
  .object({
    group: tagSegment,
    name: tagSegment,
  })
  .strict();

const createSchema = z
  .object({
    content: z
      .string()
      .min(1)
      .max(10000)
      .refine((v) => v.trim().length > 0),
    title: z.string().trim().max(120).nullable().optional(),
    summary: z.string().trim().max(500).nullable().optional(),
    tags: z.array(tagPairSchema).max(8).optional(),
    pinned: z.boolean().optional(),
  })
  .strict();

const editSchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    patch: z
      .object({
        title: z.string().trim().max(120).nullable().optional(),
        summary: z.string().trim().max(500).nullable().optional(),
        content: z
          .string()
          .min(1)
          .max(10000)
          .refine((v) => v.trim().length > 0)
          .optional(),
        pinned: z.boolean().optional(),
        tags: z.array(tagPairSchema).max(8).optional(),
      })
      .strict(),
  })
  .strict();

const deleteSchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

const manageTagSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create_group"),
      payload: z
        .object({
          name: tagSegment,
          description: z.string().trim().max(200).nullable().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("create_tag"),
      payload: z
        .object({
          parent_id: z.uuid(),
          name: tagSegment,
          description: z.string().trim().max(200).nullable().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("rename"),
      payload: z
        .object({
          id: z.uuid(),
          name: tagSegment,
          description: z.string().trim().max(200).nullable().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("move"),
      payload: z
        .object({
          id: z.uuid(),
          parent_id: z.uuid(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("merge"),
      payload: z
        .object({
          source_id: z.uuid(),
          target_id: z.uuid(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("archive"),
      payload: z.object({ id: z.uuid() }).strict(),
    })
    .strict(),
]);

type DbTag = {
  id: string;
  level: 1 | 2;
  parent_id: string | null;
  name: string;
  description: string | null;
};

type DbInspiration = {
  id: string;
  raw_input_id: string | null;
  source: "wechat" | "web";
  title: string | null;
  summary: string | null;
  content: string;
  pinned: boolean;
  captured_at: string;
  revision: number;
  created_at: string;
  updated_at: string;
};

function resolveOptionalDay(raw: string | null): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (value.toLowerCase() === "today") return today();
  if (!validDay(value)) {
    throw new HttpError(400, "日期格式须为 YYYY-MM-DD 或 today");
  }
  return value;
}

export async function listInspirations(
  client: SupabaseClient,
  url: URL,
): Promise<InspirationsPageData> {
  const page = z.coerce
    .number()
    .int()
    .min(0)
    .max(10000)
    .parse(url.searchParams.get("page") ?? 0);
  const q = z
    .string()
    .max(120)
    .parse(url.searchParams.get("q") ?? "")
    .trim();
  const groupIdRaw = url.searchParams.get("group_id") ?? "";
  const tagIdRaw = url.searchParams.get("tag_id") ?? "";
  const groupId = groupIdRaw ? z.uuid().parse(groupIdRaw) : null;
  const tagId = tagIdRaw ? z.uuid().parse(tagIdRaw) : null;
  const pinnedOnly = url.searchParams.get("pinned") === "1";
  const sourceRaw = url.searchParams.get("source") ?? "";
  const source = sourceRaw
    ? z.enum(["wechat", "web"]).parse(sourceRaw)
    : null;
  const dateDay = resolveOptionalDay(url.searchParams.get("date"));
  const fromDay = resolveOptionalDay(url.searchParams.get("from"));
  const toDay = resolveOptionalDay(url.searchParams.get("to"));
  if (fromDay && toDay && toDay < fromDay) {
    throw new HttpError(400, "结束日期不能早于开始日期");
  }

  const [tagsRes, activeInspIdsRes, linksRes] = await Promise.all([
    client
      .from("inspiration_tags")
      .select("id,level,parent_id,name,description")
      .is("archived_at", null)
      .order("name"),
    client
      .from("inspirations")
      .select("id,captured_at")
      .is("deleted_at", null),
    client.from("inspiration_tag_links").select("inspiration_id,tag_id"),
  ]);
  if (tagsRes.error || activeInspIdsRes.error || linksRes.error) {
    throw new HttpError(503, "灵感标签暂时无法读取");
  }

  const activeRows = (activeInspIdsRes.data ?? []) as Array<{
    id: string;
    captured_at?: string;
  }>;
  const activeIds = new Set(activeRows.map((r) => String(r.id)));
  const availableDates = [
    ...new Set(
      activeRows
        .map((r) => (r.captured_at ? shanghaiDayFromIso(String(r.captured_at)) : ""))
        .filter(Boolean),
    ),
  ].sort((a, b) => b.localeCompare(a));

  const allTags = (tagsRes.data ?? []) as DbTag[];
  const tagById = new Map(allTags.map((t) => [t.id, t]));
  const groups = allTags.filter((t) => t.level === 1);
  const childrenByGroup = new Map<string, DbTag[]>();
  for (const tag of allTags) {
    if (tag.level === 2 && tag.parent_id && tagById.has(tag.parent_id)) {
      const list = childrenByGroup.get(tag.parent_id) ?? [];
      list.push(tag);
      childrenByGroup.set(tag.parent_id, list);
    }
  }

  const tagCounts = new Map<string, number>();
  const groupInspSets = new Map<string, Set<string>>();
  const tagsByInsp = new Map<string, InspirationTag[]>();
  const inspIdsByTag = new Map<string, Set<string>>();

  for (const link of linksRes.data ?? []) {
    const inspId = String(link.inspiration_id);
    const tid = String(link.tag_id);
    if (!activeIds.has(inspId)) continue;
    const tag = tagById.get(tid);
    if (!tag || tag.level !== 2 || !tag.parent_id) continue;
    const parent = tagById.get(tag.parent_id);
    if (!parent) continue;

    tagCounts.set(tid, (tagCounts.get(tid) ?? 0) + 1);
    const gSet = groupInspSets.get(parent.id) ?? new Set<string>();
    gSet.add(inspId);
    groupInspSets.set(parent.id, gSet);

    const tSet = inspIdsByTag.get(tid) ?? new Set<string>();
    tSet.add(inspId);
    inspIdsByTag.set(tid, tSet);

    const list = tagsByInsp.get(inspId) ?? [];
    list.push({
      id: tag.id,
      group_id: parent.id,
      group: parent.name,
      name: tag.name,
    });
    tagsByInsp.set(inspId, list);
  }

  const tagTree: InspirationTagGroup[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    count: groupInspSets.get(g.id)?.size ?? 0,
    children: (childrenByGroup.get(g.id) ?? []).map((c) => ({
      id: c.id,
      parent_id: g.id,
      name: c.name,
      description: c.description,
      count: tagCounts.get(c.id) ?? 0,
    })),
  }));

  // 确定标签过滤命中的灵感 ID 集合
  let filterIds: string[] | null = null;
  if (tagId) {
    filterIds = [...(inspIdsByTag.get(tagId) ?? [])];
  } else if (groupId) {
    filterIds = [...(groupInspSets.get(groupId) ?? [])];
  }

  if (filterIds && filterIds.length === 0) {
    return {
      rows: [],
      total: 0,
      page,
      pageSize: PAGE_SIZE,
      tagTree,
      availableDates,
    };
  }

  let query = client
    .from("inspirations")
    .select(
      "id,raw_input_id,source,title,summary,content,pinned,captured_at,revision,created_at,updated_at",
      { count: "exact" },
    )
    .is("deleted_at", null);

  if (pinnedOnly) query = query.eq("pinned", true);
  if (source) query = query.eq("source", source);
  if (filterIds) query = query.in("id", filterIds);
  if (dateDay) {
    const [startMs, endMs] = bounds(dateDay);
    query = query
      .gte("captured_at", new Date(startMs).toISOString())
      .lt("captured_at", new Date(endMs).toISOString());
  } else {
    if (fromDay) {
      const [startMs] = bounds(fromDay);
      query = query.gte("captured_at", new Date(startMs).toISOString());
    }
    if (toDay) {
      const [, endMs] = bounds(toDay);
      query = query.lt("captured_at", new Date(endMs).toISOString());
    }
  }
  if (q) {
    const escaped = q.replace(/[%_,()]/g, "");
    if (escaped) {
      query = query.or(
        `title.ilike.%${escaped}%,summary.ilike.%${escaped}%,content.ilike.%${escaped}%`,
      );
    }
  }

  const { data, error, count } = await query
    .order("pinned", { ascending: false })
    .order("captured_at", { ascending: false })
    .order("id")
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (error) throw new HttpError(503, "灵感记录暂时无法读取");

  const items = (data ?? []) as DbInspiration[];
  const rawIds = [
    ...new Set(items.map((i) => i.raw_input_id).filter(Boolean) as string[]),
  ];
  const rawTextById = new Map<string, string>();
  if (rawIds.length) {
    const rawRes = await client
      .from("raw_inputs")
      .select("id,text")
      .in("id", rawIds);
    if (!rawRes.error) {
      for (const r of rawRes.data ?? []) {
        rawTextById.set(String(r.id), String(r.text));
      }
    }
  }

  const rows: InspirationRow[] = items.map((item) => {
    const rawText = item.raw_input_id
      ? (rawTextById.get(item.raw_input_id) ?? null)
      : null;
    const tags = (tagsByInsp.get(item.id) ?? []).sort((a, b) =>
      `${a.group}/${a.name}`.localeCompare(`${b.group}/${b.name}`, "zh-CN"),
    );
    return {
      ...item,
      date_shanghai: shanghaiDayFromIso(item.captured_at),
      raw_text: rawText && rawText !== item.content ? rawText : null,
      tags,
    };
  });

  return {
    rows,
    total: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
    tagTree,
    availableDates,
  };
}

export async function createInspiration(
  client: SupabaseClient,
  input: unknown,
) {
  const value = createSchema.parse(input);
  const { data, error } = await client.rpc("create_inspiration", {
    p_content: value.content,
    p_title: value.title ?? null,
    p_summary: value.summary ?? null,
    p_tags: value.tags ?? [],
    p_pinned: value.pinned ?? false,
  });
  if (error) databaseError(error);
  return data;
}

export async function editInspiration(client: SupabaseClient, input: unknown) {
  const value = editSchema.parse(input);
  if (!Object.keys(value.patch).length) {
    throw new HttpError(400, "没有需要保存的修改");
  }
  const { data, error } = await client.rpc("edit_inspiration", {
    p_id: value.id,
    p_revision: value.revision,
    p_patch: value.patch,
  });
  if (error) databaseError(error);
  return data;
}

export async function deleteInspiration(
  client: SupabaseClient,
  input: unknown,
) {
  const value = deleteSchema.parse(input);
  const { data, error } = await client.rpc("delete_inspiration", {
    p_id: value.id,
    p_revision: value.revision,
  });
  if (error) databaseError(error);
  return data;
}

export async function manageInspirationTag(
  client: SupabaseClient,
  input: unknown,
) {
  const value = manageTagSchema.parse(input);
  const { data, error } = await client.rpc("manage_inspiration_tag", {
    p_action: value.action,
    p_payload: value.payload,
  });
  if (error) databaseError(error);
  return data;
}
