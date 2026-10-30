/**
 * [INPUT]: 纯统计函数和只读视图。
 * [OUTPUT]: 日期、覆盖率、币种隔离与原话转义验收。
 * [POS]: 无网络、无生产写入的统计契约测试。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  bounds,
  coverage,
  clipped,
  periodRange,
  today,
  validDay,
  sumsByCurrency,
  type TimeEntry,
  type DashboardData,
} from "../src/model";
import { InboxView } from "../src/InboxView";
import { timeSummary, toSegment } from "../worker/native-data";
import { summarizeTransactions } from "../src/dashboard/fin/lib/financeAnalytics";
const entry = (start: string, end: string): TimeEntry => ({
  id: start,
  start_at: start,
  end_at: end,
  activity: "写方案",
  note: null,
  category_id: 1,
});
test("上海日期不跟随浏览器所在时区", () =>
  assert.equal(today(new Date("2026-10-23T17:00:00Z")), "2026-10-24"));
test("非法日期与闰年边界", () => {
  assert.equal(validDay("2026-02-29"), false);
  assert.equal(validDay("2028-02-29"), true);
  assert.equal(validDay("2026-2-01"), false);
});
test("周从周一开始，月份包含闰日", () => {
  assert.deepEqual(periodRange("2026-10-25", "week"), [
    "2026-10-19",
    "2026-10-25",
  ]);
  assert.deepEqual(periodRange("2028-02-12", "month"), [
    "2028-02-01",
    "2028-02-29",
  ]);
});
test("跨午夜只计算当天重叠", () => {
  const [s, e] = clipped(
    entry("2026-10-23T23:30:00+08:00", "2026-10-24T00:30:00+08:00"),
    "2026-10-24",
  );
  assert.equal(e - s, 30 * 60000);
  assert.equal(s, bounds("2026-10-24")[0]);
});
test("覆盖率合并嵌套、重叠与相邻时段", () => {
  const rows = [
    entry("2026-10-24T08:00:00+08:00", "2026-10-24T10:00:00+08:00"),
    entry("2026-10-24T09:00:00+08:00", "2026-10-24T09:30:00+08:00"),
    entry("2026-10-24T09:30:00+08:00", "2026-10-24T11:00:00+08:00"),
    entry("2026-10-24T11:00:00+08:00", "2026-10-24T12:00:00+08:00"),
  ];
  const result = coverage(
    rows,
    "2026-10-24",
    Date.parse("2026-10-24T10:30:00+08:00"),
  );
  assert.equal(result.recorded, 150);
  assert.equal(result.elapsed, 630);
  assert.equal(result.gaps, 480);
});
test("未来日期覆盖率为零，不产生负空白", () =>
  assert.deepEqual(
    coverage([], "2026-10-25", Date.parse("2026-10-24T10:00:00+08:00")),
    { recorded: 0, elapsed: 0, gaps: 0, percent: 0 },
  ));
test("按币种独立保留整数分", () => {
  const row = {
    day: "2026-10-24",
    category_id: 1,
    direction: "expense" as const,
  };
  assert.deepEqual(
    sumsByCurrency([
      { ...row, currency: "CNY", cents: 3800 },
      { ...row, currency: "USD", cents: 100 },
      { ...row, currency: "CNY", cents: 1 },
    ]),
    { CNY: { expense: 3801, income: 0 }, USD: { expense: 100, income: 0 } },
  );
});
test("拒绝无法精确表示的金额", () =>
  assert.throws(() =>
    sumsByCurrency([
      {
        day: "2026-10-24",
        category_id: 1,
        direction: "expense",
        currency: "CNY",
        cents: 2 ** 53,
      },
    ]),
  ));
const data: DashboardData = {
  categories: [],
  time: [],
  money: [],
  entries: [],
  transactions: [],
  inbox: [],
  transactionsMore: false,
  inboxMore: false,
  fetchedAt: "2026-10-24T00:00:00Z",
};
test("原话按文本转义，保留状态", () => {
  const html = renderToStaticMarkup(
    createElement(InboxView, {
      data: {
        ...data,
        inbox: [
          {
            id: "id",
            text: "<script>alert(1)</script>",
            status: "awaiting_clarification",
            received_at: "2026-10-24T00:00:00Z",
            input_kind: "record",
            error_code: null,
            revoked_at: null,
            clarification_prompt: "多长时间？",
          },
        ],
      },
    }),
  );
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("等待补充"));
  assert.ok(html.includes("多长时间？"));
});
test("原版空财务汇总为零，账户余额独立推导", () => {
  const value=summarizeTransactions([]);
  assert.equal(value.income,0);assert.equal(value.expense,0);assert.equal(value.net,0);assert.equal(value.count,0);
});
test("未来时段保留原记录，不提前计入原版创作和覆盖统计", () => {
  const segment=toSegment({id:'future',revision:1,start_at:'2026-10-25T09:00:00+08:00',end_at:'2026-10-25T10:00:00+08:00',category_id:1,activity:'写方案'},[{id:1,name:'写作',nature:'core'}]);
  const summary=timeSummary([segment],'2026-10-25','2026-10-25',new Date('2026-10-25T00:42:00Z'));
  assert.equal(segment.title,'写方案');assert.equal(segment.grossMinutes,60);
  assert.equal(summary.effectiveWorkMinutes,0);assert.equal(summary.recordedMinutes,0);
});
test("原版创作和覆盖统计使用同一快照时刻", () => {
  const segment=toSegment({id:'active',revision:1,start_at:'2026-10-25T08:30:00+08:00',end_at:'2026-10-25T09:30:00+08:00',category_id:1,activity:'写方案'},[{id:1,name:'写作',nature:'core'}]);
  const summary=timeSummary([segment],'2026-10-25','2026-10-25',new Date('2026-10-25T00:42:00Z'));
  assert.equal(summary.effectiveWorkMinutes,12);assert.equal(summary.recordedMinutes,12);
});
