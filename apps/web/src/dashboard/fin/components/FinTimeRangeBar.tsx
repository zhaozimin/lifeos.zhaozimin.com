/**
 * [INPUT]: 依赖财务范围 store、lib/timeRange 的桶换算与区间边界、shell 的 RangePanel 与 SidebarSlot。
 * [OUTPUT]: 对外提供 FinTimeRangeBar：财务三页共用的日期面板（周 月 季 年 全 区 + 月历）。
 * [POS]: 财务时间筛选的唯一入口；经 SidebarSlot 固定在二级栏底部，与其他领域的日历同一位置。
 *   点日期＝选中它所在的周、月、季或年；「区」为两次点击选起止；「全」看全部流水。
 *   不再有下拉：任意一天都可选中，不受「是否有流水」限制，空区间就显示空。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useEffect, useState } from "react";
import { RangePanel, type RangeUnit } from "../../components/shell/RangePanel";
import { SidebarSlot } from "../../components/shell/SidebarSlot";
import { bucketOf, currentBucket, isoDay, parseDay, rangeBounds, rangeBucket } from "../lib/timeRange";
import { useTimeRangeStore, type TimeDimension } from "../store/timeRange";
import type { Transaction } from "../types";

const UNITS: Array<RangeUnit<TimeDimension>> = [
  { value: "week", label: "周", title: "按周" },
  { value: "month", label: "月", title: "按月" },
  { value: "quarter", label: "季", title: "按季度" },
  { value: "year", label: "年", title: "按年" },
  { value: "all", label: "全", title: "全部时间" },
  { value: "custom", label: "区", title: "自定义区间：在日历上点开始和结束" },
];

export function FinTimeRangeBar({ transactions }: { transactions: Transaction[] }) {
  const { dimension, bucket, setRange } = useTimeRangeStore();
  const today = isoDay(new Date());
  const { from, to } = rangeBounds(dimension, bucket, transactions);
  const fromDay = from ? isoDay(from) : null;
  const toDay = to ? isoDay(to) : null;
  const anchor = dimension === "all" ? toDay ?? today : fromDay ?? today;
  const [month, setMonth] = useState(() => parseDay(anchor) ?? new Date());
  const [pendingStart, setPendingStart] = useState<string | null>(null);

  useEffect(() => setPendingStart(null), [dimension, bucket]);
  useEffect(() => {
    const date = parseDay(anchor);
    if (date) setMonth((current) => current.getFullYear() === date.getFullYear() && current.getMonth() === date.getMonth() ? current : date);
  }, [anchor]);

  // 切单位时沿用当前区间的起点，没有起点就落在今天所在的那一档
  const chooseUnit = (next: TimeDimension) => {
    if (next === "all") return setRange("all", "");
    if (next === "custom") return setRange("custom", fromDay && toDay ? rangeBucket(parseDay(fromDay)!, parseDay(toDay)!) : rangeBucket(new Date(), new Date()));
    setRange(next, currentBucket(next, parseDay(fromDay ?? today) ?? new Date()));
  };

  const pick = (day: string) => {
    if (dimension !== "custom" && dimension !== "all") {
      setRange(dimension, bucketOf(`${day}T12:00:00`, dimension));
      return;
    }
    if (!pendingStart) {
      setPendingStart(day);
      return;
    }
    // 编码器统一排序；同一天点两次就是单日区间
    setRange("custom", rangeBucket(parseDay(pendingStart)!, parseDay(day)!));
    setPendingStart(null);
  };

  const caption = pendingStart
    ? `开始：${pendingStart}`
    : dimension === "all"
      ? "全部时间"
      : fromDay && toDay
        ? fromDay === toDay ? fromDay : `${fromDay} 至 ${toDay}`
        : "尚未选择区间";
  const hint = pendingStart
    ? "再点一次，选结束日期。"
    : dimension === "all"
      ? "点日期开始自定义区间。"
      : dimension === "custom"
        ? "点开始日期，再点结束日期。"
        : "点日期，选中它所在的那一段。";

  return (
    <SidebarSlot summary={caption}>
      <RangePanel
        units={UNITS}
        unit={dimension}
        onUnit={chooseUnit}
        month={month}
        onMonthChange={setMonth}
        selected={pendingStart ? [pendingStart, pendingStart] : fromDay && toDay ? [fromDay, toDay] : null}
        today={today}
        onSelect={pick}
        caption={caption}
        hint={hint}
      />
    </SidebarSlot>
  );
}
