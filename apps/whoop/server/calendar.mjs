/**
 * [INPUT]: 依赖 Intl 的 IANA 时区规则与明确的时钟。
 * [OUTPUT]: 导出报告偏好、预览时段和当地到期日期。
 * [POS]: server 的日历边界；用当地日期计算日程，避免夏令时漂移。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export const DEFAULT_TIME_ZONE = "Asia/Shanghai";
export const REPORT_RETRY_MS = 5 * 60000;
export const PREPARATION_MINUTES = 60;
export const clockMinutes = (clock) => {
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 60 + minute;
};
export const clockText = (minutes) => {
  const n = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
};
export const addDays = (date, days) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

export function localClock(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function reportPreferences(settings = {}) {
  return {
    reportTime: settings.reportTime || "07:00",
    timeZone: settings.timeZone || DEFAULT_TIME_ZONE,
    wakeTime: settings.wakeTime || "06:30",
    age: settings.age ?? null,
    diet: settings.diet || "不限",
    foodRestrictions: settings.foodRestrictions || "",
  };
}

export function dueSlot(now, preferences) {
  const local = localClock(now, preferences.timeZone);
  const reached = local.time >= preferences.reportTime;
  const scheduledDate = reached ? local.date : addDays(local.date, -1);
  return {
    scheduledDate,
    targetDate: scheduledDate,
    scheduledTime: preferences.reportTime,
    timeZone: preferences.timeZone,
    catchUp: !reached || clockMinutes(local.time) - clockMinutes(preferences.reportTime) > 2,
  };
}

export function preparationSlot(now, preferences) {
  const local = localClock(now, preferences.timeZone);
  const minutes = (clockMinutes(preferences.reportTime) - clockMinutes(local.time) + 1440) % 1440;
  if (minutes === 0 || minutes > PREPARATION_MINUTES) return null;
  const scheduledDate = local.time < preferences.reportTime ? local.date : addDays(local.date, 1);
  return { scheduledDate, targetDate: scheduledDate, scheduledTime: preferences.reportTime,
    timeZone: preferences.timeZone, catchUp: false };
}
