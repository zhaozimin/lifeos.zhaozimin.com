/**
 * [INPUT]: 依赖 lucide 的 ChevronLeft/ChevronRight、clsx 与 zzm.css 的幽灵键。
 * [OUTPUT]: 对外提供 MonthGrid（月份标题 + 翻月键 + 7×6 日期格）与 isoFromDate、dateFromIso 两个日期换算。
 * [POS]: 日期选择器、时间与财务侧栏共用的月历原语；领域组件决定单选或两次点击。
 *   日期一律用 "YYYY-MM-DD" 墙钟字符串进出，选中可以是一天，也可以是一段（周视图）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export function dateFromIso(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isoFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

interface Props {
  /** 当前展示的月份（取其年月） */
  month: Date;
  onMonthChange: (month: Date) => void;
  /** 选中区间，含两端；单日选中时两端相同 */
  selected: [string, string] | null;
  /** range 用墨色标端点、浅灰连接区间；solid 保持原有整段填充。 */
  selectionStyle?: "solid" | "range";
  /** 记录时区的今天，描边标出 */
  today: string;
  onSelect: (iso: string) => void;
  min?: string;
  max?: string;
  /** 只读：仍可翻月查看，日期不可点（范围由单位键决定的场景） */
  readOnly?: boolean;
  className?: string;
}

export function MonthGrid({ month, onMonthChange, selected, selectionStyle = "solid", today, onSelect, min, max, readOnly = false, className }: Props) {
  const year = month.getFullYear();
  const index = month.getMonth();
  const gridStart = new Date(year, index, 1 - new Date(year, index, 1).getDay());

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" aria-label="上个月" onClick={() => onMonthChange(new Date(year, index - 1, 1))} className="zzm-btn zzm-btn--ghost zzm-btn--icon zzm-btn--sm">
          <ChevronLeft size={14} strokeWidth={1.5} />
        </button>
        <span className="text-[13px] font-semibold leading-5 tabular-nums">{year} 年 {index + 1} 月</span>
        <button type="button" aria-label="下个月" onClick={() => onMonthChange(new Date(year, index + 1, 1))} className="zzm-btn zzm-btn--ghost zzm-btn--icon zzm-btn--sm">
          <ChevronRight size={14} strokeWidth={1.5} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map((day) => (
          <span key={day} className="py-1 text-center font-mono text-[10.5px] leading-4 text-zzm-muted">{day}</span>
        ))}
        {Array.from({ length: 42 }, (_, offset) => {
          const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + offset);
          const iso = isoFromDate(date);
          const inMonth = date.getMonth() === index;
          const inRange = !!selected && selected[0] <= iso && iso <= selected[1];
          const endpoint = !!selected && (iso === selected[0] || iso === selected[1]);
          const outOfRange = (!!min && iso < min) || (!!max && iso > max);
          return (
            <button
              key={iso}
              type="button"
              disabled={outOfRange || readOnly}
              aria-label={iso}
              aria-pressed={inRange}
              onClick={() => onSelect(iso)}
              className={clsx(
                "h-8 rounded-md text-[12.5px] tabular-nums transition-colors",
                inRange
                  ? selectionStyle === "range" && !endpoint
                    ? "bg-zzm-accent-soft text-zzm-accent-ink"
                    : "bg-zzm-accent font-semibold text-white"
                  : outOfRange
                    ? "cursor-not-allowed text-zzm-faint"
                    : clsx(
                        readOnly ? "cursor-default" : "hover:bg-zzm-fill",
                        inMonth ? "text-foreground" : "text-zzm-muted",
                        iso === today && "border border-[var(--zzm-hairline-strong)] font-semibold",
                      ),
              )}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
