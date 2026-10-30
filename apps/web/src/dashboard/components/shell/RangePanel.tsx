/**
 * [INPUT]: 依赖 clsx、ui/MonthGrid 月历与 zzm.css 的 sm 方键。
 * [OUTPUT]: 对外提供 RangePanel（单字范围键 + 月历 + 两行说明）与 RangeUnit 类型。
 * [POS]: 全部领域共用的日期面板；经 SidebarSlot 固定在二级栏底部。
 *   高度恒定：键行 28、月历 6 行、说明 2 行，切换领域与页面时像素级不动。
 *   范围键是单字方键，当前档为朱键；选中日为朱底白字，区间中段为朱色淡底；点月历上一天＝选中它所在的那一档。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import clsx from "clsx";
import { MonthGrid } from "../ui/MonthGrid";

export interface RangeUnit<T extends string> {
  value: T;
  /** 单字：日 周 月 季 年 全 区 */
  label: string;
  /** 悬停与读屏全称 */
  title: string;
}

interface Props<T extends string> {
  units: Array<RangeUnit<T>>;
  unit: T;
  onUnit: (unit: T) => void;
  month: Date;
  onMonthChange: (month: Date) => void;
  selected: [string, string] | null;
  today: string;
  onSelect?: (day: string) => void;
  /** 第一行：当前区间 */
  caption: string;
  /** 第二行：操作提示 */
  hint: string;
}

export function RangePanel<T extends string>({ units, unit, onUnit, month, onMonthChange, selected, today, onSelect, caption, hint }: Props<T>) {
  return (
    <section aria-label="日期范围" className="grid gap-3">
      <div role="radiogroup" aria-label="范围单位" className="flex gap-1 px-1">
        {units.map((item) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={item.value === unit}
            aria-label={item.title}
            title={item.title}
            onClick={() => onUnit(item.value)}
            className={clsx("zzm-btn zzm-btn--sm zzm-btn--icon", item.value === unit && "zzm-btn--accent")}
          >
            {item.label}
          </button>
        ))}
      </div>
      <MonthGrid
        className="px-1"
        month={month}
        onMonthChange={onMonthChange}
        selected={selected}
        selectionStyle={selected && selected[0] !== selected[1] ? "range" : "solid"}
        today={today}
        onSelect={onSelect ?? (() => undefined)}
        readOnly={!onSelect}
      />
      <div className="grid h-10 content-start px-1 text-[12px] leading-5">
        <p role="status" aria-live="polite" className="truncate font-medium tabular-nums text-foreground">{caption}</p>
        <p className="truncate text-muted-foreground">{hint}</p>
      </div>
    </section>
  );
}
