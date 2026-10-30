/**
 * [INPUT]: 依赖 Store、WHOOP 同步、快照工厂和上海日历。
 * [OUTPUT]: 导出 ReportService；晨间预览、同步后发布和失败重试。
 * [POS]: server 的发布边界；今日评分和本次同步均成功后才发布训练。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createHash } from "node:crypto";
import {
  addDays, clockMinutes, clockText, dueSlot, localClock, preparationSlot,
  reportPreferences, REPORT_RETRY_MS, PREPARATION_MINUTES,
} from "./calendar.mjs";
import { buildPlan } from "./planner.mjs";

export class ReportService {
  constructor(store, whoop, snapshot, clock = () => new Date()) {
    this.store = store;
    this.whoop = whoop;
    this.snapshot = snapshot;
    this.clock = clock;
    this.running = null;
  }
  preferences() { return reportPreferences(this.store.get("settings", {})); }

  async generate({ now = this.clock(), trigger = "manual", slot = null } = {}) {
    if (this.running) return this.running;
    this.running = this.create({ now, trigger, slot }).finally(() => { this.running = null; });
    return this.running;
  }

  async create({ now, trigger, slot }) {
    const settings = this.store.get("settings", {});
    const preferences = reportPreferences(settings);
    const targetDate = slot?.targetDate || localClock(now, preferences.timeZone).date;
    const startedAt = this.clock().toISOString();
    let refresh = { succeeded: false, startedAt, finishedAt: null, reason: "disconnected" };
    // ---- 每次发布都等待同步完成；旧同步时间不能充当本次凭据 ----
    if (this.store.get("tokens")) {
      try {
        const sync = await this.whoop.sync(14);
        refresh = { succeeded: true, startedAt: sync?.startedAt || startedAt,
          finishedAt: sync?.finishedAt || this.clock().toISOString(), reason: null };
      } catch {
        refresh.reason = "sync-failed";
      }
    }
    const actualNow = this.clock();
    const snapshot = this.snapshot(false, 90, { now: actualNow, calendarDate: targetDate });
    const report = buildPlan(snapshot, {
      targetDate, now: actualNow, settings, refresh,
      sync: this.store.get("sync"), trigger, slot,
    });
    const inputFingerprint = createHash("sha256").update(JSON.stringify({
      targetDate, trigger, preferences, goal: snapshot.goal, experience: snapshot.experience,
      constraints: snapshot.constraints, days: snapshot.days, checkin: snapshot.checkin,
      baseline: snapshot.baseline, weekly: snapshot.weekly, publication: report.publication.state,
      reason: report.publication.reason,
    })).digest("hex");
    const previous = this.store.plan(targetDate, preferences.timeZone);
    // ---- 相同的等待或预览不反复追加修订；正式更新始终保留一次 ----
    const unchanged = trigger !== "manual" && report.publication.state !== "published" &&
      previous?.inputFingerprint === inputFingerprint;
    const keepPublished = report.publication.state === "waiting" && previous?.publication?.state === "published";
    const saved = unchanged || keepPublished ? previous : this.store.savePlan({ ...report, inputFingerprint });
    const waiting = report.publication.state === "waiting";
    this.store.set("reportJob", {
      updatedAt: actualNow.toISOString(), finishedAt: saved.generatedAt,
      targetDate, timeZone: preferences.timeZone, trigger,
      state: report.publication.state, error: waiting ? report.publication.message : null,
      retryAt: waiting || trigger === "preview" ? new Date(actualNow.getTime() + REPORT_RETRY_MS).toISOString() : null,
      refresh,
    });
    return saved;
  }

  async tick(now = this.clock()) {
    if (this.running) return;
    const preferences = this.preferences();
    const today = localClock(now, preferences.timeZone).date;
    const preview = preparationSlot(now, preferences);
    const slot = preview || dueSlot(now, preferences);
    const trigger = preview ? "preview" : "scheduled";
    const job = this.store.get("reportJob");
    // ---- 晨间日程只补当天，不在凌晨补发昨天的训练 ----
    if (!preview && slot.targetDate !== today) return;
    const retryUpdate = job?.state === "waiting" && job.targetDate === slot.targetDate && job.timeZone === slot.timeZone;
    if (!preview && this.store.hasScheduledPlan(slot.targetDate, slot.timeZone) && !retryUpdate) return;
    if (!this.store.records("cycles").length && !this.store.get("tokens")) return;
    const sameJob = job?.targetDate === slot.targetDate && job.timeZone === slot.timeZone &&
      (job.trigger === trigger || (!preview && job.trigger === "manual"));
    if (sameJob && job.retryAt && now < new Date(job.retryAt)) return;
    try { return await this.generate({ now, trigger, slot }); }
    catch {
      this.store.set("reportJob", { updatedAt: now.toISOString(), targetDate: slot.targetDate,
        timeZone: slot.timeZone, trigger, state: "waiting", error: "今日安排保存失败，将在 5 分钟后重试。",
        retryAt: new Date(now.getTime() + REPORT_RETRY_MS).toISOString() });
    }
  }

  status(now = this.clock()) {
    const p = this.preferences();
    const local = localClock(now, p.timeZone);
    const nextDate = local.time < p.reportTime ? local.date : addDays(local.date, 1);
    return { ...p, today: local.date, nextDate, period: "today",
      preparationTime: clockText(clockMinutes(p.reportTime) - PREPARATION_MINUTES),
      retryMinutes: REPORT_RETRY_MS / 60000,
      job: this.store.get("reportJob"), generating: Boolean(this.running),
      latestGeneratedAt: this.store.latestPlanTime(),
      timing: "提前一小时准备，发布前同步 WHOOP；评分未到或同步失败时每 5 分钟重试。休眠后补当天安排。" };
  }
}
