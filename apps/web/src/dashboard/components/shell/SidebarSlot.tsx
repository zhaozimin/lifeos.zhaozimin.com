/**
 * [INPUT]: 依赖 react-dom 的 createPortal、shell store 的二级栏收起状态与宽屏媒体查询。
 * [OUTPUT]: 对外提供 SIDEBAR_RANGE_SLOT_ID、SidebarSlot（把页面的范围面板投放到二级栏底部）
 *   与 SidebarRangeFallback（页面没有日期范围时的只读今天月历）。
 * [POS]: 页面与二级栏之间的唯一通道。范围状态仍归页面所有，面板只在二级栏底部一个位置出现，
 *   因此切换领域时日历纹丝不动；二级栏收起或窄屏时，面板退回内容区顶部的折叠条。
 *   设置页与收件箱没有日期范围：插槽为空时 sidebar.css 显示紧随其后的兜底月历，
 *   兜底与 RangePanel 同高同骨架，所以进出这些页面时日历不消失、不位移。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronDown } from "lucide-react";
import { useShellStore } from "../../store/shell";
import { isoDate } from "../../lib/dates";
import { dateFromIso } from "../ui/MonthGrid";
import { RangePanel, type RangeUnit } from "./RangePanel";

export const SIDEBAR_RANGE_SLOT_ID = "sidebar-range-slot";

export function SidebarSlot({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const collapsed = useShellStore((s) => s.sidebarCollapsed);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const locate = () => setSlot(!collapsed && media.matches ? document.getElementById(SIDEBAR_RANGE_SLOT_ID) : null);
    locate();
    media.addEventListener("change", locate);
    return () => media.removeEventListener("change", locate);
  }, [collapsed]);

  if (slot) return createPortal(children, slot);
  return (
    <details className="group mb-4 flex-none rounded-xl border border-border bg-card px-4 py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] leading-5">
        <CalendarDays size={16} strokeWidth={1.5} aria-hidden />
        <span>日期</span>
        <span className="ml-auto truncate tabular-nums text-muted-foreground">{summary}</span>
        <ChevronDown size={14} strokeWidth={1.5} className="shrink-0 group-open:rotate-180" aria-hidden />
      </summary>
      <div className="mt-4 w-[242px] max-w-full">{children}</div>
    </details>
  );
}

// ── 兜底月历 ─────────────────────────────────────────────
// 只读：标出今天，可翻月；「今」键回到本月。不改任何页面的数据范围。
const TODAY_UNIT: Array<RangeUnit<"today">> = [{ value: "today", label: "今", title: "回到本月" }];

export function SidebarRangeFallback() {
  const today = isoDate(new Date());
  const [month, setMonth] = useState(() => dateFromIso(today) ?? new Date());
  return (
    <div className="workspace-range-slot workspace-range-fallback">
      <RangePanel
        units={TODAY_UNIT}
        unit="today"
        onUnit={() => setMonth(dateFromIso(today) ?? new Date())}
        month={month}
        onMonthChange={setMonth}
        selected={[today, today]}
        today={today}
        caption={`${today} · 今天`}
        hint="本页不按日期筛选。"
      />
    </div>
  );
}
