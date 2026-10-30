/**
 * [INPUT]: 依赖分析层、建议层与内存演示数据。
 * [OUTPUT]: 验证生理日期、有效样本与建议边界。
 * [POS]: tests 的数据正确性回归；固定时钟避免跨日波动。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildSnapshot, dateAt } from "../server/analytics.mjs";
import { buildGuidance, exportSummary } from "../server/guidance.mjs";
import { makeDemo } from "../server/demo.mjs";

const now = new Date("2026-10-21T18:00:00Z");
const demo = () => makeDemo(now).dataset;
const snapshot = (data = demo(), options = {}) =>
  buildSnapshot(data, { now, ...options });

test("记录时区决定日期，跨 UTC 午夜不串日", () => {
  assert.equal(dateAt("2026-10-22T02:30:00Z", "-07:00"), "2026-10-21");
  assert.equal(dateAt("2026-10-21T19:30:00Z", "+08:00"), "2026-10-22");
  assert.equal(dateAt("bad", "-07:00"), null);
});
test("恢复按 sleep_id 关联，忽略迟到的 created_at", () => {
  const data = demo();
  data.recoveries.at(-1).created_at = "2026-10-22T03:00:00Z";
  assert.equal(snapshot(data).latest.recovery, 78);
  assert.equal(snapshot(data).latest.date, "2026-10-21");
});
test("实际睡眠只累计浅睡、深睡与 REM", () => {
  const data = demo();
  const stage = data.sleeps.at(-1).score.stage_summary;
  stage.total_in_bed_time_milli = 10 * 3600000;
  stage.total_awake_time_milli = 3600000;
  stage.total_no_data_time_milli = 2 * 3600000;
  assert.equal(snapshot(data).latest.sleepHours, 7.75);
  assert.equal(snapshot(data).latest.sleepNeeded, 8.15);
});
test("午睡不能替换主睡眠，睡眠需求包含负的午睡抵扣", () => {
  const data = demo();
  const sleep = structuredClone(data.sleeps.at(-1));
  data.sleeps.at(-1).score.sleep_needed.need_from_recent_nap_milli = -3600000;
  data.sleeps.push({
    ...sleep,
    id: "nap",
    nap: true,
    start: "2026-10-21T15:00:00Z",
    end: "2026-10-21T15:30:00Z",
  });
  assert.equal(snapshot(data).latest.sleepHours, 7.75);
  assert.equal(snapshot(data).latest.sleepNeeded, 7.15);
});
test("未评分数据不读取残留 score，空值不变成零", () => {
  const data = demo();
  data.recoveries.at(-1).score_state = "PENDING_SCORE";
  data.sleeps.at(-1).score_state = "UNSCORABLE";
  const result = snapshot(data);
  assert.equal(result.latest.recovery, null);
  assert.equal(result.latest.sleepHours, null);
  assert.equal(buildGuidance(result).status, "waiting");
});
test("基线只取今日之前 28 天，排除校准中的恢复", () => {
  const data = demo();
  const base = snapshot(data).baseline.hrv.value;
  data.recoveries.at(-1).score.hrv_rmssd_milli = 900;
  assert.equal(snapshot(data).baseline.hrv.value, base);
  data.recoveries.at(-2).score.user_calibrating = true;
  assert.equal(snapshot(data).baseline.hrv.count, 27);
  assert.equal(snapshot(data).baseline.sleepHours.count, 28);
});
test("缺失日期保留断点，昨日高恢复不作为今日建议", () => {
  const data = demo();
  for (const key of ["cycles", "recoveries", "sleeps"]) data[key].pop();
  const result = snapshot(data);
  assert.equal(result.days.length, 30);
  assert.equal(result.latest.recovery, null);
  assert.equal(result.coverage.lastRecoveryDate, "2026-10-20");
  assert.equal(buildGuidance(result).status, "waiting");
});
test("校准中的今日分数不触发加量建议", () => {
  const data = demo();
  data.recoveries.at(-1).score.user_calibrating = true;
  assert.equal(buildGuidance(snapshot(data)).status, "waiting");
});
test("HRV 与静息心率联合提示至少需要 14 次有效基线", () => {
  const result = snapshot();
  result.latest.hrv = 30;
  result.latest.rhr = 80;
  assert.equal(buildGuidance(result).status, "rest");
  result.baseline.hrv.count = 13;
  result.baseline.rhr.count = 13;
  assert.equal(buildGuidance(result).status, "ready");
});
test("低睡眠与主观不适覆盖较好的恢复分数", () => {
  const result = snapshot();
  result.latest.sleepHours = 5.5;
  assert.equal(buildGuidance(result).status, "rest");
  result.latest.sleepHours = 8;
  result.checkin = { energy: 1 };
  assert.equal(buildGuidance(result).status, "rest");
});
test("严重症状优先于任何设备分数", () => {
  const result = snapshot();
  result.checkin = { symptoms: ["胸痛"], energy: 5 };
  assert.equal(buildGuidance(result).status, "urgent");
  assert.match(buildGuidance(result).summary, /急救/);
});
test("AI 摘要不包含账户、记录 ID 或自由文字", () => {
  const result = snapshot();
  result.checkin = {
    energy: 3,
    soreness: 2,
    symptoms: [],
    notes: "私密文字",
    nutrition: "私密饮食",
  };
  const text = JSON.stringify(exportSummary(result));
  assert.doesNotMatch(
    text,
    /cycleId|sleep_id|user_id|私密文字|私密饮食|access_token/,
  );
  assert.equal(exportSummary(result).days.length, 28);
});
