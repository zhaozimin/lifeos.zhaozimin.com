/**
 * [INPUT]: 经过本人 AAL2 校验的 Supabase 客户端与日期范围。
 * [OUTPUT]: 完整日聚合、当天时间及有上限的明细。
 * [POS]: 网页只读查询；原话只选授权字段，不暴露渠道上下文。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  bounds,
  daysBetween,
  validDay,
  type DashboardData,
} from "../src/model";
import { HttpError } from "./auth";
type PageQuery = {
  range: (
    start: number,
    end: number,
  ) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
};
async function all<T>(query: () => PageQuery): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < 100000; offset += 1000) {
    const { data, error } = await query().range(offset, offset + 999);
    if (error) throw new HttpError(503, "记录暂时无法读取，请稍后刷新");
    rows.push(...(data as T[]));
    if ((data?.length ?? 0) < 1000) return rows;
  }
  throw new HttpError(422, "记录过多，请缩小日期范围");
}
export async function dashboard(
  client: SupabaseClient,
  url: URL,
): Promise<DashboardData> {
  const start = url.searchParams.get("start") ?? "",
    end = url.searchParams.get("end") ?? "",
    day = url.searchParams.get("day") ?? "";
  if (
    !validDay(start) ||
    !validDay(end) ||
    !validDay(day) ||
    end < start ||
    daysBetween(start, end) > 366 ||
    day < start ||
    day > end
  )
    throw new HttpError(400, "日期范围无效");
  const [begin, finish] = bounds(day),
    rangeBegin = bounds(start)[0],
    rangeEnd = bounds(end)[1];
  const [categories, time, money, entries, tx, inbox] = await Promise.all([
    all(() =>
      client
        .from("categories")
        .select("id,name,code,kind,nature,direction,is_active")
        .order("id"),
    ),
    all(() =>
      client
        .from("v_daily_time")
        .select("day,category_id,minutes")
        .gte("day", start)
        .lte("day", end)
        .order("day")
        .order("category_id"),
    ),
    all(() =>
      client
        .from("v_daily_money")
        .select("day,category_id,direction,currency,cents")
        .gte("day", start)
        .lte("day", end)
        .order("day")
        .order("category_id")
        .order("currency")
        .order("direction"),
    ),
    all(() =>
      client
        .from("time_entries")
        .select(
          "id,start_at,end_at,category_id,activity,note,deduction_minutes,deduction_note,project,tags,revision,updated_at",
        )
        .is("deleted_at", null)
        .or(`end_at.gt.${new Date(begin).toISOString()},end_at.is.null`)
        .lt("start_at", new Date(finish).toISOString())
        .order("start_at")
        .order("id"),
    ),
    client
      .from("transactions")
      .select(
        "id,occurred_at,direction,amount_cents,currency,category_id,account,merchant,note,title,from_account,to_account,project,tags,details,revision,updated_at",
      )
      .is("deleted_at", null)
      .gte("occurred_at", new Date(rangeBegin).toISOString())
      .lt("occurred_at", new Date(rangeEnd).toISOString())
      .order("occurred_at", { ascending: false })
      .order("id")
      .limit(201),
    client
      .from("raw_inputs")
      .select(
        "id,text,received_at,input_kind,status,clarification_prompt,error_code,revoked_at",
      )
      .eq("source", "wechat")
      .order("received_at", { ascending: false })
      .order("id")
      .limit(101),
  ]);
  if (tx.error || inbox.error)
    throw new HttpError(503, "明细暂时无法读取，请稍后刷新");
  const result = {
    categories,
    time,
    money,
    entries,
    transactions: tx.data.slice(0, 200),
    inbox: inbox.data.slice(0, 100),
    transactionsMore: tx.data.length > 200,
    inboxMore: inbox.data.length > 100,
    fetchedAt: new Date().toISOString(),
  } as DashboardData;
  if (
    result.money.some((r) => !Number.isSafeInteger(Number(r.cents))) ||
    result.transactions.some(
      (r) => !Number.isSafeInteger(Number(r.amount_cents)),
    )
  )
    throw new HttpError(422, "金额超出精确范围");
  return result;
}
