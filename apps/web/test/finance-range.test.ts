/**
 * [INPUT]: 依赖财务区间编码、边界解释和流水归属判定。
 * [OUTPUT]: 验证自定义区间含首尾、单日和反向跨年选择。
 * [POS]: 财务日历的数据口径回归；交互完成后使用同一范围键筛选。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isoDay, rangeBounds, rangeBucket, transactionMatchesRange } from "../src/dashboard/fin/lib/timeRange";
import type { Transaction } from "../src/dashboard/fin/types";

const transaction = (day: string): Transaction => ({ occurredAt: day } as Transaction);

test("财务区间包含开始日和结束日的全部流水，排除相邻两天", () => {
  const bucket = rangeBucket(new Date(2026, 9, 10), new Date(2026, 9, 12));
  for (const day of ["2026-10-10T00:00:00", "2026-10-11T12:00:00", "2026-10-12T23:59:59"]) {
    assert.equal(transactionMatchesRange(transaction(day), "custom", bucket), true, day);
  }
  for (const day of ["2026-10-09T23:59:59", "2026-10-13T00:00:00"]) {
    assert.equal(transactionMatchesRange(transaction(day), "custom", bucket), false, day);
  }
});

test("财务日历反向跨年选择归一为正向区间", () => {
  const bucket = rangeBucket(new Date(2027, 0, 2), new Date(2026, 11, 30));
  assert.equal(bucket, "2026-12-30..2027-01-02");
  const { from, to } = rangeBounds("custom", bucket);
  assert.equal(isoDay(from!), "2026-12-30");
  assert.equal(isoDay(to!), "2027-01-02");
  assert.equal(transactionMatchesRange(transaction("2027-01-01T12:00:00"), "custom", bucket), true);
});

test("两次选择同一天只包含该自然日，支持闰日", () => {
  const date = new Date(2028, 1, 29);
  const bucket = rangeBucket(date, date);
  assert.equal(bucket, "2028-02-29..2028-02-29");
  assert.equal(transactionMatchesRange(transaction("2028-02-29T23:59:59"), "custom", bucket), true);
  assert.equal(transactionMatchesRange(transaction("2028-02-28T23:59:59"), "custom", bucket), false);
  assert.equal(transactionMatchesRange(transaction("2028-03-01T00:00:00"), "custom", bucket), false);
});
