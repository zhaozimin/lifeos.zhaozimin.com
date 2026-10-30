/**
 * [INPUT]: 依赖本机 API、图表解读、报告视图与浏览器 DOM。
 * [OUTPUT]: 渲染六个控制台页面；提交设置、记录和报告修订。
 * [POS]: public 的交互入口；服务端计算健康指标，浏览器只展示。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {
  escapeHtml as esc,
  METRICS,
  ring,
  sparkline,
  trendChart,
} from "./charts.js";
import { insightsBoard } from "./insights.js";
import { plansView, planTeaser, reportSettings } from "./plans.js";
import { dayHelp, helpAttrs, helpButton, readerHint } from "./chart-help.js";
import { installChartInspector } from "./chart-interactions.js";

const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  trend: '<path d="M3 17 9 11l4 4 8-10M15 5h6v6"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  journal:
    '<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4zM13 7a3 3 0 0 1 3-3h5v14h-4a4 4 0 0 0-4 3M7 8h3M7 12h3M16 8h2M16 12h2"/>',
  settings:
    '<path d="m9 3-1 3-3 1-2 4 2 3 1 4 4 3 4-1 3-2 3-2 1-5-3-2-1-4-4-2z"/><circle cx="12" cy="12" r="3"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM9 12l2 2 4-4"/>',
  watch:
    '<rect x="6" y="6" width="12" height="12" rx="4"/><path d="m8 6 1-4h6l1 4M8 18l1 4h6l1-4M10 12l2 2 3-4"/>',
  heart:
    '<path d="M20 5a5 5 0 0 0-8 1 5 5 0 0 0-8-1C-2 11 12 21 12 21S26 11 20 5Z"/>',
  moon: '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-7z"/>',
  refresh:
    '<path d="M20 10a8 8 0 0 0-14-5L3 8m0-5v5h5M4 14a8 8 0 0 0 14 5l3-3m0 5v-5h-5"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  leaf: '<path d="M5 19C-1 7 10 1 21 3c1 12-5 20-14 15M3 22 16 9"/>',
  link: '<path d="m10 7 3-3a5 5 0 0 1 7 7l-3 3M14 17l-3 3a5 5 0 0 1-7-7l3-3M8 16l8-8"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  flask: '<path d="M8 3h8M10 3v7L4 20h16l-6-10V3M8 14h8"/>',
  food: '<path d="M5 3v7m3-7v7M2 3v7a3 3 0 0 0 6 0M5 13v8M18 3c-4 3-4 9 0 9h2V3zM20 12v9"/>',
};
const icon = (name, extra = "") =>
  `<svg class="icon ${extra}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.activity}</svg>`;
const views = {
  overview: ["身体总览", "grid"],
  trends: ["趋势分析", "trend"],
  plans: ["每日健康建议", "leaf"],
  workouts: ["训练记录", "activity"],
  journal: ["生活记录", "journal"],
  settings: ["接入设置", "settings"],
};
const state = {
  view: views[location.hash.slice(1)] ? location.hash.slice(1) : "overview",
  demo: sessionStorage.getItem("lifeos-demo") === "yes",
  range: 30,
  metric: "recovery",
  status: null,
  data: null,
  busy: false,
  expandedWorkout: null,
  plans: [],
  planDate: null,
  planGenerating: false,
};
const app = document.getElementById("app");
const dialog = document.getElementById("journal-dialog");
const chartInspector = installChartInspector();
let toastTimer;
const number = (n, digits = 0) =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("zh-CN", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      })
    : "—";
const hoursText = (n) =>
  typeof n === "number"
    ? `${Math.floor(Math.round(n * 60) / 60)}小时${String(Math.round(n * 60) % 60).padStart(2, "0")}分`
    : "—";
const shortHours = (n) =>
  typeof n === "number"
    ? `${Math.floor(Math.round(n * 60) / 60)}<span>h</span> ${String(Math.round(n * 60) % 60).padStart(2, "0")}<span>m</span>`
    : "—";
const actionButton = (action, text, symbol, classes = "") =>
  `<button class="btn ${classes}" data-action="${action}">${symbol ? icon(symbol) : ""}${text}</button>`;
const fmtDate = (date) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
const modeQuery = () => (state.demo ? "?mode=demo" : "");

async function api(path, body) {
  const options =
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-LifeOS-CSRF": state.status?.csrf || "",
          },
          body: JSON.stringify(body),
        };
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "请求失败，请重试。");
  return result;
}
function toast(message, error = false) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = `visible${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => {
      el.className = "";
    },
    error ? 7000 : 4000,
  );
}
async function refresh(renderPage = true) {
  const [status, data, reports] = await Promise.all([
    api("/api/status"),
    api(
      `/api/dashboard?range=${state.range}&mode=${state.demo ? "demo" : "live"}`,
    ),
    api(`/api/plans?mode=${state.demo ? "demo" : "live"}`),
  ]);
  state.status = status;
  state.data = data;
  if (!state.planDate || state.planDate === state.plans[0]?.targetDate)
    state.planDate = reports.plans.find((p) => p.targetDate === status.reports.today)?.targetDate || reports.plans[0]?.targetDate || null;
  state.plans = reports.plans;
  if (renderPage) render();
}
function setView(view) {
  state.view = view;
  history.replaceState(
    null,
    "",
    `${location.pathname}${location.search}#${view}`,
  );
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function sidebar() {
  const s = state.status;
  return `<aside class="sidebar"><div class="brand"><img src="/favicon.svg" alt=""><span class="brand-name">lifeos<span style="color:var(--accent)">.</span></span></div><div class="brand-tag">YOUR HEALTH, IN FOCUS</div>
    <div class="nav-caption">个人健康空间</div><nav class="nav" aria-label="主要导航">${Object.entries(
      views,
    )
      .map(
        ([key, [label, symbol]]) =>
          `${key === "settings" ? '<div class="nav-divider"></div>' : ""}<button data-view="${key}" class="${state.view === key ? "active" : ""}" ${state.view === key ? 'aria-current="page"' : ""}>${icon(symbol)}${label}</button>`,
      )
      .join("")}</nav>
    <div class="sidebar-bottom"><div class="connection-box"><div class="device-top">${icon("watch")} WHOOP <span class="badge ${s.connected ? "" : "neutral"}" style="margin-left:auto;font-size:8px">${s.connected ? "已连接" : "未连接"}</span></div><div class="device-sub"><span class="dot ${s.connected ? "connected" : ""}"></span>${s.syncing ? "正在同步身体数据…" : s.connected ? "每 30 分钟自动同步" : "连接后开启身体趋势"}</div></div><div class="local-note">${icon("shield")} 数据保存在本机</div></div></aside>`;
}
function header() {
  const titles = {
    overview: [
      "PERSONAL HEALTH OVERVIEW",
      "身体总览",
      "看见身体的变化，找到适合自己的节奏。",
    ],
    trends: [
      "KNOW YOUR BASELINE",
      "趋势分析",
      "和过去的自己比较，让每一点进步都有依据。",
    ],
    plans: ["START YOUR DAY WITH FRESH DATA", "每日健康建议", "醒来先看最新恢复，再决定今天怎样训练。"],
    workouts: [
      "MOVE WITH INTENTION",
      "训练记录",
      "记录每一次投入，也给恢复留出位置。",
    ],
    journal: [
      "THE OTHER HALF OF YOUR DATA",
      "生活记录",
      "手环记录数值，你来补上身体的感受。",
    ],
    settings: [
      "CONNECT YOUR HEALTH",
      "接入设置",
      "连接你的 WHOOP，建立自己的身体数据空间。",
    ],
  };
  const [eyebrow, title, subtitle] = titles[state.view];
  return `<div class="topbar"><div class="breadcrumbs">个人空间 <span>/</span> <strong>${views[state.view][0]}</strong></div><div class="topbar-right"><span class="top-date" title="按 WHOOP 原记录时区计算">生理日期 · ${fmtDate(state.data.today)}</span><span class="badge ${state.demo ? "amber" : "neutral"}">${icon(state.demo ? "flask" : "shield")}${state.demo ? "演示模式" : "本机运行"}</span><span class="profile-dot" aria-label="个人健康空间">L</span></div></div>
    <header class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="heading-actions">${state.view === "settings" ? "" : `<a href="/api/export${modeQuery()}" class="btn" download>${icon("download")}导出${state.demo ? "演示" : ""}数据</a>${state.status.connected && !state.demo ? `<button class="btn" data-action="sync" ${state.status.syncing ? "disabled" : ""}>${icon("refresh", state.status.syncing ? "spin" : "")}${state.status.syncing ? "同步中" : "同步数据"}</button>` : ""}${actionButton("record", "记录今日", "plus", "primary")}`}</div></header>`;
}
function banners() {
  let result = "";
  if (state.demo)
    result += `<div class="banner">${icon("flask")}<span>正在预览演示数据。这些数值与建议不代表你的身体状态，演示不会写入真实记录。</span><button class="link-button" data-action="live">退出演示 ${icon("arrow")}</button></div>`;
  if (!state.demo && state.status.sync?.error)
    result += `<div class="banner error">${icon("info")}<span>${esc(state.status.sync.error)} 已保留上次成功同步的数据。</span><button class="link-button" data-view="settings">检查连接</button></div>`;
  if (!state.demo && state.status.syncing)
    result += `<div class="banner info">${icon("refresh", "spin")}<span>正在从 WHOOP 同步。首次会读取最近 90 天，完成后页面自动更新。</span></div>`;
  if (!state.demo && !state.status.connected && state.status.hasData)
    result += `<div class="banner">${icon("info")}<span>WHOOP 当前未连接。页面展示本机已保存的历史数据。</span><button class="link-button" data-view="settings">重新连接 ${icon("arrow")}</button></div>`;
  return result;
}
function onboarding() {
  if (state.demo || state.status.hasData) return "";
  return `<section class="panel empty-onboarding"><div class="onboarding-copy"><div class="eyebrow">从你的第一条数据开始</div><h2>让身体的变化，变得看得见。</h2><p>连接 WHOOP 后，恢复、睡眠和训练记录会汇聚到这里。所有数据保存在本机；你决定何时、向哪个 AI 提供摘要。</p>${actionButton("connect", "连接我的 WHOOP", "link", "primary")} <button class="btn ghost" data-action="demo">先看看演示 ${icon("arrow")}</button></div><div class="onboarding-steps"><div class="onboarding-step"><span class="step-number">01</span> 创建 WHOOP 开发者应用</div><div class="onboarding-step"><span class="step-number">02</span> 授权读取你的身体数据</div><div class="onboarding-step"><span class="step-number">03</span> 观察趋势，逐步调整</div></div></section>`;
}
function metricCards() {
  const { latest: d, baseline, days } = state.data;
  const relative = (key) =>
    baseline[key].count >= 14 && typeof d[key] === "number"
      ? `基线 ${number(baseline[key].value, 1)} · ${baseline[key].count} 次记录`
      : `个人基线积累中 · ${baseline[key].count}/14 次`;
  const list = [
    [
      "恢复评分",
      "heart",
      `${number(d.recovery)}<span>%</span>`,
      d.calibrating
        ? "WHOOP 校准中 · 暂不用于建议"
        : typeof d.recovery === "number"
          ? `<strong>${d.recovery >= 67 ? "恢复较好" : d.recovery >= 34 ? "适度推进" : "优先恢复"}</strong> · ${state.demo ? "演示" : "今日"}状态`
          : "等待今日有效恢复数据",
      "recovery",
      "#6E8C74",
      "metric-recovery",
    ],
    [
      "心率变异性",
      "activity",
      `${number(d.hrv)}<span>ms</span>`,
      relative("hrv"),
      "hrv",
      "#4F8682",
      "",
    ],
    [
      "实际睡眠",
      "moon",
      shortHours(d.sleepHours),
      typeof d.sleepPerformance === "number"
        ? `睡眠需求完成度 <strong>${number(d.sleepPerformance)}%</strong>`
        : "实际睡眠不包含清醒与无数据时段",
      "sleepHours",
      "#8B7393",
      "",
    ],
    [
      "静息心率",
      "heart",
      `${number(d.rhr)}<span>bpm</span>`,
      relative("rhr"),
      "rhr",
      "#A07163",
      "",
    ],
  ];
  return `<section class="metrics" aria-label="今日关键指标">${list.map(([name, symbol, val, note, key, color, cls]) => `<article class="panel metric ${cls}"><div class="metric-head">${name}${helpButton(dayHelp(d, key === "sleepHours" ? [key, "sleepPerformance"] : [key], baseline, state.data.today, { title: name }))}<span class="metric-icon">${icon(symbol)}</span></div><div class="metric-value mono" ${helpAttrs(dayHelp(d, key === "sleepHours" ? [key, "sleepPerformance"] : [key], baseline, state.data.today))}>${val}</div>${sparkline(days.slice(-14), key, color, baseline[key])}<div class="metric-foot" ${helpAttrs(dayHelp(d, key === "sleepHours" ? [key, "sleepPerformance"] : [key], baseline, state.data.today))}>${note}</div></article>`).join("")}</section>`;
}
function chartPanel(wide = false) {
  const { days, baseline } = state.data;
  const metric = METRICS[state.metric];
  return `<section class="panel chart-panel ${wide ? "wide-panel" : ""}"><div class="panel-head"><div><h2>身体趋势</h2><p class="panel-subtitle">用时间，看见身体的回答</p></div><div class="segmented" aria-label="查看时间范围">${[7, 30, 90].map((n) => `<button data-range="${n}" class="${state.range === n ? "active" : ""}" aria-pressed="${state.range === n}">${n} 天</button>`).join("")}</div></div><div class="metric-tabs" aria-label="查看指标">${Object.entries(
    METRICS,
  )
    .map(
      ([key, meta]) =>
        `<button data-metric="${key}" class="${state.metric === key ? "active" : ""}" aria-pressed="${state.metric === key}">${meta.name}</button>`,
    )
    .join(
      "",
    )}</div>${trendChart(days, state.metric, baseline[state.metric])}<div class="chart-footer"><span class="legend"><i class="legend-dot" style="background:${metric.color}"></i>${metric.name} (${metric.unit}) <span class="dash" style="margin-left:7px"></span>前 28 天均值</span><span>移到曲线看解释 · 点击固定 · 缺失日留空</span></div></section>`;
}
function readinessPanel() {
  const { guidance: g, latest, coverage } = state.data;
  return `<section class="panel readiness ${g.status === "urgent" ? "urgent-callout" : ""}"><div class="readiness-top"><h2>今日恢复方向</h2><span class="engine-label">LOCAL INSIGHTS</span></div><div class="readiness-main">${ring(latest.recovery, "恢复评分", { date: latest.date, baseline: state.data.baseline.recovery, calibrating: latest.calibrating })}<div><span class="badge ${["rest", "urgent"].includes(g.status) ? "rose" : g.status === "waiting" ? "neutral" : ""}">${g.status === "ready" ? "循序推进" : g.status === "steady" ? "保持节奏" : g.status === "rest" ? "优先恢复" : g.status === "urgent" ? "需要就医" : "等待有效数据"}</span><h3 style="margin-top:8px">${g.title}</h3></div></div><p class="guidance-summary">${g.summary}</p><div class="evidence-chips">${
    g.evidence
      .slice(0, 3)
      .map((e) => `<span title="${esc(e.text)}">${esc(e.text)}</span>`)
      .join("") || "<span>尚无足够的今日数据</span>"
  }</div><div class="readiness-link"><small>基线 ${coverage.baselineDays}/28 天 · 本机规则</small><button class="link-button" data-action="advice">查看行动建议 ${icon("arrow")}</button></div></section>`;
}
function sleepPanel() {
  const d = state.data.latest;
  const stages = d.stages;
  const entries = [
    ["deep", "深睡", "#6E5F80"],
    ["rem", "REM", "#9C89AE"],
    ["light", "浅睡", "#C7BDD3"],
    ["awake", "清醒", "#D8C9A6"],
  ];
  const total = stages
    ? Object.values(stages).reduce((n, v) => n + (v || 0), 0)
    : 0;
  return `<section class="panel"><div class="panel-head"><div><h2>昨夜睡眠</h2><p class="panel-subtitle">给身体留出自我修复的时间</p></div><span class="badge neutral" ${helpAttrs(dayHelp(d, ["sleepEfficiency"]))}>${typeof d.sleepEfficiency === "number" ? `效率 ${number(d.sleepEfficiency)}%` : "等待记录"}</span></div><div class="sleep-total"><strong class="big-number mono" ${helpAttrs(dayHelp(d, ["sleepHours", "sleepNeeded"], state.data.baseline, state.data.today))}>${shortHours(d.sleepHours)}</strong><span class="muted" ${helpAttrs(dayHelp(d, ["sleepNeeded"]))}>${typeof d.sleepNeeded === "number" ? `WHOOP 估算需求 ${hoursText(d.sleepNeeded)}` : "睡眠分期来自 WHOOP 估算"}</span></div><div class="sleep-bar" aria-label="睡眠分期">${entries.map(([key, label, color]) => (stages?.[key] > 0 ? `<span style="width:${(stages[key] / total) * 100}%;background:${color}" ${helpAttrs(dayHelp({ date: d.date, [key]: stages[key] }, [key], {}, null, { notes: ["实际睡眠只包含浅睡、深睡和 REM；清醒时段不计入。"] }))}></span>` : "")).join("")}${stages?.noData > 0 ? `<span style="width:${(stages.noData / total) * 100}%;background:var(--chip)" ${helpAttrs(dayHelp({ date: d.date, noData: stages.noData }, ["noData"]))}></span>` : ""}</div><div class="sleep-legend">${entries.map(([key, label, color]) => `<div><div class="stage-name"><i class="legend-dot" style="background:${color}"></i>${label}</div><div class="stage-value mono" ${helpAttrs(dayHelp({ date: d.date, [key]: stages?.[key] }, [key]))}>${hoursText(stages?.[key])}</div></div>`).join("")}</div></section>`;
}
function weeklyPanel() {
  const { weekly, days, workouts } = state.data;
  const recent = days.slice(-7);
  const durations = recent.map((d) =>
    workouts
      .filter((w) => w.date === d.date)
      .reduce((n, w) => n + (w.minutes || 0), 0),
  );
  const max = Math.max(60, ...durations);
  return `<section class="panel"><div class="panel-head"><div><h2>近 7 天活动</h2><p class="panel-subtitle">稳定积累，比单次突破更重要</p></div><button class="link-button" data-view="workouts">全部记录 ${icon("arrow")}</button></div><div class="weekly-number"><strong class="big-number mono">${weekly.workouts}<small>次训练</small></strong><span class="muted">共 ${number(weekly.recordedMinutes)} 分钟 · ${weekly.activeDays} 天有活动</span></div><div class="activity-bars">${recent.map((d, i) => `<div class="activity-day"><div class="activity-bar ${i === 6 ? "today" : ""}" style="height:${Math.max(3, (durations[i] / max) * 60)}px" ${helpAttrs(dayHelp({ date: d.date, recordedMinutes: durations[i], workoutCount: workouts.filter((w) => w.date === d.date).length }, ["recordedMinutes", "workoutCount"], {}, null, { title: "这一天记录了多少运动", notes: ["只统计已记录运动；时长为零不代表完全没有日常活动。", workouts.some((w) => w.date === d.date && typeof w.minutes !== "number") ? "本日有运动记录缺少时长，不能由合计为零推断没有运动。" : "所有已展示的分钟数均来自运动记录。"] }))}></div><small>${d.date.slice(5).replace("-", "/")}</small></div>`).join("")}</div><p class="weekly-note">仅统计已记录的运动时长，未推断运动强度或是否达到活动指南。</p></section>`;
}
function adviceSection() {
  const g = state.data.guidance;
  return `<section class="guidance-section" id="advice-section"><div class="section-heading"><h2>把数据变成行动</h2><span class="badge neutral">${esc(state.data.goal)}</span><span class="eyebrow">SMALL STEPS, EVERY DAY</span></div><div class="advice-grid">${g.cards.map((c) => `<article class="panel advice-card"><div class="advice-label">${icon({ training: "activity", sleep: "moon", nutrition: "food" }[c.kind])}${c.label}</div><h3>${c.title}</h3><p>${esc(c.text)}</p></article>`).join("")}</div><details><summary>建议如何生成，以及适用边界</summary><p>${g.rules}</p><p>${g.limits} 当前未启用 AI。你填写的身体限制只用于提醒，不会自动形成医学运动处方。</p></details></section>`;
}
function overview() {
  return `${onboarding()}${planTeaser(state)}${readerHint()}${metricCards()}<div class="content-grid">${chartPanel()}${readinessPanel()}</div><div class="bottom-grid">${sleepPanel()}${weeklyPanel()}</div>${adviceSection()}`;
}
function trends() {
  const d = state.data;
  return `<section class="trend-range"><div><h2>身体变化全景</h2><p class="panel-subtitle">覆盖恢复、睡眠、运动与主观感受，图表共用同一日期范围。</p></div><div class="segmented" aria-label="趋势时间范围">${[7, 30, 90].map((n) => `<button data-range="${n}" class="${state.range === n ? "active" : ""}" aria-pressed="${state.range === n}">${n} 天</button>`).join("")}</div></section>${readerHint()}${insightsBoard(d)}<div class="bottom-grid" style="margin:0 0 20px"><section class="panel"><div class="panel-head"><div><h2>你的个人基线</h2><p class="panel-subtitle">今日之前 28 天 · 至少 14 次有效值后用于趋势提示</p></div></div><div class="table-wrap"><table><thead><tr><th>指标</th><th>近 7 天均值</th><th>前 28 天均值</th><th>基线样本</th></tr></thead><tbody>${Object.entries(
    METRICS,
  )
    .map(
      ([key, m]) =>
        `<tr><td>${m.name}</td><td>${number(d.averages[key].value, 1)} ${m.unit}</td><td>${number(d.baseline[key].value, 1)} ${m.unit}</td><td>${d.baseline[key].count} 次</td></tr>`,
    )
    .join(
      "",
    )}</tbody></table></div></section><section class="panel"><h2>数据完整度</h2><p class="panel-subtitle">近 7 天有效恢复记录：${d.coverage.recoveryDays}/7 天</p><div class="coverage">${d.days
    .slice(-7)
    .map(
      (day) =>
        `<div class="coverage-cell ${typeof day.recovery === "number" && !day.calibrating ? "" : "missing"}"><small>${day.date.slice(5).replace("-", "/")}</small>${typeof day.recovery === "number" && !day.calibrating ? icon("check") : "—"}</div>`,
    )
    .join(
      "",
    )}</div><p class="inline-note">校准中和未评分的恢复不计入有效样本。HRV 受多种因素影响，单日变化不能证明疾病或训练效果。</p><p class="inline-note">最近恢复日期：${d.coverage.lastRecoveryDate || "暂无"}。日期按 WHOOP 原记录时区计算（${esc(d.timezoneOffset)}）。</p></section></div><section class="panel"><div class="panel-head"><h2>每日详细数据</h2><span class="badge neutral">最近 ${state.range} 天</span></div><div class="table-wrap"><table><thead><tr><th>日期</th><th>恢复 %</th><th>HRV ms</th><th>静息心率</th><th>睡眠 h</th><th>日负荷 /21</th><th>呼吸频率</th><th>设备血氧 %</th><th>皮温 °C</th><th>步数</th><th>消耗估算 kcal</th></tr></thead><tbody>${[
    ...d.days,
  ]
    .reverse()
    .map(
      (day) =>
        `<tr><td>${day.date}${day.calibrating ? " · 校准中" : ""}</td>${["recovery", "hrv", "rhr", "sleepHours", "strain", "respiratoryRate", "spo2", "skinTemp", "steps", "calories"].map((key, i) => `<td>${number(day[key], [1, 3, 4, 5, 6, 7].includes(i) ? 1 : 0)}</td>`).join("")}</tr>`,
    )
    .join(
      "",
    )}</tbody></table></div><p class="inline-note">日负荷采用 WHOOP 原值，不相加训练负荷。当天周期尚未结束时，消耗与步数仍会更新；皮温不等于核心体温。</p></section>`;
}
function workoutDetails(w) {
  const zones = w.zones || {};
  return `<tr class="table-detail"><td colspan="8"><div class="zones">心率区间 ${["zero", "one", "two", "three", "four", "five"].map((z, i) => `<span class="zone-item"><i class="legend-dot" style="background:${["#D5D5CF", "#B9C4B0", "#8FA584", "#6E8C74", "#A68A5B", "#A07163"][i]}"></i>Z${i} ${number(typeof zones[`zone_${z}_milli`] === "number" ? zones[`zone_${z}_milli`] / 60000 : null, 1)} 分</span>`).join("")}</div><p class="inline-note">心率数据覆盖 ${number(w.recorded, 1)}% · 评分状态 ${esc(w.scoreState || "未知")} · 设备区间不直接等于医学运动强度。</p></td></tr>`;
}
function workoutsView() {
  const d = state.data;
  const list = d.workouts.filter(
    (w) => w.date >= d.days[0].date && w.date <= d.today,
  );
  return `<div class="stats-three"><section class="panel"><span class="muted">近 7 天训练</span><div class="big-number mono">${d.weekly.workouts}<small>次</small></div><p class="panel-subtitle">按独立运动记录统计</p></section><section class="panel"><span class="muted">记录时长</span><div class="big-number mono">${number(d.weekly.recordedMinutes)}<small>分钟</small></div><p class="panel-subtitle">未估算有效强度分钟</p></section><section class="panel"><span class="muted">今日身体负荷</span><div class="big-number mono">${number(d.latest.strain, 1)}<small>/ 21</small></div><p class="panel-subtitle">${d.latest.cycleOpen ? "当前生理周期尚未结束" : "WHOOP 生理周期原值"}</p></section></div><section class="panel"><div class="panel-head"><div><h2>每一次活动，都有记录</h2><p class="panel-subtitle">点击详情查看心率区间和记录覆盖率</p></div><div class="segmented">${[7, 30, 90].map((n) => `<button data-range="${n}" class="${state.range === n ? "active" : ""}">${n} 天</button>`).join("")}</div></div><div class="table-wrap"><table><thead><tr><th>活动</th><th>日期</th><th>时长</th><th>负荷</th><th>平均心率</th><th>最高心率</th><th>估算消耗</th><th></th></tr></thead><tbody>${list.length ? list.map((w) => `<tr><td><div class="sport-cell"><span class="metric-icon">${icon("activity")}</span>${esc(w.sport)}</div></td><td>${w.date}</td><td>${number(w.minutes)} 分</td><td><span class="badge neutral">${number(w.strain, 1)}</span></td><td>${number(w.averageHR)} bpm</td><td>${number(w.maxHR)} bpm</td><td>${number(w.calories)} kcal</td><td><button class="link-button" data-workout="${esc(w.id)}" aria-expanded="${state.expandedWorkout === w.id}">${state.expandedWorkout === w.id ? "收起" : "详情"}</button></td></tr>${state.expandedWorkout === w.id ? workoutDetails(w) : ""}`).join("") : '<tr><td colspan="8" class="table-empty">此时间范围暂无训练记录。连接 WHOOP 并同步后查看。</td></tr>'}</tbody></table></div></section><div class="bottom-grid">${weeklyPanel()}<section class="panel"><div class="engine-graphic">${icon("leaf")}</div><h2>先恢复习惯，再提高负荷</h2><p class="engine-copy">身体状态允许时，逐渐增加活动。成人一般活动指南为每周至少 150 分钟中等强度活动，以及每周至少 2 天肌肉强化；这是一项目标参考，重新开始时无需一次完成。</p><p class="inline-note">若有既往疾病、疼痛或医生的运动限制，请先明确适合你的活动范围。</p></section></div>`;
}
function journalView() {
  const records = state.data.checkins;
  return `<div class="settings-grid"><section class="panel record-list"><div class="panel-head" style="padding:22px 22px 0"><div><h2>身体的另一半数据</h2><p class="panel-subtitle">每天一分钟，补全手环看不到的部分</p></div>${actionButton("record", "新增记录", "plus", "small primary")}</div>${state.demo ? `<div class="journal-empty">${icon("journal")}<p>演示模式不会写入生活记录。</p><button class="btn" style="margin-top:14px" data-action="live">切换到我的数据 ${icon("arrow")}</button></div>` : records.length ? records.map((r) => `<article class="record-card"><div class="record-date"><span>${r.date}</span><button class="link-button" data-edit="${r.date}">编辑 ${icon("chevron")}</button></div><div class="record-metrics"><span>精力 ${r.energy ?? "—"}/5</span><span>酸痛 ${r.soreness ?? "—"}/10</span><span>体重 ${number(r.weight, 1)} kg</span></div>${r.symptoms?.length ? `<div class="chip-row">${r.symptoms.map((s) => `<span class="badge rose">${esc(s)}</span>`).join("")}</div>` : ""}${r.nutrition ? `<p class="record-text">饮食 · ${esc(r.nutrition)}</p>` : ""}${r.notes ? `<p class="record-text">感受 · ${esc(r.notes)}</p>` : ""}</article>`).join("") : `<div class="journal-empty">${icon("journal")}<p>今天感觉如何？<br>记录精力、酸痛、体重和饮食，让趋势更有上下文。</p></div>`}</section><div class="stack"><section class="panel"><div class="engine-graphic">${icon("journal")}</div><h2>把感受，也当成数据</h2><p class="engine-copy">睡得一样久，身体感受也会不同。稳定记录精力与酸痛，能帮助你识别负荷是否适合自己。体重尽量在相近的时段与条件下测量。</p><div class="info-box">精力 1：明显疲惫；5：精力充沛。<br>酸痛 0：没有；10：非常明显。<br>记录不等于诊断。严重或持续的症状需要就医。</div></section><section class="panel"><h2>饮食先记实际发生的</h2><p class="engine-copy">写下吃了什么、大致份量、饮水与饮酒情况。WHOOP 不提供食物摄入信息，控制台不会根据热量消耗猜测你吃了多少。</p></section></div></div>`;
}
function settingsView() {
  const s = state.status;
  const cfg = s.settings;
  return `<div class="settings-grid"><div class="stack"><section class="panel"><div class="panel-head"><div class="step-title"><span class="step-number">01</span><h2>创建 WHOOP 应用</h2></div><a class="link-button" href="https://developer-dashboard.whoop.com/" target="_blank" rel="noreferrer">开发者后台 ${icon("arrow")}</a></div><ol class="guide-list"><li>用你的 WHOOP 账号登录开发者后台，创建 Team 和 App。</li><li>Contact 填写自己的联系邮箱；Privacy Policy 填写 <a href="/privacy" target="_blank" rel="noreferrer">本机隐私说明</a>的网址。</li><li>为应用添加下方 <strong>Redirect URI</strong>。地址必须完全一致。</li><li>启用下列 <strong>read:*</strong> 读取权限，保存应用并取得 <strong>Client ID</strong> 与 <strong>Client Secret</strong>。offline 由授权流程自动请求。</li></ol><div class="code-box"><code>${esc(s.callbackUrl)}</code><button class="icon-button" data-action="copy" aria-label="复制回调地址">${icon("copy")}</button></div><div class="scopes">${s.scopes.map((scope) => `<code>${scope}</code>`).join("")}</div><details><summary>如果开发者后台不接受 HTTP 回调</summary><p>WHOOP 官方文档的回调示例使用 HTTPS。如果后台拒绝 localhost 的 HTTP 地址，可为 localhost 配置浏览器信任的 TLS 证书，在 .env 中设置 TLS_CERT_FILE 与 TLS_KEY_FILE，重启后复制新的 HTTPS 回调地址。具体命令见项目 README。</p></details></section>
    <section class="panel"><div class="panel-head"><div class="step-title"><span class="step-number">02</span><h2>保存凭据并授权</h2></div><span class="badge ${s.connected ? "" : "neutral"}">${s.connected ? "WHOOP 已授权" : "尚未授权"}</span></div><form id="credentials-form"><label class="field">Client ID<input name="clientId" autocomplete="off" spellcheck="false" placeholder="${cfg.clientIdConfigured ? "已保存 · 留空保留现有值" : "粘贴 WHOOP Client ID"}"><span class="field-help">凭据只提交到这台电脑的本机服务。</span></label><label class="field">Client Secret<input name="clientSecret" type="password" autocomplete="new-password" placeholder="${cfg.clientSecretConfigured ? "已保存 · 留空保留现有值" : "粘贴 WHOOP Client Secret"}"><span class="field-help">保存在权限受限的本机数据库中；不回显密钥。请勿把密钥发到聊天中。</span></label><div class="form-actions"><button class="btn" type="submit">${icon("check")}保存凭据</button><button class="btn primary" type="button" data-action="authorize" ${!cfg.clientIdConfigured || !cfg.clientSecretConfigured || s.syncing ? "disabled" : ""}>${icon("link")}${s.connected ? "重新授权" : "授权连接 WHOOP"}</button></div></form>${s.connected ? `<div class="form-actions"><button class="link-button" data-action="disconnect">断开 WHOOP 授权</button><small>本机历史数据保留</small></div>` : ""}</section>
    <section class="panel"><div class="panel-head"><div class="step-title"><span class="step-number">03</span><h2>同步与查看</h2></div></div><p class="engine-copy">首次授权后自动读取最近 90 天。运行期间每 30 分钟同步最近 14 天，更新待评分记录。下方可以补取更早的历史；历史删除尚不自动镜像。</p><div class="form-row"><label class="field">手动同步范围<select id="sync-range"><option value="90">最近 90 天</option><option value="180">最近 180 天</option><option value="365">最近 365 天</option><option value="30">最近 30 天</option><option value="14">最近 14 天</option></select></label><div class="field" style="justify-content:end"><button class="btn primary" data-action="sync" ${!s.connected || s.syncing ? "disabled" : ""}>${icon("refresh", s.syncing ? "spin" : "")}${s.syncing ? "正在同步…" : "立即同步"}</button></div></div><div class="info-box">${s.sync?.finishedAt ? `上次成功：${esc(new Date(s.sync.finishedAt).toLocaleString("zh-CN"))}` : "尚未成功同步真实数据。"}${s.sync?.counts ? `<br>上次获取：${s.sync.counts.cycles} 个周期 · ${s.sync.counts.recoveries} 条恢复 · ${s.sync.counts.sleeps} 条睡眠 · ${s.sync.counts.workouts} 次训练` : ""}<br>手环须先同步至 WHOOP。电脑休眠或本机服务退出后，定时同步暂停。</div></section></div>
    <div class="stack">${reportSettings(cfg)}<section class="panel"><div class="engine-graphic">${icon("leaf")}</div><h2>你的健康方向</h2><p class="engine-copy">第一阶段专注提升体能与恢复。训练经历和身体限制为建议提供上下文。</p><form id="profile-form"><label class="field">当前目标<select name="goal">${["提升体能与恢复", "改善睡眠与精力", "减脂并保持肌肉", "增肌与力量"].map((g) => `<option ${cfg.goal === g ? "selected" : ""}>${g}</option>`).join("")}</select></label><label class="field">训练经历<select name="experience">${["初学 / 重新开始", "规律训练", "长期训练"].map((e) => `<option ${cfg.experience === e ? "selected" : ""}>${e}</option>`).join("")}</select></label><label class="field">身体限制或已有医嘱<textarea name="constraints" maxlength="1000" placeholder="例如：膝盖不适，暂时避免跑步">${esc(cfg.constraints)}</textarea></label><button type="submit" class="btn">${icon("check")}保存健康方向</button></form></section><section class="panel"><div class="panel-head"><h2>分析引擎</h2><span class="badge neutral">本机规则 · v1</span></div><p class="engine-copy">当前建议在本机生成，尚未接入 AI，也不会向模型服务发送健康数据。后续可选择云端 API 或本机模型。</p><a class="btn" style="margin-top:17px" href="/api/summary${modeQuery()}" download>${icon("download")}导出${state.demo ? "演示" : ""} AI 摘要</a><p class="inline-note">摘要包含最近 28 天指标、基线与今日感受选项。不包含 WHOOP 令牌、账号邮箱或原始记录 ID。自由文字不进入此摘要。</p></section><section class="panel"><h2>数据属于你</h2><p class="engine-copy">数据库目录：<code style="overflow-wrap:anywhere">${esc(s.storage?.directory || "项目 .data 文件夹")}</code>。健康数据与密钥依赖本机文件权限保护，未额外加密。请保护电脑账户，并避免将该目录共享或上传。</p><a class="link-button" style="margin-top:15px" href="https://developer.whoop.com/api/" target="_blank" rel="noreferrer">WHOOP 官方接口文档 ${icon("arrow")}</a></section></div></div>`;
}
function footer() {
  const s = state.status;
  return `<footer class="page-footer"><span>${icon("shield")} 本机保存 · ${state.demo ? "演示数据，不反映个人健康" : s.sync?.finishedAt ? `上次同步 ${esc(new Date(s.sync.finishedAt).toLocaleString("zh-CN"))}` : "等待首次 WHOOP 同步"}<br>趋势参考不替代医疗诊断；出现严重不适时优先就医。</span><span class="footer-links">${state.data.guidance.sources.map((s) => `<a href="${s.url}" target="_blank" rel="noreferrer">${s.label}</a>`).join("")}</span></footer>`;
}
function render() {
  if (!state.data) return;
  chartInspector.dismiss();
  const pages = {
    overview,
    trends,
    plans: () => plansView(state),
    workouts: workoutsView,
    journal: journalView,
    settings: settingsView,
  };
  app.innerHTML = `<div class="shell">${sidebar()}<main id="main" class="main">${header()}${banners()}${pages[state.view]()}${footer()}</main></div>`;
  document.title = `LifeOS · ${views[state.view][0]}`;
}

function openJournal(date = state.data.today) {
  if (state.demo) return toast("请先退出演示，再记录自己的身体感受。");
  const old = state.data.checkins.find((c) => c.date === date) || {};
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="journal-title">记录身体的今天</h2><button class="icon-button" data-action="close-dialog" aria-label="关闭记录窗口">${icon("close")}</button></div><p class="dialog-intro">补全手环看不到的部分。相同日期保存会更新当日记录。</p><form id="journal-form"><label class="field">日期<input name="date" type="date" min="2000-01-01" max="${state.data.today}" value="${date}" required></label><div class="form-row"><label class="field">精力（1–5）<select name="energy" required><option value="">请选择</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${old.energy === n ? "selected" : ""}>${n} · ${["明显疲惫", "偏低", "一般", "良好", "精力充沛"][n - 1]}</option>`).join("")}</select></label><label class="field">酸痛（0–10，可选）<input name="soreness" type="number" min="0" max="10" step="1" placeholder="0 为没有酸痛" value="${old.soreness ?? ""}"></label></div><label class="field">体重（kg，可选）<input name="weight" type="number" min="20" max="350" step="0.1" placeholder="相近时段测量，更方便比较" value="${old.weight ?? ""}"></label><label class="field">今天的饮食<textarea name="nutrition" maxlength="1000" placeholder="吃了什么、大致份量、饮水或饮酒情况">${esc(old.nutrition)}</textarea></label><label class="field">身体感受与训练备注<textarea name="notes" maxlength="1000" placeholder="例如：肩部酸痛，今天只做了轻松步行">${esc(old.notes)}</textarea></label><div class="field" style="margin-bottom:7px">是否出现以下情况？（没有则不选）</div><div class="symptom-checks">${["发热", "胸痛", "静息时呼吸困难", "晕厥"].map((s) => `<label><input type="checkbox" name="symptoms" value="${s}" ${old.symptoms?.includes(s) ? "checked" : ""}>${s}</label>`).join("")}</div><p class="inline-note">若出现胸痛、静息时呼吸困难或晕厥，请及时寻求急救，不要等待手环评分。</p><div class="form-actions"><button class="btn primary" type="submit">${icon("check")}保存今日记录</button><button class="btn ghost" type="button" data-action="close-dialog">取消</button></div></form>`;
  dialog.showModal();
}

async function dispatch(action) {
  if (action === "close-dialog") return dialog.close();
  if (action === "record") return openJournal();
  if (action === "generate-plan") {
    if (state.demo) return toast("演示报告不会写入真实记录。");
    state.planGenerating = true;
    render();
    try {
      const { plan } = await api("/api/plans/generate", {});
      state.planDate = plan.targetDate;
      await refresh();
      toast(state.status.reports.job?.state === "waiting" ? "正在等待最新同步或当天评分，数据到齐后自动更新。" : "今日训练安排已更新，可按日期回看。");
    } finally {
      state.planGenerating = false;
      render();
    }
    return;
  }
  if (action === "advice") {
    if (state.view !== "overview") setView("overview");
    document
      .getElementById("advice-section")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (action === "copy") {
    await navigator.clipboard.writeText(state.status.callbackUrl);
    toast("回调地址已复制。");
    return;
  }
  if (action === "demo" || action === "live") {
    state.demo = action === "demo";
    sessionStorage.setItem("lifeos-demo", state.demo ? "yes" : "no");
    await refresh();
    return;
  }
  if (action === "connect") {
    if (
      !state.status.settings.clientIdConfigured ||
      !state.status.settings.clientSecretConfigured
    )
      return setView("settings");
    action = "authorize";
  }
  if (action === "authorize") {
    const result = await api("/api/whoop/authorize", {});
    location.assign(result.url);
    return;
  }
  if (action === "sync") {
    const days = Number(document.getElementById("sync-range")?.value || 90);
    await api("/api/whoop/sync", { days });
    await refresh();
    toast("已开始同步 WHOOP 数据。");
    return;
  }
  if (action === "disconnect") {
    await api("/api/whoop/disconnect", {});
    await refresh();
    toast("已撤销 WHOOP 授权，本机历史数据已保留。");
  }
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button || button.disabled) return;
  try {
    if (button.dataset.view) return setView(button.dataset.view);
    if (button.dataset.planDate) {
      state.planDate = button.dataset.planDate;
      render();
      return;
    }
    if (button.dataset.metric) {
      state.metric = button.dataset.metric;
      render();
      return;
    }
    if (button.dataset.range) {
      state.range = Number(button.dataset.range);
      await refresh();
      return;
    }
    if (button.dataset.workout) {
      state.expandedWorkout =
        state.expandedWorkout === button.dataset.workout
          ? null
          : button.dataset.workout;
      render();
      return;
    }
    if (button.dataset.edit) return openJournal(button.dataset.edit);
    if (button.dataset.action) {
      button.disabled = true;
      try {
        await dispatch(button.dataset.action);
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    }
  } catch (error) {
    toast(error.message, true);
  }
});
document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!["credentials-form", "profile-form", "journal-form", "report-form"].includes(form.id))
    return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const fields = new FormData(form);
    const data = Object.fromEntries(fields);
    if (form.id === "report-form") data.age = data.age === "" ? null : Number(data.age);
    if (form.id === "journal-form") {
      for (const key of ["energy", "soreness", "weight"])
        data[key] = data[key] === "" ? null : Number(data[key]);
      data.symptoms = fields.getAll("symptoms");
      await api("/api/checkins", data);
      dialog.close();
      toast("身体记录已保存。");
    } else {
      await api("/api/settings", data);
      toast(
        form.id === "credentials-form"
          ? "凭据已保存。下一步点击授权连接 WHOOP。"
          : form.id === "report-form" ? "每日报告日程与饮食偏好已保存。" : "健康方向已保存。",
      );
    }
    await refresh();
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
});
window.addEventListener("hashchange", () => {
  if (views[location.hash.slice(1)]) {
    state.view = location.hash.slice(1);
    render();
  }
});

async function start() {
  const params = new URLSearchParams(location.search);
  const oauth = params.get("oauth");
  if (oauth) {
    state.demo = false;
    sessionStorage.setItem("lifeos-demo", "no");
    params.delete("oauth");
    history.replaceState(
      null,
      "",
      `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`,
    );
  }
  try {
    await refresh();
    if (oauth)
      toast(
        oauth === "connected"
          ? "WHOOP 已连接，正在同步最近 90 天的数据。"
          : oauth === "denied"
            ? "授权已取消，可以稍后重新连接。"
            : state.status.authorizationError ||
              "WHOOP 授权失败，请核对凭据和回调地址后重试。",
        oauth === "failed",
      );
  } catch {
    app.innerHTML =
      '<main class="initial-loading">LifeOS<span>本机服务暂时不可用，请检查终端后刷新页面。</span><button class="btn" data-action="reload" style="margin-top:20px">重新加载</button></main>';
    app
      .querySelector("button")
      ?.addEventListener("click", () => location.reload());
  }
  setInterval(async () => {
    if (!state.status || dialog.open || document.hidden) return;
    try {
      const status = await api("/api/status");
      const finished = state.status.syncing && !status.syncing;
      const changed =
        state.status.sync?.finishedAt !== status.sync?.finishedAt ||
        state.status.reports?.latestGeneratedAt !== status.reports?.latestGeneratedAt ||
        state.status.reports?.generating !== status.reports?.generating ||
        state.status.reports?.job?.updatedAt !== status.reports?.job?.updatedAt ||
        state.status.syncing !== status.syncing;
      state.status = status;
      if (changed) await refresh(!["settings", "journal"].includes(state.view));
      if (state.view === "settings" && finished) {
        const el = document.querySelector('[data-action="sync"]');
        if (el) {
          el.disabled = false;
          el.innerHTML = `${icon("refresh")}立即同步`;
        }
      }
      if (finished)
        toast(
          status.sync?.error || "WHOOP 数据同步完成。",
          Boolean(status.sync?.error),
        );
    } catch {
      /* 下次轮询恢复后继续读取，保留当前页面。 */
    }
  }, 5000);
}
start();
