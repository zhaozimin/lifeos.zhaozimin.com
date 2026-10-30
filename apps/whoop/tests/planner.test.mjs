/**
 * [INPUT]: 依赖晨间引擎、上海日历和隔离的 SQLite。
 * [OUTPUT]: 验证当天目标、最新同步门槛、预览、重试和修订。
 * [POS]: tests 的晨间发布回归；时钟与 WHOOP 均使用本地夹具。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { ReportService } from "../server/reports.mjs";
import { buildPlan, planMarkdown } from "../server/planner.mjs";
import { buildSnapshot } from "../server/analytics.mjs";
import { makeDemo } from "../server/demo.mjs";
import { dueSlot, preparationSlot, localClock, reportPreferences } from "../server/calendar.mjs";
import { validateSettings } from "../server/config.mjs";
import { buildInsights } from "../server/insights.mjs";

const now = new Date("2026-10-21T23:00:00Z");
const prefs = { reportTime: "07:00", timeZone: "Asia/Shanghai", wakeTime: "06:30" };
function morningDataset(date = "2026-10-22") {
  const dataset = makeDemo(new Date(`${date}T12:00Z`)).dataset;
  for (const rows of Object.values(dataset)) for (const row of rows) {
    row.timezone_offset = "+08:00";
    for (const key of ["start", "end", "created_at", "updated_at"])
      if (row[key]) row[key] = new Date(Date.parse(row[key]) - 9 * 3600000).toISOString();
  }
  return dataset;
}
const snapshot = (options = {}) => buildSnapshot(morningDataset(), { now, range: 90, calendarDate: "2026-10-22", ...options });
const success = (time = now) => ({ succeeded: true, startedAt: new Date(time - 1000).toISOString(), finishedAt: time.toISOString() });
const plan = (data = snapshot(), options = {}) => buildPlan(data, {
  now, settings: prefs, targetDate: "2026-10-22", refresh: success(), ...options,
});

test("上海 07:00 发布当天，06:00–07:00 只进入晨间预览", () => {
  assert.equal(dueSlot(new Date("2026-10-21T22:59Z"), prefs).targetDate, "2026-10-21");
  const due = dueSlot(now, prefs);
  assert.equal(due.targetDate, "2026-10-22");
  assert.equal(due.catchUp, false);
  assert.equal(preparationSlot(new Date("2026-10-21T21:59Z"), prefs), null);
  assert.equal(preparationSlot(new Date("2026-10-21T22:00Z"), prefs).targetDate, "2026-10-22");
  assert.equal(preparationSlot(now, prefs), null);
  assert.equal(reportPreferences().reportTime, "07:00");
  assert.equal(reportPreferences().timeZone, "Asia/Shanghai");
});
test("日期与夏令时使用指定 IANA 时区，不受电脑洛杉矶时区影响", () => {
  assert.equal(localClock(now, prefs.timeZone).date, "2026-10-22");
  assert.equal(localClock(now, "America/Los_Angeles").date, "2026-10-21");
  const la = { ...prefs, timeZone: "America/Los_Angeles" };
  assert.equal(localClock(new Date("2026-10-31T14:00Z"), la.timeZone).time, "07:00");
  assert.equal(localClock(new Date("2026-11-01T15:00Z"), la.timeZone).time, "07:00");
  assert.equal(dueSlot(new Date("2026-11-01T15:00Z"), la).targetDate, "2026-11-01");
});
test("最新同步成功并取得当天睡眠恢复后，才发布今天训练", () => {
  const p = plan();
  assert.equal(p.targetDate, "2026-10-22");
  assert.equal(p.period, "today");
  assert.equal(p.publication.state, "published");
  assert.equal(p.sleep.bedtime, "22:30");
  assert.equal(p.sleep.wakeTime, "06:30");
  assert.equal(p.nutrition.meals.length, 3);
  assert.notEqual(p.exercise.minutes, null);
  assert.match(planMarkdown(p), /今晚作息/);
  assert.doesNotMatch(planMarkdown(p), /## 明晨调整/);
});
test("旧的成功同步时间不能替代本次拉取，失败时不发布缓存训练", () => {
  const p = plan(snapshot(), { refresh: { succeeded: false, reason: "sync-failed" },
    sync: { finishedAt: now.toISOString() } });
  assert.equal(p.publication.state, "waiting");
  assert.equal(p.exercise.minutes, null);
  assert.match(p.exercise.mode, /等待最新数据/);
  assert.ok(p.missing.some((s) => s.includes("本次最新同步未成功")));
});
test("恢复待评分、睡眠待评分、校准和昨日高分均不能发布今日剂量", () => {
  for (const change of [
    { recoveryState: "PENDING_SCORE" }, { sleepState: "PENDING_SCORE" },
    { calibrating: true }, { date: "2026-10-21" }, { timestamp: "2026-10-19T22:10Z" },
  ]) {
    const data = snapshot(); Object.assign(data.latest, change);
    const report = plan(data);
    assert.equal(report.publication.state, "waiting");
    assert.equal(report.exercise.minutes, null);
  }
});
test("短睡眠降低训练并预留今晚睡眠，严重症状优先于设备分数", () => {
  const data = snapshot(); data.latest.sleepHours = 5.5;
  assert.equal(plan(data).status, "rest");
  assert.equal(plan(data).sleep.bedtime, "22:00");
  const urgent = snapshot({ checkins: [{ date: "2026-10-22", symptoms: ["胸痛"], energy: 5 }] });
  assert.equal(plan(urgent, { refresh: null }).exercise.minutes, 0);
  assert.equal(plan(urgent).status, "urgent");
  const limited = snapshot({ settings: { constraints: "膝盖疼，避免深蹲" } });
  assert.equal(plan(limited).exercise.mode, "先确认活动范围");
});
test("饮食偏好与忌口仍受尊重，输入验证拒绝无效时间时区年龄", () => {
  const vegan = plan(snapshot(), { settings: { ...prefs, diet: "纯素" } });
  assert.doesNotMatch(vegan.nutrition.meals.map((m) => m.text).join(""), /鸡蛋|牛奶|鸡肉|鱼|瘦肉|酸奶/);
  const allergy = plan(snapshot(), { settings: { ...prefs, foodRestrictions: "大豆和鸡蛋过敏" } });
  assert.doesNotMatch(allergy.nutrition.meals.map((m) => m.text).join(""), /豆腐|鸡蛋|豆浆/);
  for (const input of [{ reportTime: "25:00" }, { timeZone: "Bad/Zone" }, { age: 17 }])
    assert.throws(() => validateSettings(input));
});

function setup(t, time = "2026-10-21T23:00Z") {
  const dir = mkdtempSync(path.join(tmpdir(), "lifeos-morning-test-"));
  const store = new Store(dir);
  store.set("settings", prefs); store.set("tokens", { fake: true });
  store.db.prepare("INSERT INTO records VALUES (?,?,?)").run("cycles", "seed", "{}");
  let clock = new Date(time), calls = 0, data = snapshot();
  const whoop = { sync: async () => {
    calls++; const sync = { startedAt: clock.toISOString(), finishedAt: clock.toISOString(), error: null };
    store.set("sync", sync); return sync;
  } };
  const service = new ReportService(store, whoop, () => data, () => clock);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, service, whoop, calls: () => calls, data: () => data,
    setData: (value) => { data = value; }, setTime: (time) => { clock = new Date(time); } };
}
test("凌晨不补昨天的训练；06:15 预览后 07:00 必须再次同步", async (t) => {
  const f = setup(t, "2026-10-21T17:00Z");
  await f.service.tick(); assert.equal(f.calls(), 0);
  f.setTime("2026-10-21T22:15Z"); await f.service.tick();
  assert.equal(f.store.plan("2026-10-22", prefs.timeZone).publication.state, "preview");
  assert.equal(f.calls(), 1);
  f.setTime("2026-10-21T23:00Z"); await f.service.tick();
  assert.equal(f.calls(), 2);
  assert.equal(f.store.plan("2026-10-22", prefs.timeZone).publication.state, "published");
  assert.equal(f.store.plan("2026-10-22", prefs.timeZone).revision, 2);
});
test("发布必须等待拉取结束，并读取拉取后更新的恢复值", async (t) => {
  const f = setup(t);
  let release;
  f.whoop.sync = async () => { await new Promise((resolve) => { release = resolve; }); f.data().latest.recovery = 20; return success(); };
  const result = f.service.generate();
  assert.equal(f.store.plans(prefs.timeZone).length, 0);
  release();
  const published = await result;
  assert.equal(published.basis.metrics.recovery, 20);
  assert.equal(published.status, "rest");
});
test("评分未到每 5 分钟重试，数据到齐后发布，等待状态不吞掉正式任务", async (t) => {
  const f = setup(t); f.data().latest.recoveryState = "PENDING_SCORE";
  await f.service.tick(); await f.service.tick();
  assert.equal(f.calls(), 1);
  assert.equal(f.store.hasScheduledPlan("2026-10-22", prefs.timeZone), false);
  f.setTime("2026-10-21T23:04Z"); await f.service.tick(); assert.equal(f.calls(), 1);
  f.data().latest.recoveryState = "SCORED";
  f.setTime("2026-10-21T23:05Z"); await f.service.tick();
  assert.equal(f.calls(), 2);
  assert.equal(f.store.hasScheduledPlan("2026-10-22", prefs.timeZone), true);
});
test("正式发布后重启不重复，手动更新仍同步并保留修订", async (t) => {
  const f = setup(t); await f.service.tick(); await f.service.tick();
  const restarted = new ReportService(f.store, f.whoop, () => f.data(), () => now);
  await restarted.tick(); assert.equal(f.calls(), 1);
  await restarted.generate();
  assert.equal(f.calls(), 2);
  assert.equal(f.store.plan("2026-10-22", prefs.timeZone).revision, 2);
});
test("同步失败不发布；已有正式安排保留并显示更新失败，恢复后再更新", async (t) => {
  const f = setup(t); await f.service.tick();
  f.setTime("2026-10-22T01:00Z");
  const original = f.whoop.sync;
  f.whoop.sync = async () => { throw new Error("offline"); };
  const retained = await f.service.generate();
  assert.equal(retained.revision, 1);
  assert.equal(f.service.status().job.state, "waiting");
  f.whoop.sync = original; f.setTime("2026-10-22T01:05Z"); await f.service.tick();
  assert.equal(f.store.plan("2026-10-22", prefs.timeZone).revision, 2);
});
test("同步失败的等待报告不含训练剂量，并发请求只拉取一次", async (t) => {
  const f = setup(t); let calls = 0;
  f.whoop.sync = async () => { calls++; await Promise.resolve(); throw new Error("offline"); };
  const [first, second] = await Promise.all([f.service.generate(), f.service.generate()]);
  assert.equal(calls, 1);
  assert.equal(first.revision, second.revision);
  assert.equal(first.publication.state, "waiting");
  assert.equal(first.exercise.minutes, null);
});
test("等待和预览输入未变时不重复存版本；休眠后只补当天", async (t) => {
  const f = setup(t); f.data().latest.recoveryState = "PENDING_SCORE";
  await f.service.tick(); f.setTime("2026-10-21T23:05Z"); await f.service.tick();
  assert.equal(f.calls(), 2);
  assert.equal(f.store.plan("2026-10-22", prefs.timeZone).revision, 1);
  f.data().latest.recoveryState = "SCORED";
  f.setTime("2026-10-22T02:00Z"); await f.service.tick();
  assert.equal(f.store.plan("2026-10-22", prefs.timeZone).slot.catchUp, true);
});
test("没有数据和授权时等待；存储失败延迟重试", async (t) => {
  const f = setup(t); f.store.db.prepare("DELETE FROM records").run(); f.store.remove("tokens");
  await f.service.tick(); assert.equal(f.store.plans(prefs.timeZone).length, 0);
  f.store.set("tokens", { fake: true });
  const original = f.store.savePlan.bind(f.store); let attempts = 0;
  f.store.savePlan = () => { attempts++; throw new Error("temporary"); };
  await f.service.tick(); await f.service.tick(); assert.equal(attempts, 1);
  f.store.savePlan = original; f.setTime("2026-10-21T23:06Z"); await f.service.tick();
  assert.equal(f.store.plans(prefs.timeZone).length, 1);
});
test("图表仍保留缺失值和两周对照，不将训练负荷相加", () => {
  const data = snapshot({ checkins: [{ date: "2026-10-22", weight: 75, energy: 4, soreness: 2 }] });
  data.days.at(-2).recovery = null; data.days.at(-3).calibrating = true;
  const result = buildInsights(data, 7);
  assert.equal(result.days.length, 7); assert.equal(result.days.at(-2).recovery, null);
  assert.equal(result.days.at(-3).recovery, null); assert.equal(result.days.at(-1).weight, 75);
  assert.equal(result.comparisons[0].previousCount, 7);
  assert.equal(result.sleepRecovery.length, 5);
  assert.ok(result.weeks.every((w) => !Object.hasOwn(w, "strain")));
});
