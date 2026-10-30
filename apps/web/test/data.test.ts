/**
 * [INPUT]: 数据接口及受控分页查询。
 * [OUTPUT]: 完整聚合、明细上限与字段隔离验收。
 * [POS]: 查询契约测试；不向生产写入测试账目。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dashboard } from "../worker/data";
function mock(tables: Record<string, unknown[]>, failure = "") {
  const selections: Record<string, string> = {},
    pages: Record<string, number> = {};
  const filters: Array<[string, string, unknown]> = [];
  const client = {
    from: (table: string) => {
      const query = {
        select: (columns: string) => {
          selections[table] = columns;
          return query;
        },
        order: () => query,
        eq: (field: string, value: unknown) => {
          filters.push([table, field, value]);
          return query;
        },
        gte: () => query,
        lte: () => query,
        is: () => query,
        gt: () => query,
        or: () => query,
        lt: () => query,
        range: async (start: number, end: number) => {
          pages[table] = (pages[table] ?? 0) + 1;
          return {
            data: tables[table]?.slice(start, end + 1) ?? [],
            error: table === failure ? { message: "private error" } : null,
          };
        },
        limit: async (count: number) => ({
          data: tables[table]?.slice(0, count) ?? [],
          error: table === failure ? { message: "private error" } : null,
        }),
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, selections, pages, filters };
}
const url = new URL(
  "https://lifeos.example/api/dashboard?start=2026-10-01&end=2026-10-31&day=2026-10-24",
);
test("日聚合读取超过 1000 行且不静默截断", async () => {
  const m = mock({
    v_daily_time: Array.from({ length: 1024 }, (_, i) => ({
      day: "2026-10-24",
      category_id: i,
      minutes: 60,
    })),
  });
  const result = await dashboard(m.client, url);
  assert.equal(result.time.length, 1024);
  assert.equal(m.pages.v_daily_time, 2);
});
test("明细上限有显式标识，完整聚合不受明细上限影响", async () => {
  const m = mock({
    transactions: Array.from({ length: 201 }, (_, i) => ({
      id: String(i),
      amount_cents: 100,
    })),
    raw_inputs: Array.from({ length: 101 }, (_, i) => ({ id: String(i) })),
  });
  const result = await dashboard(m.client, url);
  assert.equal(result.transactions.length, 200);
  assert.equal(result.inbox.length, 100);
  assert.equal(result.transactionsMore, true);
  assert.equal(result.inboxMore, true);
});
test("原话不读取渠道令牌、payload 或回执上下文", async () => {
  const m = mock({});
  await dashboard(m.client, url);
  assert.equal(
    m.selections.raw_inputs,
    "id,text,received_at,input_kind,status,clarification_prompt,error_code,revoked_at",
  );
  assert.ok(!Object.values(m.selections).some((s) => s.includes("*")));
  assert.ok(
    m.filters.some(
      ([table, field, value]) =>
        table === "raw_inputs" && field === "source" && value === "wechat",
    ),
  );
});
test("查询错误不向前端暴露数据库细节", async () => {
  const m = mock({}, "v_daily_money");
  await assert.rejects(() => dashboard(m.client, url), {
    status: 503,
    message: "记录暂时无法读取，请稍后刷新",
  });
});
test("拒绝逆序、超一年与脱离范围的日期", async () => {
  for (const query of [
    "start=2026-10-24&end=2026-10-23&day=2026-10-24",
    "start=2025-01-01&end=2026-10-24&day=2026-10-24",
    "start=2026-10-01&end=2026-10-24&day=2026-11-01",
  ]) {
    await assert.rejects(
      () =>
        dashboard(
          mock({}).client,
          new URL("https://lifeos.example/api/dashboard?" + query),
        ),
      { status: 400 },
    );
  }
});
