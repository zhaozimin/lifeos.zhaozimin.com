/**
 * [INPUT]: 依赖 zustand 的 create 与 persist（localStorage 键 finance-time-range，version 3）。
 * [OUTPUT]: 提供财务区间与原子 setRange、setBucket。
 * [POS]: 财务三页共享的时间区间真源；bucket 是不透明区间键，编解码归 fin/lib/timeRange，store 只负责存。
 *   日期面板（FinTimeRangeBar）点日期即写入它所在的桶；任意一天都可选，空区间就显示空，不再归一到「有流水的桶」。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TimeDimension = "all" | "custom" | "week" | "month" | "quarter" | "year";

interface TimeRangeState {
  dimension: TimeDimension;
  /** ISO 形式的具体范围键：custom=YYYY-MM-DD..YYYY-MM-DD / week=YYYY-Www / month=YYYY-MM / quarter=YYYY-Qn / year=YYYY / all="" */
  bucket: string;
  setRange: (dimension: TimeDimension, bucket: string) => void;
  setBucket: (bucket: string) => void;
}

export const useTimeRangeStore = create<TimeRangeState>()(
  persist(
    (set) => ({
      dimension: "all",
      bucket: "",
      setRange: (dimension, bucket) => set({ dimension, bucket }),
      setBucket: (bucket) => set({ bucket }),
    }),
    {
      name: "finance-time-range",
      version: 3,
      migrate: () => ({ dimension: "all", bucket: "" }),
    },
  ),
);
