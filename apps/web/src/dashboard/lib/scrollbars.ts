/**
 * [INPUT]: 依赖浏览器 scroll 事件（捕获阶段，覆盖任意滚动容器）。
 * [OUTPUT]: 对外提供 revealScrollbarsWhileScrolling：滚动中的元素带 data-scrolling，停 900ms 后移除。
 * [POS]: lib 的滚动条显隐开关；index.css 据此只在滚动时显示滚动条，复刻 macOS 的浮现式滚动条。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const HIDE_AFTER_MS = 900;

export function revealScrollbarsWhileScrolling(root: Document = document): void {
  const timers = new WeakMap<Element, number>();
  root.addEventListener(
    "scroll",
    (event) => {
      const target = event.target === root ? root.documentElement : event.target;
      if (!(target instanceof Element)) return;
      target.setAttribute("data-scrolling", "");
      window.clearTimeout(timers.get(target));
      timers.set(target, window.setTimeout(() => target.removeAttribute("data-scrolling"), HIDE_AFTER_MS));
    },
    { capture: true, passive: true },
  );
}
