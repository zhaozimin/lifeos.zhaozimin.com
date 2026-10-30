/**
 * [INPUT]: 依赖晨间报告、发布状态和图表转义函数。
 * [OUTPUT]: 导出当天训练页、总览入口与上海日程表单。
 * [POS]: public 的每日建议视图；先展示训练及同步凭据，再展示饮食作息。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { escapeHtml as esc } from "./charts.js";
const dateTime = (iso, timeZone) => iso ? new Intl.DateTimeFormat("zh-CN", {
  timeZone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).format(new Date(iso)) : "暂无";
const list = (items) => `<ul class="plan-list">${items.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`;
const publicationLabel = (plan) => ({ published: "已发布", preview: "晨间预览", waiting: "等待最新数据" })[plan.publication?.state] || "历史预案";

export function planTeaser(state) {
  const schedule = state.status.reports;
  const latest = state.plans?.find((p) => p.targetDate === schedule.today);
  return `<section class="panel plan-teaser"><div><span class="eyebrow">TODAY'S TRAINING</span><h2>${latest ? `${esc(latest.targetDate)} · ${esc(latest.title)}` : "醒来，先看看今天怎样训练"}</h2><p>每天 ${esc(schedule.reportTime)} 更新当天安排 · ${esc(schedule.timeZone)} · 发布前先同步 WHOOP${latest ? ` · ${publicationLabel(latest)}` : ""}</p></div><button class="btn primary" data-view="plans">查看今日训练 <span aria-hidden="true">→</span></button></section>`;
}

export function reportSettings(settings) {
  return `<section class="panel"><div class="panel-head"><div><h2>晨间训练日程</h2><p class="panel-subtitle">先同步最新数据，再发布当天安排</p></div></div><form id="report-form"><div class="form-row"><label class="field">当天正式更新时间<input name="reportTime" type="time" value="${esc(settings.reportTime)}" required></label><label class="field">起床参考时间<input name="wakeTime" type="time" value="${esc(settings.wakeTime)}" required></label></div><label class="field">报告时区<input name="timeZone" value="${esc(settings.timeZone)}" list="time-zones" required><datalist id="time-zones"><option value="Asia/Shanghai"><option value="America/Los_Angeles"><option value="Asia/Tokyo"><option value="Europe/London"></datalist><span class="field-help">上海时间填写 Asia/Shanghai。提前一小时开始准备，正式更新前再同步一次。</span></label><div class="form-row"><label class="field">年龄（可选）<input name="age" type="number" min="18" max="120" step="1" value="${settings.age ?? ""}" placeholder="成人一般参考"></label><label class="field">饮食偏好<select name="diet">${["不限", "蛋奶素", "纯素"].map((s) => `<option ${settings.diet === s ? "selected" : ""}>${s}</option>`).join("")}</select></label></div><label class="field">食物过敏或忌口<textarea name="foodRestrictions" maxlength="1000" placeholder="没有则留空；填写后采用保守食材建议">${esc(settings.foodRestrictions)}</textarea></label><button class="btn" type="submit">保存每日建议设置</button></form><p class="inline-note">评分未到或同步失败时显示等待状态，每 5 分钟重试。06:30 是你在 06:00–07:00 起床的参考点，可修改。电脑休眠时暂停，唤醒后补当天安排。</p></section>`;
}

function trainingPanel(plan) {
  const today = plan.period === "today";
  return `<section class="panel"><div class="plan-section-label">01 / TODAY'S TRAINING</div><div class="panel-head"><h2>${esc(plan.exercise.mode)}</h2><span class="badge neutral">${publicationLabel(plan)}</span></div>${list(plan.exercise.steps)}<div class="morning-check"><h3>${today ? "训练前检查，再执行" : "明晨先检查，再执行"}</h3>${list(plan.morningCheck)}</div></section>`;
}
function foodPanel(plan) {
  return `<section class="panel"><div class="plan-section-label">02 / FOOD</div><h2>吃什么：${esc(plan.nutrition.diet)}饮食的三餐示例</h2><div class="meal-grid">${plan.nutrition.meals.map((m) => `<div class="meal-card"><small>${esc(m.name)}</small><h3>${esc(m.text)}</h3></div>`).join("")}</div><p class="engine-copy">${esc(plan.nutrition.text)}</p><p class="engine-copy">${esc(plan.nutrition.hydration)}</p><p class="inline-note">${esc(plan.nutrition.note)}</p></section>`;
}
function sleepPanel(plan) {
  const today = plan.period === "today";
  return `<section class="panel"><div class="plan-section-label">03 / SLEEP</div><h2>${today ? "今晚作息：为下一次恢复留足时间" : "作息：给恢复留足时间"}</h2><div class="sleep-schedule"><div><small>${today ? "今晚放松" : "前一晚放松"}</small><strong>${plan.sleep.windDown}</strong></div><span>→</span><div><small>${today ? "今晚上床" : "前一晚上床"}</small><strong>${plan.sleep.bedtime}</strong></div><span>→</span><div><small>${today ? "次日起床" : "当天起床"}</small><strong>${plan.sleep.wakeTime}</strong></div></div><p class="engine-copy">${esc(plan.sleep.text)}</p>${list(plan.sleep.habits)}</section>`;
}
function evidencePanel(plan) {
  const refresh = plan.publication?.refresh;
  return `<section class="panel"><div class="plan-section-label">04 / EVIDENCE</div><h2>为什么这样安排</h2><p class="panel-subtitle">依据的生理日期 ${plan.basis.physiologicalDate} · WHOOP 原记录时区 ${esc(plan.basis.timezoneOffset)}</p><div class="evidence-chips">${plan.basis.evidence.map((e) => `<span>${esc(e.text.includes(e.label) ? e.text : `${e.label} · ${e.text}`)}</span>`).join("") || "尚无有效恢复依据"}</div>${refresh ? `<p class="inline-note">本次拉取：${dateTime(refresh.startedAt, plan.timeZone)} 开始 · ${refresh.succeeded ? `${dateTime(refresh.finishedAt, plan.timeZone)} 完成` : "未成功"}。同步成功与当天评分完成后才发布训练。</p>` : ""}<p class="inline-note">最后成功同步：${dateTime(plan.basis.lastSyncAt, plan.timeZone)} · ${esc(plan.timeZone)}。每次更新保留旧修订。</p>${plan.missing.length ? `<div class="plan-missing"><h3>还缺少的信息</h3>${list(plan.missing)}</div>` : ""}<details><summary>规则与资料来源</summary><p>${esc(plan.rules)}</p><div class="plan-sources">${plan.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.label)} ↗</a>`).join("")}</div></details></section>`;
}

export function plansView(state) {
  const schedule = state.status.reports;
  const reports = state.plans || [];
  const plan = reports.find((p) => p.targetDate === state.planDate) || reports[0];
  const top = `<section class="panel report-schedule"><div><span class="eyebrow">MORNING TRAINING BRIEF</span><h2>每天 ${esc(schedule.reportTime)}，更新今天的训练安排</h2><p>${esc(schedule.timeZone)} · ${esc(schedule.preparationTime)} 开始准备<br>${esc(schedule.timing)}</p></div><div class="form-actions"><button class="btn" data-view="settings">修改日程</button><button class="btn primary" data-action="generate-plan" ${state.demo || schedule.generating || state.planGenerating ? "disabled" : ""}>${schedule.generating || state.planGenerating ? "正在拉取最新数据…" : "同步并更新今日安排"}</button></div></section>${schedule.job?.error ? `<div class="banner ${schedule.job.refresh?.reason === "sync-failed" ? "error" : "info"}">${esc(schedule.job.error)}</div>` : ""}`;
  if (!plan) return top + '<section class="panel plan-empty"><h2>今天的安排，从最新数据开始</h2><p>点击“同步并更新今日安排”，先同步 WHOOP，再读取当天睡眠和恢复。评分未到时显示等待状态，数据到齐后自动更新。</p></section>';
  const date = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long", timeZone: "UTC" }).format(new Date(`${plan.targetDate}T12:00Z`));
  const url = `/api/plans/export?date=${encodeURIComponent(plan.targetDate)}&timeZone=${encodeURIComponent(plan.timeZone)}`;
  const publication = plan.publication;
  return top + `<div class="report-layout"><aside class="panel report-history"><h3>按日期回看</h3><p class="panel-subtitle">显示每个日期的最新修订</p><div class="report-history-list">${reports.map((p) => `<button data-plan-date="${p.targetDate}" class="${p.targetDate === plan.targetDate ? "active" : ""}" aria-pressed="${p.targetDate === plan.targetDate}"><strong>${p.targetDate}</strong><small>${publicationLabel(p)} · 修订 ${p.revision}</small></button>`).join("")}</div></aside><div class="report-body"><article class="panel report-cover ${plan.status === "urgent" ? "urgent-callout" : ""}"><div class="report-meta"><span class="badge ${plan.status === "urgent" ? "rose" : "neutral"}">${publicationLabel(plan)}</span><span>${esc(plan.engine)}${state.demo ? " · 演示" : ""}</span></div><div class="eyebrow">${esc(date)} · ${plan.targetDate}</div><h2>${esc(plan.title)}</h2><p>${esc(publication?.message || plan.limits)}</p><div class="report-meta"><span>更新 ${dateTime(plan.generatedAt, plan.timeZone)} · ${esc(plan.timeZone)} · 修订 ${plan.revision}</span>${!state.demo ? `<a class="link-button" href="${url}" download>导出报告 ↓</a>` : ""}</div>${plan.slot?.catchUp ? '<p class="inline-note">此份在预定时间之后补生成，保留实际拉取和更新时间。</p>' : ""}</article>${trainingPanel(plan)}${foodPanel(plan)}${sleepPanel(plan)}${evidencePanel(plan)}</div></div>`;
}
