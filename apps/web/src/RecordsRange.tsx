/**
 * [INPUT]: 依赖 model 的上海今天、dashboard/lib/dates 的周与月区间、shell 的 RangePanel 与 SidebarSlot。
 * [OUTPUT]: 对外提供 RecordsRange：历史记录的日期面板（全 日 周 月 区），输出 start/end 字符串。
 * [POS]: RecordsView 的日期筛选；经 SidebarSlot 固定在二级栏底部，与其他领域的日历同一位置。
 *   取代原先的「开始日期 / 结束日期」两个原生输入框；选完立即生效，不需要再点查询。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useState } from "react";
import { today as shanghaiToday } from "./model";
import { rangeForMonth, rangeForWeek } from "./dashboard/lib/dates";
import { RangePanel, type RangeUnit } from "./dashboard/components/shell/RangePanel";
import { SidebarSlot } from "./dashboard/components/shell/SidebarSlot";
import { dateFromIso } from "./dashboard/components/ui/MonthGrid";

type Unit = "all" | "day" | "week" | "month" | "custom";

const UNITS: Array<RangeUnit<Unit>> = [
  { value: "all", label: "全", title: "全部历史" },
  { value: "day", label: "日", title: "按日" },
  { value: "week", label: "周", title: "按周" },
  { value: "month", label: "月", title: "按月" },
  { value: "custom", label: "区", title: "自定义区间：在日历上点开始和结束" },
];

function around(unit: Unit, anchor: string): [string, string] {
  if (unit === "week") return [...rangeForWeek(anchor, "monday")] as [string, string];
  if (unit === "month") return rangeForMonth(anchor);
  return [anchor, anchor];
}

export function RecordsRange({ onChange }: { onChange: (range: { start: string; end: string }) => void }) {
  const today = shanghaiToday();
  const [unit, setUnit] = useState<Unit>("all");
  const [range, setRange] = useState<[string, string] | null>(null);
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [month, setMonth] = useState(() => dateFromIso(today) ?? new Date());

  useEffect(() => {
    onChange(range ? { start: range[0], end: range[1] } : { start: "", end: "" });
  }, [range, onChange]);

  const chooseUnit = (next: Unit) => {
    setUnit(next);
    setPendingStart(null);
    if (next === "all") setRange(null);
    else if (next !== "custom") setRange(around(next, range?.[0] ?? today));
  };
  const pick = (day: string) => {
    if (unit === "day" || unit === "week" || unit === "month") return setRange(around(unit, day));
    if (!pendingStart) return setPendingStart(day);
    setUnit("custom");
    setRange(pendingStart <= day ? [pendingStart, day] : [day, pendingStart]);
    setPendingStart(null);
  };

  const caption = pendingStart ? `开始：${pendingStart}` : !range ? "全部历史" : range[0] === range[1] ? range[0] : `${range[0]} 至 ${range[1]}`;
  const hint = pendingStart
    ? "再点一次，选结束日期。"
    : unit === "all" || unit === "custom"
      ? "点开始日期，再点结束日期。"
      : "点日期，看它所在的那一段。";

  return (
    <SidebarSlot summary={caption}>
      <RangePanel
        units={UNITS}
        unit={unit}
        onUnit={chooseUnit}
        month={month}
        onMonthChange={setMonth}
        selected={pendingStart ? [pendingStart, pendingStart] : range}
        today={today}
        onSelect={pick}
        caption={caption}
        hint={hint}
      />
    </SidebarSlot>
  );
}
