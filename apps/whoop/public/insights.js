/**
 * [INPUT]: 依赖服务端序列、趋势图和共享解读层。
 * [OUTPUT]: 导出趋势看板；绘制睡眠、负荷、体征和自述图表。
 * [POS]: public 的分析视图；每种图形都提供按日期的数值解读。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { escapeHtml as esc, METRICS, trendChart } from "./charts.js";
import { dayHelp, helpAttrs, helpLayer, helpButton, formatReading } from "./chart-help.js";
const valid = (n) => typeof n === "number" && Number.isFinite(n);
const num = (n, digits = 1) => valid(n) ? Number(n.toFixed(digits)) : "—";
const dateLabel = (date) => date.slice(5).replace("-", "/");
const colors = { recovery: "#6E8C74", average: "#9A8F84", sleep: "#8B7393", need: "#A68A5B", light: "#C7BDD3", deep: "#6E5F80", rem: "#9C89AE", awake: "#D8C9A6", noData: "#C6C6C0" };
const legend = (items) => `<div class="insight-legend">${items.map(([name, color]) => `<span><i style="background:${color}"></i>${esc(name)}</span>`).join("")}</div>`;
function card(title, subtitle, chart, note = "", extra = "") {
  return `<article class="panel insight-card ${extra}"><div class="panel-head"><div><h3>${title}${helpButton({ title, notes: [subtitle, note].filter(Boolean) })}</h3><p class="panel-subtitle">${subtitle}</p></div></div>${chart}${note ? `<p class="insight-note">${note}</p>` : ""}</article>`;
}
function frame(label, content) {
  return `<svg class="insight-svg" viewBox="0 0 560 230" data-inspect-chart role="group" aria-label="${esc(label)}">${content}</svg>`;
}
function axes(days, min, max, format = (n) => num(n)) {
  const x = (i) => 48 + i / Math.max(1, days.length - 1) * 494;
  const y = (n) => 18 + (max - n) / (max - min || 1) * 176;
  const ticks = Array.from({ length: 5 }, (_, i) => min + (max - min) * i / 4);
  const indices = [...new Set([0, Math.floor((days.length - 1) / 2), days.length - 1])];
  return { x, y, grid: ticks.map((n) => `<line x1="48" x2="542" y1="${y(n)}" y2="${y(n)}" style="stroke:var(--line)" stroke-dasharray="3 5"/><text x="39" y="${y(n) + 4}" class="axis-text" text-anchor="end">${format(n)}</text>`).join("") + indices.map((i) => `<text x="${x(i)}" y="217" class="axis-text" text-anchor="middle">${dateLabel(days[i].date)}</text>`).join("") };
}
function seriesChart(days, series, { min, max, unit = "", tickFormat, baselines = {} } = {}) {
  const vals = days.flatMap((d) => series.map((s) => d[s.key])).filter(valid);
  if (!vals.length) return `<div class="insight-empty">尚无有效记录<br><small>缺失值保留为空，不补成零。</small></div>`;
  const low = Math.min(...vals), high = Math.max(...vals);
  const pad = Math.max((high - low) * .15, .5);
  const bounds = axes(days, min ?? Math.max(0, low - pad), max ?? high + pad, tickFormat);
  const { x, y } = bounds;
  return frame(`${series.map((s) => s.name).join("与")}，单位 ${unit}，${days.length} 天，空缺断线`, bounds.grid + series.map((s) => {
    let paths = "", segment = [];
    const flush = () => { if (segment.length) paths += `<polyline points="${segment.join(" ")}" fill="none" stroke="${s.color}" stroke-width="2.5" ${s.dash ? 'stroke-dasharray="5 4"' : ""}/>`; segment = []; };
    days.forEach((d, i) => { if (valid(d[s.key])) segment.push(`${x(i)},${y(d[s.key])}`); else flush(); }); flush();
    return paths + days.map((d, i) => valid(d[s.key]) ? `<circle cx="${x(i)}" cy="${y(d[s.key])}" r="3" fill="${s.color}" data-plot-index="${i}" aria-hidden="true"></circle>` : "").join("");
  }).join("") + helpLayer(days.map((d) => dayHelp(d, series.map((s) => s.key), baselines, days.at(-1).date)), { x, left: 48, right: 542, top: 18, bottom: 194 })) + legend(series.map((s) => [s.name, s.color]));
}
function stagesChart(days) {
  const series = [["deep", "深睡"], ["rem", "REM"], ["light", "浅睡"], ["awake", "清醒"], ["noData", "无数据"]];
  const totals = days.map((d) => d.stages && series.every(([k]) => valid(d.stages[k])) ? series.reduce((sum, [k]) => sum + d.stages[k], 0) : null);
  if (!totals.some(valid)) return '<div class="insight-empty">等待睡眠分期记录</div>';
  const { x, y, grid } = axes(days, 0, Math.max(10, ...totals.filter(valid)));
  const width = Math.min(18, 440 / days.length);
  return frame("每日睡眠分期，单位小时，缺失日期留空", grid + days.map((d, i) => {
    if (!valid(totals[i])) return "";
    let base = 0;
    return series.map(([key, name]) => {
      const n = d.stages[key], previous = base; base += n;
      return `<rect x="${x(i) - width / 2}" y="${y(base)}" width="${width}" height="${Math.max(0, y(previous) - y(base))}" fill="${colors[key]}"><title>${d.date} · ${name} ${num(n, 2)} 小时</title></rect>`;
    }).join("");
  }).join("") + helpLayer(days.map((d) => dayHelp({ date: d.date, ...d.stages }, series.map(([key]) => key), {}, null, { title: "这晚的睡眠由什么组成", notes: ["总柱高包含清醒与无数据；实际睡眠只合计浅睡、深睡和 REM。"] })), { x, left: 48, right: 542, top: 18, bottom: 194 })) + legend(series.map(([key, name]) => [name, colors[key]]));
}
const clock = (hour) => formatReading(hour, "bedtime");
function timingChart(days) {
  const { x, y, grid } = axes(days, 12, 36, (n) => `${n % 24}:00`);
  const width = Math.min(16, 440 / days.length);
  const known = days.filter((d) => valid(d.bedtime) && valid(d.wakeHour));
  if (!known.length) return '<div class="insight-empty">等待主睡眠开始与结束时间</div>';
  return frame("入睡和醒来时段，纵轴从中午跨午夜至次日中午", grid + days.map((d, i) => {
    if (!valid(d.bedtime) || !valid(d.wakeHour) || d.wakeHour < d.bedtime) return "";
    return `<rect x="${x(i) - width / 2}" y="${y(d.wakeHour)}" width="${width}" height="${Math.max(2, y(d.bedtime) - y(d.wakeHour))}" rx="2" fill="#9C89AE"><title>${d.date} 主睡眠 ${clock(d.bedtime)}–${clock(d.wakeHour)} · 原记录时区 ${esc(d.timezoneOffset)}</title></rect>`;
  }).join("") + helpLayer(days.map((d) => dayHelp(d, ["bedtime", "wakeHour"], {}, null, { title: "这晚什么时候睡、什么时候醒", notes: [`原记录时区：${d.timezoneOffset || "未知"}。时段长度包括期间的清醒时间。`] })), { x, left: 48, right: 542, top: 18, bottom: 194 }));
}
function weeklyChart(weeks) {
  const { x, y, grid } = axes(weeks, 0, Math.max(60, ...weeks.map((w) => w.minutes)));
  const width = Math.min(38, 380 / weeks.length);
  return frame("日历周已记录训练分钟数，零表示没有运动记录", grid + weeks.map((w, i) => `<rect x="${x(i) - width / 2}" y="${y(w.minutes)}" width="${width}" height="${Math.max(2, y(0) - y(w.minutes))}" rx="2" fill="#6E8C74"><title>${w.date} 起一周 · ${num(w.minutes)} 分钟 · ${w.count} 次 · 当前范围覆盖 ${w.coveredDays}/7 天${w.unknownDuration ? ` · ${w.unknownDuration} 次缺少时长` : ""}</title></rect>`).join("") + helpLayer(weeks.map((w) => dayHelp({ date: `${w.date} 起的一周`, recordedMinutes: w.minutes, workoutCount: w.count }, ["recordedMinutes", "workoutCount"], {}, null, { title: "这一周记录了多少运动", notes: [`当前范围覆盖这周 ${w.coveredDays}/7 天，首尾周可能不完整。`, w.unknownDuration ? `${w.unknownDuration} 次运动缺少时长，不计入分钟合计。` : "这里只统计已经记录的运动，不推断未记录活动或达标情况。"] })), { x, left: 48, right: 542, top: 18, bottom: 194 }));
}
function scatter(points, baselines, referenceDate) {
  if (points.length < 7) return `<div class="insight-empty">至少需要 7 对有效记录<br><small>当前 ${points.length} 对，不据此推断关系。</small></div>`;
  const minX = Math.max(0, Math.min(...points.map((p) => p.sleepHours)) - .5), maxX = Math.max(...points.map((p) => p.sleepHours)) + .5;
  const x = (n) => 48 + (n - minX) / (maxX - minX) * 494;
  const { y, grid } = axes([{ date: "0000-00-00" }], 0, 100);
  return frame(`同周期主睡眠与恢复配对，${points.length} 个样本，无因果推断`, grid.replace(/<text[^>]*y="217"[^>]*>.*?<\/text>/g, "") +
    [minX, (minX + maxX) / 2, maxX].map((n) => `<text x="${x(n)}" y="217" class="axis-text" text-anchor="middle">${num(n)} h</text>`).join("") +
    points.map((p, i) => `<circle cx="${x(p.sleepHours)}" cy="${y(p.recovery)}" r="4" fill="#6E8C74" opacity=".7" data-plot-index="${i}" aria-hidden="true"/>`).join("") +
    points.map((p, i) => `<circle class="scatter-hit" cx="${x(p.sleepHours)}" cy="${y(p.recovery)}" r="9" fill="transparent" data-point-index="${i}" ${helpAttrs(dayHelp(p, ["sleepHours", "recovery"], baselines, referenceDate, { title: "同一周期的睡眠与恢复", notes: [`图中共 ${points.length} 对有效记录；配对只展示伴随变化，不证明因果。`] }), { tabIndex: i === points.length - 1 ? 0 : -1 })}/>`).join(""));
}
function calendar(days, baseline, referenceDate) {
  return `<div class="recovery-calendar" data-inspect-chart role="group" aria-label="每日恢复日历">${days.map((d, i) => `<span class="calendar-day" data-point-index="${i}" style="background:${!valid(d.recovery) ? "var(--chip)" : d.recovery < 34 ? "color-mix(in srgb, var(--bad) 28%, transparent)" : d.recovery < 67 ? "color-mix(in srgb, var(--warn) 28%, transparent)" : "color-mix(in srgb, var(--good) 34%, transparent)"}" ${helpAttrs(dayHelp(d, ["recovery"], { recovery: baseline }, referenceDate), { tabIndex: i === days.length - 1 ? 0 : -1 })}><small>${dateLabel(d.date)}</small><b>${valid(d.recovery) ? Math.round(d.recovery) : "—"}</b></span>`).join("")}</div>${legend([["67–100%", "color-mix(in srgb, var(--good) 34%, transparent)"], ["34–66%", "color-mix(in srgb, var(--warn) 28%, transparent)"], ["0–33%", "color-mix(in srgb, var(--bad) 28%, transparent)"], ["缺失 / 校准", "var(--chip)"]])}`;
}
function group(title, subtitle, cards) {
  return `<section class="insight-section"><div class="section-heading"><h2>${title}</h2><span class="muted">${subtitle}</span></div><div class="insight-grid">${cards}</div></section>`;
}

export function insightsBoard(data) {
  const { days, weeks, comparisons, sleepRecovery } = data.insights;
  const comparison = `<div class="comparison-strip">${comparisons.slice(0, 4).map((c) => `<div ${helpAttrs({ title: `${METRICS[c.key].name} · 两周对照`, date: "最近 7 天与此前 7 天", readings: [{ key: c.key, value: c.current, aggregate: true }], notes: [`最近 7 天：${c.currentCount}/7 个有效值；此前 7 天：${c.previousCount}/7 个有效值，均值 ${formatReading(c.previous, c.key)}。`, "两边都至少有 4 个有效值才显示差值。均值用于看趋势，不代表今天的单次读数。"] })}><span>${METRICS[c.key].name} · 近 7 天</span><strong>${num(c.current)} <small>${METRICS[c.key].unit}</small></strong><small>${valid(c.delta) ? `较前 7 天 ${c.delta >= 0 ? "+" : ""}${num(c.delta)}` : "对照样本不足"} · ${c.currentCount}/7 次</small></div>`).join("")}</div>`;
  const recovery = card("恢复评分与短期趋势", "恢复 % · 实线每日值，虚线 7 天均值", seriesChart(days, [
    { key: "recovery", name: "每日恢复", color: colors.recovery }, { key: "recoveryAverage", name: "7 天均值", color: colors.average, dash: true },
  ], { min: 0, max: 100, unit: "%", baselines: data.baseline }), "7 天内至少 4 个有效值才绘制均值；校准值留空。");
  const core = ["hrv", "rhr"].map((key) => card(`${METRICS[key].name}趋势`, `${METRICS[key].unit} · 与个人基线比较`, trendChart(days, key, data.baseline[key]), `虚线为今日之前 28 天均值，基线样本 ${data.baseline[key].count} 次。`)).join("");
  const sleep = card("实际睡眠与估算需求", "小时 · 区分实睡与 WHOOP 估算", seriesChart(days, [
    { key: "sleepHours", name: "实际睡眠", color: colors.sleep }, { key: "sleepNeeded", name: "估算需求", color: colors.need, dash: true },
  ], { min: 0, unit: "h", baselines: data.baseline }), "实际睡眠只含浅睡、深睡和 REM；估算需求不等于医学处方。");
  const vital = [
    ["respiratoryRate", "睡眠呼吸频率", "次/分", "#5F7391"],
    ["spo2", "设备血氧估算", "%", "#6E8C74"],
    ["skinTemp", "夜间皮肤温度", "°C", "#A68A5B"],
  ].map(([key, title, unit, color]) => card(title, `${unit} · ${days.filter((d) => valid(d[key])).length} 个有效值`, seriesChart(days, [{ key, name: title, color }], { unit, baselines: data.baseline, ...(key === "spo2" ? { max: 100 } : {}) }), key === "skinTemp" ? "皮肤温度不等于核心体温；读数受佩戴与环境影响。" : "查看个人变化，不凭设备单次读数诊断疾病；纵轴按数据范围缩放。")).join("");
  return comparison + group("恢复与睡眠", `最近 ${days.length} 天 · 移到图中查看解读`, recovery + core + sleep +
    card("睡眠分期组成", "小时 · 含清醒与无数据时间", stagesChart(days), "WHOOP 分期为设备估算。总柱高含清醒时段，不等于实睡。") +
    card("作息时间是否稳定", "主睡眠开始与结束 · 跨午夜纵轴", timingChart(days), "按各条 WHOOP 记录的当地时间绘制；旅行换时区会改变读数。")) +
    group("训练负荷与身体响应", "保持积累，观察负荷后的恢复", card("每日身体负荷", "WHOOP 原值 · 0–21", trendChart(days, "strain", data.baseline.strain), "日负荷不相加；当天尚未结束的值仍会变化。") +
      card("每周训练时长", "分钟 · 周一开始的日历周", weeklyChart(weeks), "只统计已记录运动；首尾周可不足 7 天。零不代表完全没有活动，也不等于未达标。") +
      card("睡眠与同周期恢复", `横轴睡眠 h · 纵轴恢复 % · ${sleepRecovery.length} 对`, scatter(sleepRecovery, data.baseline, data.today), "同周期主睡眠与晨起恢复配对。仅展示伴随变化，不证明因果。") +
      card("恢复日历", "数值与颜色共同表示每日评分", calendar(days, data.baseline.recovery, data.today), "灰色表示缺失或校准中，不当作低恢复。")) +
    group("体征与主观感受", "用多个信号看变化，避免单点判断", vital +
      card("体重记录", "kg · 来自生活记录", seriesChart(days, [{ key: "weight", name: "体重", color: "#9A8F84" }], { unit: "kg" }), "在相近时段和条件下测量；当前未推算体脂或热量缺口。") +
      card("精力与酸痛", "精力 1–5 · 酸痛 0–10", seriesChart(days, [{ key: "energy", name: "精力", color: "#6E8C74" }, { key: "soreness", name: "酸痛", color: "#A07163" }], { min: 0, max: 10, unit: "分" }), "来自每日自述，两项量表范围不同。先记录，再观察与训练的关系。"));
}
