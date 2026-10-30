/**
 * [INPUT]: 依赖 zustand 与 types 的 SegmentSource。
 * [OUTPUT]: 对外提供 useTimeViewStore：时间页的锚定日期、日/周视图、来源筛选与可见区间。
 * [POS]: 时间域的共享视图状态；DayPage 与时间二级栏（迷你月历、来源筛选）读写同一份。
 *   pinnedDay 为 null 表示「跟随今天」：跨过零点自动落到新的一天，不需要额外的推进逻辑。
 *   只在会话内保存，刷新页面回到今天。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { create } from "zustand";
import type { SegmentSource } from "../types";

export type TimeViewMode = "day" | "week";
export type TimeSourceFilter = "all" | SegmentSource;

interface TimeViewState {
  pinnedDay: string | null;
  viewMode: TimeViewMode;
  source: TimeSourceFilter;
  /** DayPage 按服务端周起点算出的可见区间；迷你月历据此高亮，不另取配置 */
  visibleRange: [string, string] | null;
  /** 选中今天时传 today，状态回到「跟随今天」 */
  pinDay: (day: string, today: string) => void;
  setViewMode: (mode: TimeViewMode) => void;
  setSource: (source: TimeSourceFilter) => void;
  setVisibleRange: (range: [string, string]) => void;
}

export const useTimeViewStore = create<TimeViewState>()((set) => ({
  pinnedDay: null,
  viewMode: "day",
  source: "all",
  visibleRange: null,
  pinDay: (day, today) => set({ pinnedDay: day === today ? null : day }),
  setViewMode: (viewMode) => set({ viewMode }),
  setSource: (source) => set({ source }),
  setVisibleRange: (visibleRange) => set((state) => (
    state.visibleRange?.[0] === visibleRange[0] && state.visibleRange?.[1] === visibleRange[1] ? state : { visibleRange }
  )),
}));
