/**
 * [INPUT]: 依赖日指标、参考基线和共享解读载荷。
 * [OUTPUT]: 导出趋势图、迷你趋势图与恢复环 SVG 字符串。
 * [POS]: public 的基础图表层；空值断线，按日期提供整列解读命中区域。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { escapeHtml } from "./html.js";
import { dayHelp, helpAttrs, helpLayer } from "./chart-help.js";
export { escapeHtml } from "./html.js";
const valid = (n) => typeof n === "number" && Number.isFinite(n);
export const METRICS = {
  recovery: { name: "恢复评分", unit: "%", color: "#6E8C74", min: 0, max: 100 },
  hrv: { name: "HRV", unit: "ms", color: "#4F8682" },
  rhr: { name: "静息心率", unit: "bpm", color: "#A07163" },
  sleepHours: {
    name: "实际睡眠",
    unit: "h",
    color: "#8B7393",
    min: 0,
    max: 12,
  },
  strain: { name: "日负荷", unit: "/21", color: "#5F7391", min: 0, max: 21 },
};

export function ring(value, label = "恢复评分", meta = {}) {
  const help = dayHelp({ date: meta.date, recovery: value, calibrating: meta.calibrating }, ["recovery"], { recovery: meta.baseline }, meta.date, { title: label });
  const ready = valid(value);
  const score = ready ? Math.max(0, Math.min(100, value)) : 0;
  const color = !ready
    ? "var(--chip)"
    : score < 34
      ? "var(--bad)"
      : score < 67
        ? "var(--warn)"
        : "var(--good)";
  return `<svg class="recovery-ring" viewBox="0 0 100 100" ${helpAttrs(help, { label: `${label} ${ready ? Math.round(score) + "%" : "暂无数据"}，查看解读` })}><circle cx="50" cy="50" r="41" fill="none" style="stroke:var(--chip)" stroke-width="9"/><circle cx="50" cy="50" r="41" fill="none" style="stroke:${color}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${score * 2.576} 257.6" transform="rotate(-90 50 50)"/><text x="50" y="52" text-anchor="middle" class="ring-number">${ready ? Math.round(score) : "—"}</text><text x="50" y="68" text-anchor="middle" class="ring-label">${ready ? "RECOVERY" : "等待同步"}</text></svg>`;
}

function segments(days, key, x, y) {
  const groups = [];
  let group = [];
  days.forEach((d, i) => {
    if (valid(d[key])) group.push([x(i), y(d[key]), d]);
    else if (group.length) {
      groups.push(group);
      group = [];
    }
  });
  if (group.length) groups.push(group);
  return groups;
}

export function sparkline(days, key, color, baseline) {
  const numbers = days.map((d) => d[key]).filter(valid);
  if (!numbers.length)
    return '<div class="spark-empty" aria-hidden="true"></div>';
  const min = Math.min(...numbers) - 2;
  const max = Math.max(...numbers) + 2;
  const x = (i) => 3 + (i / Math.max(1, days.length - 1)) * 94;
  const y = (n) => 30 - ((n - min) / (max - min || 1)) * 25;
  return `<svg class="sparkline" viewBox="0 0 100 36" data-inspect-chart role="group" aria-label="近 ${days.length} 天${METRICS[key].name}；方向键切换日期">${segments(
    days,
    key,
    x,
    y,
  )
    .map(
      (g) =>
        `<polyline points="${g.map((p) => `${p[0]},${p[1]}`).join(" ")}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("")}${helpLayer(days.map((d) => dayHelp(d, [key], { [key]: baseline }, days.at(-1).date)), { x, left: 0, right: 100, top: 0, bottom: 36 })}</svg>`;
}

let chartId = 0;
export function trendChart(days, key, baseline) {
  const metric = METRICS[key];
  const fillId = `trend-fill-${++chartId}`;
  const values = days.map((d) => d[key]).filter(valid);
  const w = 760,
    h = 272,
    left = 42,
    right = 24,
    top = 24,
    bottom = 36;
  let min =
    metric.min ??
    Math.floor((Math.min(...values, baseline?.value ?? Infinity) * 0.8) / 5) *
      5;
  let max =
    metric.max ??
    Math.ceil((Math.max(...values, baseline?.value ?? 0) * 1.18) / 5) * 5;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    min = 0;
    max = 100;
  }
  const x = (i) =>
    left + (i / Math.max(1, days.length - 1)) * (w - left - right);
  const y = (n) => top + ((max - n) / (max - min)) * (h - top - bottom);
  const groups = segments(days, key, x, y);
  const ticks = Array.from(
    { length: 5 },
    (_, i) => min + ((max - min) / 4) * i,
  );
  const labels = [
    ...new Set([
      0,
      Math.floor((days.length - 1) / 4),
      Math.floor((days.length - 1) / 2),
      Math.floor(((days.length - 1) * 3) / 4),
      days.length - 1,
    ]),
  ];
  const path = (g) =>
    g
      .map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)},${p[1].toFixed(2)}`)
      .join(" ");
  return `<div class="chart-wrap"><svg class="trend-chart" viewBox="0 0 ${w} ${h}" data-inspect-chart role="group" aria-label="最近 ${days.length} 天${metric.name}；可悬停解读，方向键切换日期"><defs><linearGradient id="${fillId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${metric.color}" stop-opacity="0.19"/><stop offset="100%" stop-color="${metric.color}" stop-opacity="0.01"/></linearGradient></defs>
    ${ticks.map((n) => `<line x1="${left}" y1="${y(n)}" x2="${w - right}" y2="${y(n)}" style="stroke:var(--line)" stroke-dasharray="3 5"/><text x="${left - 12}" y="${y(n) + 4}" text-anchor="end" class="axis-text">${Number(n.toFixed(1))}</text>`).join("")}
    ${baseline?.count >= 14 && valid(baseline.value) ? `<line x1="${left}" x2="${w - right}" y1="${y(baseline.value)}" y2="${y(baseline.value)}" style="stroke:var(--faint)" stroke-dasharray="5 5"/>` : ""}
    ${groups.map((g) => `<path d="${path(g)} L${g.at(-1)[0]},${h - bottom} L${g[0][0]},${h - bottom} Z" fill="url(#${fillId})"/><path d="${path(g)}" fill="none" stroke="${metric.color}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`).join("")}
    ${days.map((d, i) => (valid(d[key]) ? `<circle class="chart-point" cx="${x(i)}" cy="${y(d[key])}" r="${days.length > 30 ? 2.5 : 3.5}" fill="white" stroke="${metric.color}" stroke-width="2" data-plot-index="${i}" aria-hidden="true"></circle>` : "")).join("")}
    ${labels.map((i) => `<text x="${x(i)}" y="${h - 10}" text-anchor="middle" class="axis-text">${days[i].date.slice(5).replace("-", "/")}</text>`).join("")}
    ${!values.length ? `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" class="chart-empty-label">连接 WHOOP 后查看你的变化</text>` : ""}
    ${helpLayer(days.map((d) => dayHelp(d, [key], { [key]: baseline }, days.at(-1).date)), { x, left, right: w - right, top, bottom: h - bottom })}
    </svg></div>`;
}
