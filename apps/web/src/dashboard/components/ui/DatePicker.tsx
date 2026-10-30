/**
 * [INPUT]: 依赖 react-dom 的 createPortal、lucide 的 Calendar、clsx、
 *   同目录 Autocomplete 的 useCoarsePointer 与 MonthGrid 月历网格。
 * [OUTPUT]: 对外提供 DatePicker —— shadcn Calendar 风格的单日期选择（触发器 + 弹出月历）。
 * [POS]: components/ui 的日期原语；两域合并后的单一实现，财务项目起止/目标日期消费它，
 *   时间统计页仍以原生日期输入完成自定义区间。
 *   自适应：桌面(细指针)弹出主题化月历（今天描边、选中填充、min/max 禁用）；
 *   移动(粗指针)降级为原生 <input type="date"> 唤起系统日期滚轮。值恒为 "YYYY-MM-DD" 或 ""。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar as CalendarIcon } from "lucide-react";
import clsx from "clsx";
import { useCoarsePointer } from "./Autocomplete";
import { MonthGrid, dateFromIso as parseIso, isoFromDate as toIso } from "./MonthGrid";

interface Props {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string;
  placeholder?: string;
  disabled?: boolean;
  /** 可选边界（含端点），格式 YYYY-MM-DD；界外日期禁选。 */
  min?: string;
  max?: string;
  className?: string;
}

const MENU_GAP = 4;
const MENU_WIDTH = 280;

export function DatePicker({ value, onChange, label, hint, placeholder = "选择日期…", disabled, min, max, className }: Props) {
  const coarse = useCoarsePointer();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const selected = parseIso(value);
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => selected || new Date());

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8));
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 340 && rect.top > spaceBelow) {
      setPos({ left, bottom: window.innerHeight - rect.top + MENU_GAP });
    } else {
      setPos({ left, top: rect.bottom + MENU_GAP });
    }
  }, []);

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    setVisibleMonth(parseIso(value) || new Date());
    const onScrollResize = () => reposition();
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // 只关日历，不连带关掉父级 Modal/Sheet（它们的 Esc 监听挂在 window 上）
        event.stopImmediatePropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reposition]);

  // ———— 移动/触屏：原生日期输入，唤起系统滚轮 ————
  if (coarse) {
    return (
      <label className={clsx("block", className)}>
        {label && <span className="field-label">{label}</span>}
        <span className="field">
        <input
          type="date"
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        </span>
        {hint && <span className="field-hint">{hint}</span>}
      </label>
    );
  }

  // ———— 桌面：弹出月历 ————
  const todayIso = toIso(new Date());

  const commit = (iso: string) => {
    onChange(iso);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className={clsx("block", className)}>
      {label && <span className="field-label">{label}</span>}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="field w-full text-left"
      >
        <CalendarIcon size={14} strokeWidth={1.5} className="shrink-0 text-zzm-muted" aria-hidden />
        <span className={clsx("truncate", !value && "text-zzm-muted")}>
          {value || placeholder}
        </span>
      </button>
      {hint && <span className="field-hint">{hint}</span>}

      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            aria-label="选择日期"
            className="zzm-popover fixed z-[90] p-3"
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: MENU_WIDTH }}
          >
            <MonthGrid
              month={visibleMonth}
              onMonthChange={setVisibleMonth}
              selected={value ? [value, value] : null}
              today={todayIso}
              onSelect={commit}
              min={min}
              max={max}
            />
            <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
              <button
                type="button"
                onClick={() => commit(todayIso)}
                className="zzm-btn zzm-btn--ghost zzm-btn--sm"
              >
                今天
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                className="zzm-btn zzm-btn--ghost zzm-btn--sm"
              >
                清除
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
