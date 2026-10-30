/**
 * [INPUT]: 依赖 data-help 载荷、chart-help.js 和浏览器事件。
 * [OUTPUT]: 导出 installChartInspector；提供悬停、固定、方向键和触屏解读。
 * [POS]: public 的唯一图表交互控制器；浮层挂在 body，避开 SVG 裁切。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { explainHelp } from "./chart-help.js";
import { escapeHtml as esc } from "./html.js";

export function installChartInspector() {
  const panel = document.createElement("div");
  panel.id = "chart-inspector";
  panel.className = "chart-inspector";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-labelledby", "chart-inspector-title");
  document.body.append(panel);
  let active = null, blocked = null, pinned = false, hideTimer = null, frame = null;
  let anchor = { x: 0, y: 0 };
  const targetOf = (target) => target instanceof Element ? target.closest("[data-help]") : null;
  const inPanel = (target) => target instanceof Node && panel.contains(target);
  const cancelHide = () => clearTimeout(hideTimer);

  function decorate(element, on) {
    element.classList.toggle("is-inspected", on);
    element.setAttribute("aria-expanded", String(on));
    if (on) element.setAttribute("aria-describedby", "chart-inspector-summary");
    else element.removeAttribute("aria-describedby");
    const svg = element.closest("[data-inspect-chart]");
    const guide = svg?.querySelector(".inspection-guide");
    if (guide) {
      const x = element.dataset.guideX;
      guide.toggleAttribute("hidden", !on || x === undefined);
      if (on && x !== undefined) { guide.setAttribute("x1", x); guide.setAttribute("x2", x); }
    }
    if (element.dataset.pointIndex !== undefined) svg?.querySelectorAll("[data-plot-index]").forEach((point) => {
      point.classList.toggle("is-inspected", on && point.dataset.plotIndex === element.dataset.pointIndex);
    });
  }
  function position() {
    frame = null;
    if (panel.hidden || !active) return;
    const viewportWidth = document.documentElement.clientWidth;
    if (window.innerWidth <= 600) {
      panel.style.width = `${Math.max(0, viewportWidth - 24)}px`;
      panel.style.left = "12px"; panel.style.top = "auto"; panel.style.bottom = "12px";
      return;
    }
    panel.style.width = "";
    panel.style.bottom = "auto";
    const rect = panel.getBoundingClientRect();
    let left = anchor.x + 18;
    if (left + rect.width > viewportWidth - 14) left = anchor.x - rect.width - 18;
    const top = Math.min(Math.max(12, anchor.y - 18), Math.max(12, window.innerHeight - rect.height - 12));
    panel.style.left = `${Math.max(12, Math.min(left, viewportWidth - rect.width - 12))}px`;
    panel.style.top = `${top}px`;
  }
  function queuePosition() { if (!frame) frame = requestAnimationFrame(position); }
  function setAnchor(element, event) {
    const rect = element.getBoundingClientRect();
    anchor = event && Number.isFinite(event.clientX) ? { x: event.clientX, y: event.clientY } :
      { x: rect.left + rect.width / 2, y: rect.top + Math.min(rect.height / 2, 60) };
  }
  function updatePin() {
    panel.classList.toggle("is-pinned", pinned);
    const status = panel.querySelector(".inspector-status");
    if (status) status.textContent = pinned ? "已固定 · Esc 关闭" : "点击图形可固定 · Esc 关闭";
  }
  function show(element, event, pin = false, force = false) {
    if (!element || element === blocked || (pinned && element !== active && !force)) return;
    cancelHide();
    if (active !== element) {
      let payload;
      try { payload = JSON.parse(element.dataset.help); } catch { return; }
      const help = explainHelp(payload);
      if (active) decorate(active, false);
      active = element;
      panel.innerHTML = `<div class="inspector-head"><div><span class="inspector-date">${esc(help.date)}</span><h3 id="chart-inspector-title">${esc(help.title)}</h3></div><button class="inspector-close" type="button" aria-label="关闭数据解读">×</button></div><div id="chart-inspector-summary">${help.readings.map((r) => `<section class="inspector-reading"><div class="inspector-value"><strong>${esc(r.name)}</strong><b>${esc(r.value)}</b></div><p>${esc(r.meaning)}</p>${r.comparison ? `<div class="inspector-comparison">${esc(r.comparison)}</div>` : ""}<p class="inspector-takeaway">${esc(r.reading)}</p></section>`).join("")}${help.notes.length ? `<ul class="inspector-notes">${help.notes.map((note) => `<li>${esc(note)}</li>`).join("")}</ul>` : ""}</div><div class="inspector-footer"><span class="inspector-status"></span>${help.sources.map((source, i) => `<a href="${esc(source)}" target="_blank" rel="noreferrer">指标来源${help.sources.length > 1 ? ` ${i + 1}` : ""} ↗</a>`).join("")}</div>`;
      panel.scrollTop = 0;
      decorate(active, true);
    }
    pinned = pin;
    updatePin();
    setAnchor(element, event);
    panel.hidden = false;
    position();
  }
  function dismiss(suppress = false) {
    cancelHide();
    if (frame) { cancelAnimationFrame(frame); frame = null; }
    const previous = active;
    if (active) decorate(active, false);
    active = null; pinned = false; panel.hidden = true;
    blocked = suppress ? previous : null;
    if (previous?.isConnected && panel.contains(document.activeElement)) previous.focus({ preventScroll: true });
  }
  const scheduleHide = () => {
    cancelHide();
    if (!pinned) hideTimer = setTimeout(() => {
      if (active?.matches(":hover") || panel.matches(":hover") || active === document.activeElement) return;
      dismiss();
    }, 180);
  };
  document.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    const element = targetOf(event.target);
    if (element && !pinned) show(element, event);
  });
  document.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch" || pinned) return;
    const element = targetOf(event.target);
    if (!element) return;
    if (element !== active) show(element, event);
    else { cancelHide(); setAnchor(element, event); queuePosition(); }
  });
  document.addEventListener("pointerout", (event) => {
    const from = targetOf(event.target), to = targetOf(event.relatedTarget);
    if (from === blocked && from !== to) blocked = null;
    if (from === active && from !== to && !inPanel(event.relatedTarget)) scheduleHide();
  });
  panel.addEventListener("pointerenter", cancelHide);
  panel.addEventListener("pointerleave", scheduleHide);
  document.addEventListener("focusin", (event) => {
    const element = targetOf(event.target);
    if (element) show(element, null, pinned, true);
  });
  document.addEventListener("focusout", (event) => {
    if (!pinned && !targetOf(event.relatedTarget) && !inPanel(event.relatedTarget)) scheduleHide();
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest?.(".inspector-close")) { dismiss(true); return; }
    const element = targetOf(event.target);
    if (element) {
      event.preventDefault();
      if (active === element && pinned) dismiss(true);
      else { blocked = null; show(element, event, true, true); }
    } else if (!inPanel(event.target) && (pinned || !active?.matches(":hover"))) dismiss();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) { event.preventDefault(); dismiss(true); return; }
    const element = targetOf(event.target);
    if (!element) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (active === element && pinned) dismiss(true);
      else { blocked = null; show(element, null, true, true); }
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || element.dataset.pointIndex === undefined) return;
    const chart = element.closest("[data-inspect-chart]");
    const points = [...(chart?.querySelectorAll("[data-point-index][data-help]") || [])];
    if (!points.length) return;
    event.preventDefault();
    const index = points.indexOf(element);
    const next = event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 :
      Math.max(0, Math.min(points.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1)));
    points.forEach((point, i) => { point.tabIndex = i === next ? 0 : -1; });
    blocked = null; points[next].focus({ preventScroll: true }); show(points[next], null, pinned, true);
  });
  window.addEventListener("resize", queuePosition);
  window.addEventListener("scroll", (event) => {
    if (pinned || inPanel(event.target)) return;
    if (active && active === document.activeElement) {
      const rect = active.getBoundingClientRect();
      if (rect.bottom >= 0 && rect.top <= window.innerHeight) { setAnchor(active, null); queuePosition(); return; }
    }
    dismiss();
  }, true);
  return { dismiss };
}
