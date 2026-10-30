/**
 * [INPUT]: 依赖 WHOOP v2 集合、每日记录和可选报告日期。
 * [OUTPUT]: 导出 buildSnapshot、dateAt、mean；输出日期序列与个人基线。
 * [POS]: server 的纯分析层；按生理关联键连接数据，不依赖 HTTP 或数据库。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const DAY = 86400000;
const HOUR = 3600000;
export const isNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);
export const mean = (values) => {
  const valid = values.filter(isNumber);
  return valid.length
    ? valid.reduce((sum, n) => sum + n, 0) / valid.length
    : null;
};
const round = (n) => (isNumber(n) ? Math.round(n * 100) / 100 : null);
const value = (score, key) => (isNumber(score?.[key]) ? score[key] : null);
const scoreOf = (record) =>
  record?.score_state === "SCORED" ? record.score : null;

export function dateAt(timestamp, offset = "Z") {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return null;
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  const shift = match
    ? (match[1] === "-" ? -1 : 1) *
      (Number(match[2]) * 60 + Number(match[3])) *
      60000
    : 0;
  return new Date(Date.parse(timestamp) + shift).toISOString().slice(0, 10);
}
const minusDays = (date, count) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - count * DAY)
    .toISOString()
    .slice(0, 10);
const byTime = (list) =>
  [...list].sort(
    (a, b) =>
      Date.parse(a.start || a.created_at) - Date.parse(b.start || b.created_at),
  );

function sleepMetrics(record) {
  const score = scoreOf(record);
  const stages = score?.stage_summary;
  const hours = (key) =>
    round(value(stages, key) === null ? null : stages[key] / HOUR);
  const stageValues = [
    "total_light_sleep_time_milli",
    "total_slow_wave_sleep_time_milli",
    "total_rem_sleep_time_milli",
  ].map((k) => value(stages, k));
  const needed = score?.sleep_needed;
  const needKeys = [
    "baseline_milli",
    "need_from_sleep_debt_milli",
    "need_from_recent_strain_milli",
    "need_from_recent_nap_milli",
  ];
  const needValues = needKeys.map((k) => value(needed, k));
  return {
    sleepHours: stageValues.every(isNumber)
      ? round(stageValues.reduce((a, b) => a + b, 0) / HOUR)
      : null,
    sleepPerformance: value(score, "sleep_performance_percentage"),
    sleepEfficiency: value(score, "sleep_efficiency_percentage"),
    sleepConsistency: value(score, "sleep_consistency_percentage"),
    sleepNeeded: needValues.every(isNumber)
      ? round(needValues.reduce((a, b) => a + b, 0) / HOUR)
      : null,
    respiratoryRate: value(score, "respiratory_rate"),
    stages: {
      light: hours("total_light_sleep_time_milli"),
      deep: hours("total_slow_wave_sleep_time_milli"),
      rem: hours("total_rem_sleep_time_milli"),
      awake: hours("total_awake_time_milli"),
      noData: hours("total_no_data_time_milli"),
    },
    sleepStart: record?.start || null,
    sleepEnd: record?.end || null,
    sleepState: record?.score_state || null,
  };
}

function physiologicalRows(dataset) {
  const cycles = new Map(dataset.cycles.map((c) => [String(c.id), c]));
  const recoveries = new Map(
    dataset.recoveries.map((r) => [String(r.cycle_id), r]),
  );
  const sleeps = new Map(dataset.sleeps.map((s) => [String(s.id), s]));
  const mainSleeps = new Map(
    byTime(dataset.sleeps.filter((s) => !s.nap)).map((s) => [
      String(s.cycle_id),
      s,
    ]),
  );
  const ids = new Set([
    ...cycles.keys(),
    ...recoveries.keys(),
    ...mainSleeps.keys(),
  ]);
  const rows = [];
  for (const id of ids) {
    const cycle = cycles.get(id);
    const recovery = recoveries.get(id);
    const sleep = recovery
      ? sleeps.get(String(recovery.sleep_id))
      : mainSleeps.get(id);
    const offset = sleep?.timezone_offset || cycle?.timezone_offset || "Z";
    const timestamp = sleep?.end || cycle?.start;
    const date = dateAt(timestamp, offset);
    if (!date) continue;
    const r = scoreOf(recovery);
    const c = scoreOf(cycle);
    const calibrating = r?.user_calibrating === true;
    rows.push({
      date,
      timestamp,
      cycleId: id,
      timezoneOffset: offset,
      recovery: value(r, "recovery_score"),
      hrv: value(r, "hrv_rmssd_milli"),
      rhr: value(r, "resting_heart_rate"),
      spo2: value(r, "spo2_percentage"),
      skinTemp: value(r, "skin_temp_celsius"),
      calibrating,
      recoveryState: recovery?.score_state || null,
      strain: value(c, "strain"),
      calories: round(
        value(c, "kilojoule") === null ? null : c.kilojoule / 4.184,
      ),
      averageHR: value(c, "average_heart_rate"),
      maxHR: value(c, "max_heart_rate"),
      steps: isNumber(cycle?.step_count) ? cycle.step_count : null,
      cycleOpen: Boolean(cycle && !cycle.end),
      ...sleepMetrics(sleep),
    });
  }
  return rows.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function workoutRows(records) {
  return byTime(records)
    .reverse()
    .map((w) => {
      const s = scoreOf(w);
      const duration = (Date.parse(w.end) - Date.parse(w.start)) / 60000;
      return {
        id: w.id,
        date: dateAt(w.start, w.timezone_offset),
        start: w.start,
        end: w.end,
        sport: w.sport_name || `运动 #${w.sport_id ?? "未知"}`,
        minutes:
          Number.isFinite(duration) && duration >= 0 ? round(duration) : null,
        strain: value(s, "strain"),
        averageHR: value(s, "average_heart_rate"),
        maxHR: value(s, "max_heart_rate"),
        calories: round(
          value(s, "kilojoule") === null ? null : s.kilojoule / 4.184,
        ),
        recorded: value(s, "percent_recorded"),
        zones: s?.zone_durations || null,
        scoreState: w.score_state,
      };
    });
}

export function buildSnapshot(
  dataset,
  {
    now = new Date(),
    range = 30,
    checkins = [],
    settings = {},
    body = null,
    calendarDate = null,
  } = {},
) {
  const rows = physiologicalRows(dataset);
  const offset = rows.at(-1)?.timezoneOffset || "Z";
  const today = calendarDate || dateAt(now.toISOString(), offset);
  const daily = new Map(rows.map((row) => [row.date, row]));
  const days = Array.from({ length: range }, (_, i) => {
    const date = minusDays(today, range - i - 1);
    return (
      daily.get(date) || {
        date,
        recovery: null,
        hrv: null,
        rhr: null,
        strain: null,
        sleepHours: null,
        sleepPerformance: null,
        stages: null,
      }
    );
  });
  const latest = daily.get(today) || days.at(-1);
  const prior = [...daily.values()].filter(
    (d) => d.date < today && d.date >= minusDays(today, 28),
  );
  const validRecovery = (row) =>
    row.recoveryState === "SCORED" && !row.calibrating;
  const baseline = {};
  for (const key of [
    "recovery",
    "hrv",
    "rhr",
    "sleepHours",
    "strain",
    "respiratoryRate",
  ]) {
    const eligible = prior.filter(
      (d) => !["recovery", "hrv", "rhr"].includes(key) || validRecovery(d),
    );
    const vals = eligible.map((d) => d[key]).filter(isNumber);
    baseline[key] = { value: round(mean(vals)), count: vals.length };
  }
  const last7 = [...daily.values()].filter(
    (d) => d.date >= minusDays(today, 6) && d.date <= today,
  );
  const averages = Object.fromEntries(
    ["recovery", "hrv", "rhr", "sleepHours", "strain"].map((key) => {
      const vals = last7
        .filter(
          (d) => !["recovery", "hrv", "rhr"].includes(key) || validRecovery(d),
        )
        .map((d) => d[key])
        .filter(isNumber);
      return [key, { value: round(mean(vals)), count: vals.length }];
    }),
  );
  const workouts = workoutRows(dataset.workouts);
  const recentWorkouts = workouts.filter(
    (w) => w.date >= minusDays(today, 6) && w.date <= today,
  );
  const lastRecovery = rows.filter((r) => isNumber(r.recovery)).at(-1);
  return {
    today,
    timezoneOffset: offset,
    days,
    latest,
    baseline,
    averages,
    workouts,
    body,
    checkin: checkins.find((c) => c.date === today) || null,
    checkins: checkins.filter((c) => c.date <= today),
    goal: settings.goal || "提升体能与恢复",
    experience: settings.experience || "初学 / 重新开始",
    constraints: settings.constraints || "",
    coverage: {
      recoveryDays: last7.filter((d) => isNumber(d.recovery) && !d.calibrating)
        .length,
      lastRecoveryDate: lastRecovery?.date || null,
      baselineDays: baseline.hrv.count,
      totalCycles: dataset.cycles.length,
    },
    weekly: {
      workouts: recentWorkouts.length,
      recordedMinutes: round(
        recentWorkouts.reduce((n, w) => n + (w.minutes || 0), 0),
      ),
      activeDays: new Set(recentWorkouts.map((w) => w.date)).size,
    },
  };
}
