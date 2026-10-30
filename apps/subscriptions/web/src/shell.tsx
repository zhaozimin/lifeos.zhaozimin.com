/**
 * [INPUT]: 依赖 api 的分类与汇总
 * [OUTPUT]: 对外提供 ShellProvider、useShell、STATUS_FILTERS。完整状态入口、统一刷新与折合月费，不负责折叠
 * [POS]: web 的壳层状态。App 持有，Sidebar 与 Board 共用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRefresh } from "./lib/refresh";
import { useAsyncScope } from "./lib/asyncScope";
import { api } from "./api";
import type { Category, Summary } from "./types";

/**
 * 不是分类的那几个筛选。类型与运行时守卫都从这一处长出来——
 * 以前是手抄两份，加「已暂停」时漏抄一份，标签就被当成失效分类弹回全部。
 */
export const STATUS_FILTERS = ["all", "soon", "paused", "ended", "overdue"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export type CardFilter = StatusFilter | string;

function isStatusFilter(value: CardFilter): boolean {
  return (STATUS_FILTERS as readonly string[]).includes(value);
}

type ShellContext = {
  filter: CardFilter;
  setFilter: (next: CardFilter) => void;
  categories: Category[];
  summary: Summary | null;
};

const Ctx = createContext<ShellContext | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const [filter, setFilter] = useState<CardFilter>("all");
  const [categories, setCategories] = useState<Category[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);

  const readScope = useAsyncScope();
  async function refresh() {
    const current = readScope.begin();
    try {
      const [cats, next] = await Promise.all([api.listCategories(), api.summary()]);
      if (!current()) return;
      setCategories(cats.items);
      setSummary(next);
    } catch {
      if (current()) setSummary(null); // 隐去过时汇总，避免把旧金额当作当前值
    }
  }

  useRefresh(refresh);

  useEffect(() => {
    if (isStatusFilter(filter)) return;
    // 选中的分类被删了才回落到全部
    if (!categories.some((cat) => cat.id === filter)) setFilter("all");
  }, [categories, filter]);

  const value = useMemo<ShellContext>(
    () => ({ filter, setFilter, categories, summary }),
    [filter, categories, summary],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShell(): ShellContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useShell 必须包在 ShellProvider 里");
  return ctx;
}
