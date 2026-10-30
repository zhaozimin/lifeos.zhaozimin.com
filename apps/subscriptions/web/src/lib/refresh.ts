/**
 * [INPUT]: 依赖浏览器分钟时钟、可见性和跨标签页 storage 事件
 * [OUTPUT]: 提供 useRefresh 与 announceChange，统一列表、汇总和提醒的刷新入口
 * [POS]: lib 的数据失效信号；一套监听服务所有页面，具体请求仍走 api
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useRef } from "react";

const listeners = new Set<() => void>();
const STORAGE_KEY = "subos:changed";
let stop: (() => void) | undefined;
function emit() { listeners.forEach((listener) => listener()); }

export function announceChange() {
  window.dispatchEvent(new Event(STORAGE_KEY));
  try { localStorage.setItem(STORAGE_KEY, `${Date.now()}:${Math.random()}`); } catch { /* 私密窗口仍可轮询 */ }
}

export function subscribeRefresh(listener: () => void): () => void {
  listeners.add(listener);
  if (!stop) {
    const timer = window.setInterval(emit, 60_000);
    const visible = () => { if (document.visibilityState === "visible") emit(); };
    const stored = (event: StorageEvent) => { if (event.key === STORAGE_KEY) emit(); };
    window.addEventListener(STORAGE_KEY, emit);
    window.addEventListener("storage", stored);
    document.addEventListener("visibilitychange", visible);
    stop = () => {
      window.clearInterval(timer);
      window.removeEventListener(STORAGE_KEY, emit);
      window.removeEventListener("storage", stored);
      document.removeEventListener("visibilitychange", visible);
    };
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { stop?.(); stop = undefined; }
  };
}

export function useRefresh(load: () => void | Promise<void>) {
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    const tick = () => { void latest.current(); };
    const unsubscribe = subscribeRefresh(tick);
    tick();
    return unsubscribe;
  }, []);
}
