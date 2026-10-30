/**
 * [INPUT]: 依赖纯解读函数、图表渲染和固定时钟样本。
 * [OUTPUT]: 验证基线边界、单位、缺失值、解读覆盖和属性转义。
 * [POS]: tests 的图表解释回归；防止把图形变化写成无依据的健康结论。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test from "node:test";
import assert from "node:assert/strict";
import { dayHelp, explainHelp, formatReading, helpAttrs, helpLayer } from "../public/chart-help.js";
import { trendChart } from "../public/charts.js";
import { insightsBoard } from "../public/insights.js";
import { buildSnapshot } from "../server/analytics.mjs";
import { buildInsights } from "../server/insights.mjs";
import { makeDemo } from "../server/demo.mjs";

const baseline = { hrv: { value: 50, count: 28 }, recovery: { value: 60, count: 28 } };
const explain = (value, key = "hrv", baselines = baseline, extra = {}) =>
  explainHelp(dayHelp({ date: "2026-10-22", [key]: value, ...extra }, [key], baselines, "2026-10-22"));
test("HRV 解释相对个人均值的差值，不与他人比较或给医学结论", () => {
  const r = explain(60).readings[0];
  assert.match(r.comparison, /高于当前参考均值 10 ms（\+20.0%）/);
  assert.match(r.meaning, /相邻心跳/);
  assert.match(r.reading, /不能单独证明/);
});
test("恢复差值用百分点，历史日期明确使用当前参考线", () => {
  const payload = dayHelp({ date: "2026-10-01", recovery: 54 }, ["recovery"], baseline, "2026-10-22");
  const help = explainHelp(payload);
  assert.match(help.readings[0].comparison, /6 个百分点/);
  assert.match(help.readings[0].reading, /黄色恢复区间/);
  assert.ok(help.notes.some((n) => n.includes("并非该日期当时的基线")));
});
test("13 次基线不判高低，校准值也不进行比较", () => {
  assert.match(explain(60, "hrv", { hrv: { value: 50, count: 13 } }).readings[0].comparison, /暂不判断高低/);
  const calibrating = explain(60, "hrv", baseline, { calibrating: true }).readings[0];
  assert.equal(calibrating.comparison, null);
  assert.match(calibrating.reading, /设备仍在校准/);
});
test("缺失值不显示为零；零时长和跨午夜时钟仍正确格式化", () => {
  const missing = explain(null).readings[0];
  assert.equal(missing.value, "暂无有效值");
  assert.equal(missing.comparison, null);
  assert.match(missing.reading, /没有数据不等于零/);
  assert.equal(formatReading(0, "sleepHours"), "0 小时 0 分");
  assert.equal(formatReading(30.5, "wakeHour"), "06:30");
  assert.equal(formatReading(23.999, "bedtime"), "00:00");
  assert.doesNotMatch(explain(60, "hrv", { hrv: { value: 0, count: 28 } }).readings[0].comparison, /Infinity|NaN/);
});
test("实际睡眠与估算需求分开说明，不重新推算睡眠完成度", () => {
  const help = explainHelp(dayHelp({ date: "2026-10-22", sleepHours: 5.5, sleepNeeded: 8 }, ["sleepHours", "sleepNeeded"]));
  assert.match(help.readings[0].meaning, /不含清醒/);
  assert.match(help.readings[1].meaning, /午睡抵扣/);
  assert.ok(help.notes.some((n) => n.includes("少 2 小时 30 分")));
  assert.doesNotMatch(help.notes.join(""), /完成度.*%/);
});
test("图形空缺日期仍能命中解释；每个图表只设置一个日期 Tab 入口", () => {
  const days = [{ date: "2026-10-21", hrv: 50 }, { date: "2026-10-22", hrv: null }];
  const svg = trendChart(days, "hrv", baseline.hrv);
  assert.equal((svg.match(/class="chart-hit"/g) || []).length, 2);
  assert.equal((svg.match(/tabindex="0"/g) || []).length, 1);
  assert.match(svg, /data-guide-x/);
  assert.doesNotMatch(svg, /NaN|Infinity/);
});
test("全景图的有效图形都有解读载荷，散点保留非因果说明", () => {
  const now = new Date("2026-10-22T18:00Z");
  const data = buildSnapshot(makeDemo(now).dataset, { now, range: 30,
    checkins: [{ date: "2026-10-22", weight: 75, energy: 4, soreness: 2 }] });
  data.insights = buildInsights(data);
  const html = insightsBoard(data);
  assert.equal((html.match(/class="panel insight-card /g) || []).length, 15);
  assert.equal((html.match(/class="chart-help-button"/g) || []).length, 15);
  assert.match(html, /class="scatter-hit"/);
  assert.match(html, /配对只展示伴随变化，不证明因果/);
  assert.match(html, /当前范围覆盖这周/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});
test("载荷经过属性转义，不能在图表中注入标签或事件", () => {
  const hostile = '<img src=x onerror="alert(1)">';
  const attrs = helpAttrs({ title: hostile, readings: [] });
  assert.doesNotMatch(attrs, /<img/);
  assert.match(attrs, /&lt;img/);
  assert.match(attrs, /&quot;/);
  const layer = helpLayer([{ title: hostile }], { x: () => 50, left: 0, right: 100, top: 0, bottom: 40 });
  assert.doesNotMatch(layer, /<img/);
});

test("七天均值不冒充当天恢复，也不套用当天的颜色解读", () => {
  const help = explainHelp({ date: "最近 7 天", readings: [{ key: "recovery", value: 54, aggregate: true }] });
  assert.doesNotMatch(help.readings[0].reading, /黄色恢复区间/);
  assert.match(help.readings[0].reading, /结合睡眠和身体感受/);
});
