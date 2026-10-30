/**
 * [INPUT]: 依赖按生理日期关联的快照、训练与手动记录。
 * [OUTPUT]: 导出图表序列、日历周汇总和近两周对照。
 * [POS]: server 的可视化分析层；保留空值，不推断未记录的运动或食量。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { mean, isNumber } from "./analytics.mjs";
import { addDays } from "./calendar.mjs";

const round = (n) => isNumber(n) ? Math.round(n * 100) / 100 : null;
function localHour(timestamp, offset) {
  if (!timestamp) return null;
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset || "");
  const shift = match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
  const date = new Date(Date.parse(timestamp) + shift * 60000);
  return Number.isFinite(date.getTime()) ? round(date.getUTCHours() + date.getUTCMinutes() / 60) : null;
}
const monday = (date) => addDays(date, -((new Date(`${date}T12:00Z`).getUTCDay() + 6) % 7));

export function buildInsights(snapshot, range = snapshot.days.length) {
  const checkins = new Map(snapshot.checkins.map((c) => [c.date, c]));
  const allDays = snapshot.days.map((d, index, rows) => {
    const checkin = checkins.get(d.date);
    const bedtime = localHour(d.sleepStart, d.timezoneOffset);
    const wake = localHour(d.sleepEnd, d.timezoneOffset);
    const recent = rows.slice(Math.max(0, index - 6), index + 1)
      .filter((r) => !r.calibrating).map((r) => r.recovery).filter(isNumber);
    return { ...d, recovery: d.calibrating ? null : d.recovery,
      recoveryAverage: recent.length >= 4 ? round(mean(recent)) : null,
      bedtime: bedtime === null ? null : bedtime < 12 ? bedtime + 24 : bedtime,
      wakeHour: wake === null ? null : wake < 12 ? wake + 24 : wake,
      weight: checkin?.weight ?? null, energy: checkin?.energy ?? null, soreness: checkin?.soreness ?? null,
    };
  });
  const days = allDays.slice(-range);
  const weeks = new Map();
  for (const d of days) {
    const date = monday(d.date);
    if (!weeks.has(date)) weeks.set(date, { date, minutes: 0, count: 0, coveredDays: 0, unknownDuration: 0 });
    weeks.get(date).coveredDays++;
  }
  for (const w of snapshot.workouts.filter((w) => w.date >= days[0].date && w.date <= snapshot.today)) {
    const week = weeks.get(monday(w.date));
    if (!week) continue;
    week.count++;
    if (isNumber(w.minutes)) week.minutes += w.minutes;
    else week.unknownDuration++;
  }
  const comparisons = ["recovery", "hrv", "rhr", "sleepHours", "strain"].map((key) => {
    const values = (rows) => rows.filter((d) => !["recovery", "hrv", "rhr"].includes(key) || !d.calibrating).map((d) => d[key]).filter(isNumber);
    const current = values(allDays.slice(-7));
    const previous = values(allDays.slice(-14, -7));
    const currentMean = round(mean(current)), previousMean = round(mean(previous));
    return { key, current: currentMean, previous: previousMean, currentCount: current.length, previousCount: previous.length,
      delta: current.length >= 4 && previous.length >= 4 ? round(currentMean - previousMean) : null };
  });
  return { days, weeks: [...weeks.values()].map((w) => ({ ...w, minutes: round(w.minutes) })), comparisons,
    sleepRecovery: days.filter((d) => isNumber(d.sleepHours) && isNumber(d.recovery) && !d.calibrating)
      .map((d) => ({ date: d.date, sleepHours: d.sleepHours, recovery: d.recovery })) };
}
