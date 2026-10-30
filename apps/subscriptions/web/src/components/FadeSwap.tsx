/**
 * [INPUT]: 依赖 react 的 token。token 变了先淡出旧内容，再淡入新内容
 * [OUTPUT]: 对外提供 FadeSwap。换页、换分类用同一套进出
 * [POS]: components 的换场。不碰 Sheet，只包右侧主列
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

const OUT_MS = 90;

export function FadeSwap({ token, children }: { token: string; children: ReactNode }) {
  const [shown, setShown] = useState(token);
  const [phase, setPhase] = useState<"in" | "out" | "idle">("idle");
  const latest = useRef(children);
  const cache = useRef(children);
  latest.current = children;
  if (token === shown) cache.current = children;

  useEffect(() => {
    if (token === shown) {
      if (phase === "out") setPhase("in");
      return;
    }
    setPhase("out");
    const timer = window.setTimeout(() => {
      cache.current = latest.current;
      setShown(token);
      setPhase("in");
    }, OUT_MS);
    return () => window.clearTimeout(timer);
  }, [token, shown, phase]);

  return (
    <div className={phase === "out" ? "pane-out" : phase === "in" ? "pane-in" : undefined}>
      {cache.current}
    </div>
  );
}
