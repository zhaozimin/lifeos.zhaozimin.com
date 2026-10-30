/**
 * [INPUT]: 依赖可取消的 summary/configuration API、Layout 软刷新信号、App 注入的服务端记录时区、stats 筛选状态机、nature 主题色映射与 EChart 壳。
 * [OUTPUT]: 本人大类分布、仅工作大类的时长和按醒来日期归属的WHOOP实睡KPI。
 * [POS]: pages 的可独立滚动聚合视图；最后一次请求独占写入权，图表只渲染同一范围的服务端统计结果。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router";
import { BarChart3, BriefcaseBusiness, Clock3, Layers } from "lucide-react";
import type { EChartsOption } from "echarts";
import { api, isAbortError } from "../api/client";
import { isoDate, isoMinute, rangeForMonth, rangeForWeek, recordNow, selectStatsMode } from "../lib/dates";
import type { StatsSelection } from "../lib/dates";
import { formatMinutes, NATURE_LABEL, NATURE_ORDER, readNatureColors } from "../lib/nature";
import {timeGroupColor} from '../lib/time-groups';
import { EChart } from "../components/charts/EChart";
import { useThemeStore } from "../store/theme";
import type { RangeSummary } from "../types";
import { Card } from "../components/ui/Card";
import { KPICard } from "../components/ui/KPICard";
import { PageHeader } from "../components/ui/PageHeader";
import { RangePanel, type RangeUnit } from "../components/shell/RangePanel";
import { SidebarSlot } from "../components/shell/SidebarSlot";
import { dateFromIso } from "../components/ui/MonthGrid";
import { SegmentedSwitch } from "../components/ui/SegmentedSwitch";
import type { LayoutOutletContext } from "../components/Layout";

const MODE_UNITS: Array<RangeUnit<StatsSelection["mode"]>> = [
  { value: "today", label: "日", title: "按日统计" },
  { value: "week", label: "周", title: "按周统计" },
  { value: "month", label: "月", title: "按月统计" },
  { value: "custom", label: "区", title: "自定义区间：在日历上点开始和结束" },
];

// 以锚定日计算区间：月统计截止到今天，未来日子不计入
function rangeAround(mode: StatsSelection["mode"], anchor: string, today: string, weekStart: "monday" | "sunday"): [string, string] {
  if (mode === "week") return [...rangeForWeek(anchor, weekStart)] as [string, string];
  if (mode === "month") {
    const [start, end] = rangeForMonth(anchor);
    return [start, end < today ? end : today];
  }
  return [anchor, anchor];
}
const MEASURE_OPTIONS: Array<{ value: "grossMinutes" | "pureMinutes"; label: string }> = [
  { value: "grossMinutes", label: "毛时间" },
  { value: "pureMinutes", label: "纯时间" },
];

export function StatsPage({ recordTimeZone }: { recordTimeZone: string }) {
  const { refreshKey } = useOutletContext<LayoutOutletContext>();
  const [tick, setTick] = useState(() => recordNow(recordTimeZone));
  const today = isoDate(tick);
  const [weekStart, setWeekStart] = useState<"monday" | "sunday">("monday");
  const [selection, setSelection] = useState<StatsSelection>(() => (
    selectStatsMode("week", today, "monday", [today, today])
  ));
  const { mode, range } = selection;
  // 锚定日：null 跟随今天；自定义区间两次点击，第一次只记开始
  const [anchor, setAnchor] = useState<string | null>(null);
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [month, setMonth] = useState(() => dateFromIso(today) ?? new Date());
  const [summary, setSummary] = useState<RangeSummary | null>(null);
  const [measure, setMeasure] = useState<"grossMinutes" | "pureMinutes">("pureMinutes");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const resolved = useThemeStore((state) => state.resolved);
  const [natureColors, setNatureColors] = useState(() => readNatureColors());
  const configurationGeneration = useRef(0);
  const summaryGeneration = useRef(0);

  useEffect(() => {
    setTick(recordNow(recordTimeZone));
    const timer = window.setInterval(() => setTick(recordNow(recordTimeZone)), 60_000);
    return () => window.clearInterval(timer);
  }, [recordTimeZone]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setNatureColors(readNatureColors()));
    return () => window.cancelAnimationFrame(frame);
  }, [resolved]);

  useEffect(() => {
    const controller = new AbortController();
    const generation = ++configurationGeneration.current;
    void api.configuration({ signal: controller.signal })
      .then((config) => {
        if (generation === configurationGeneration.current) setWeekStart(config.settings.weekStart);
      })
      .catch((caught) => {
        if (!isAbortError(caught) && generation === configurationGeneration.current) {
          setError(caught instanceof Error ? caught.message : "统计配置加载失败。");
        }
      });
    return () => controller.abort();
  }, [recordTimeZone, refreshKey]);

  useEffect(() => {
    setSelection((current) => {
      if (current.mode === "custom") return current;
      const nextRange = rangeAround(current.mode, anchor ?? today, today, weekStart);
      if (nextRange[0] === current.range[0] && nextRange[1] === current.range[1]) return current;
      return { ...current, range: nextRange };
    });
  }, [anchor, today, weekStart]);

  const liveMinute = range[0] <= today && today <= range[1] ? isoMinute(tick) : "";
  useEffect(() => {
    const controller = new AbortController();
    const generation = ++summaryGeneration.current;
    setLoading(true);
    setError("");
    void api.summary(range[0], range[1], { signal: controller.signal })
      .then((nextSummary) => {
        if (generation === summaryGeneration.current) setSummary(nextSummary);
      })
      .catch((caught) => {
        if (!isAbortError(caught) && generation === summaryGeneration.current) {
          setError(caught instanceof Error ? caught.message : "统计加载失败。");
        }
      })
      .finally(() => {
        if (generation === summaryGeneration.current) setLoading(false);
      });
    return () => controller.abort();
  }, [liveMinute, range, refreshKey]);

  const choose = (next: StatsSelection["mode"]) => {
    setPendingStart(null);
    setSelection((current) => next === "custom"
      ? { mode: "custom", range: current.range }
      : { mode: next, range: rangeAround(next, anchor ?? today, today, weekStart) });
  };
  const pick = (day: string) => {
    if (mode !== "custom") {
      setAnchor(day === today ? null : day);
      return;
    }
    if (!pendingStart) {
      setPendingStart(day);
      return;
    }
    setSelection({ mode: "custom", range: pendingStart <= day ? [pendingStart, day] : [day, pendingStart] });
    setPendingStart(null);
  };
  const caption = pendingStart ? `开始：${pendingStart}` : range[0] === range[1] ? range[0] : `${range[0]} 至 ${range[1]}`;

  const natureOption = useMemo<EChartsOption>(() => ({
    tooltip: { trigger: "item", valueFormatter: (value) => formatMinutes(Number(value)) },
    legend: { bottom: 0 },
    series: [{
      type: "pie", radius: ["48%", "72%"], center: ["50%", "43%"],
      label: { formatter: "{b}\n{d}%" },
      data: summary?.groupOnly ? summary.byCategory.map(row=>({name:row.name,value:row[measure],itemStyle:{color:timeGroupColor(row.name, resolved)}})) : NATURE_ORDER.map((nature) => ({
        name: NATURE_LABEL[nature],
        value: summary?.byNature.find((row) => row.nature === nature)?.[measure] || 0,
        itemStyle: { color: natureColors[nature] },
      })),
    }],
  }), [summary, measure, natureColors, resolved]);

  const categoryOption = useMemo<EChartsOption>(() => {
    const data = [...(summary?.byCategory || [])].slice(0, 12).reverse();
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (value) => formatMinutes(Number(value)) },
      grid: { left: 86, right: 28, top: 14, bottom: 28 },
      xAxis: { type: "value", axisLabel: { formatter: (value: number) => formatMinutes(value) } },
      yAxis: { type: "category", data: data.map((row) => row.name), axisLabel: { width: 74, overflow: "truncate" } },
      series: [{ type: "bar", data: data.map((row) => ({ value: row[measure], itemStyle: { color: summary?.groupOnly ? timeGroupColor(row.name, resolved) : natureColors[row.nature] } })), barMaxWidth: 20 }],
    };
  }, [summary, measure, natureColors, resolved]);

  const lineOption = useMemo<EChartsOption>(() => ({
    tooltip: { trigger: "axis", valueFormatter: (value) => formatMinutes(Number(value)) },
    grid: { left: 54, right: 24, top: 24, bottom: 42 },
    xAxis: { type: "category", data: summary?.days.map((day) => day.date.slice(5)) || [], axisLabel: { rotate: (summary?.days.length || 0) > 14 ? 35 : 0 } },
    yAxis: { type: "value", axisLabel: { formatter: (value: number) => formatMinutes(value) } },
    series: [{ type: "line", smooth: true, data: summary?.days.map((day) => day.effectiveWorkMinutes) || [], lineStyle: { color: natureColors.core }, itemStyle: { color: natureColors.core }, areaStyle: { color: natureColors.core, opacity: 0.1 } }],
  }), [summary, natureColors]);

  return <div className="pb-6">
    <div className="space-y-6">
    <SidebarSlot summary={caption}>
      <RangePanel
        units={MODE_UNITS}
        unit={mode}
        onUnit={choose}
        month={month}
        onMonthChange={setMonth}
        selected={pendingStart ? [pendingStart, pendingStart] : [range[0], range[1]]}
        today={today}
        onSelect={pick}
        caption={caption}
        hint={mode !== "custom" ? "点日期，统计它所在的那一段。" : pendingStart ? "再点一次，选结束日期。" : "点开始日期，再点结束日期。"}
      />
    </SidebarSlot>
    <PageHeader label="Time · Statistics" title="时间统计" note={`${range[0]} 至 ${range[1]}`} actions={<SegmentedSwitch ariaLabel="时间口径" value={measure} onChange={setMeasure} options={MEASURE_OPTIONS} />} />
    {error && <p role="alert" className="text-[13px] leading-5 text-zzm-accent-ink">{error}</p>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KPICard label={summary?.groupOnly ? '工作时间' : '有效工作时间'} value={formatMinutes(summary?.effectiveWorkMinutes || 0)} helper={summary?.groupOnly ? '仅工作大类 · 纯时间' : '核心创作纯时间'} emphasis="primary" icon={<Clock3 size={16} strokeWidth={1.5} />} />
      {summary?.groupOnly ? <KPICard label="WHOOP睡眠" value={summary.sleepAuthority && summary.sleepAuthority.nights+summary.sleepAuthority.naps>0 ? formatMinutes(summary.sleepAuthority.sleepMinutes) : '待同步'} helper={`按醒来日期 · ${summary.sleepAuthority?.nights || 0}晚 / ${summary.sleepAuthority?.naps || 0}次午睡`} icon={<BriefcaseBusiness size={16} strokeWidth={1.5} />} /> : <KPICard label="工作总时间" value={formatMinutes(summary?.grossWorkMinutes || 0)} helper="核心创作 + 事务支撑毛时间" icon={<BriefcaseBusiness size={16} strokeWidth={1.5} />} />}
      <KPICard label="覆盖率" value={`${((summary?.coverage || 0) * 100).toFixed(1)}%`} helper={`${formatMinutes(summary?.recordedMinutes || 0)} 已记录`} icon={<Layers size={16} strokeWidth={1.5} />} />
      {summary?.groupOnly ? <KPICard label="娱乐时间" value={formatMinutes(summary.byCategory.find(r=>r.name==='娱乐')?.pureMinutes || 0)} helper="包含刷手机及睡眠首尾推定" emphasis="subtle" icon={<BarChart3 size={16} strokeWidth={1.5} />} /> : <KPICard label="扣除时间" value={formatMinutes(summary?.deductionMinutes || 0)} helper="记录内未投入主活动的时间" emphasis="subtle" icon={<BarChart3 size={16} strokeWidth={1.5} />} />}
    </div>
    {summary?.groupOnly && <div className="rounded-lg border border-border bg-zzm-fill px-4 py-3 text-[12.5px] leading-5 text-muted-foreground">睡眠时长采用WHOOP浅睡、深睡和REM合计，夜间清醒不算睡眠。首尾差额按你的规则推定为刷手机。<br/>睡眠卡片按醒来日期统计；下方时间分布按实际时间跨午夜切分。{summary.sleepAuthority?.pending ? ` 另有${summary.sleepAuthority.pending}条手报睡眠等待设备校准。` : ''}{summary.sleepAuthority?.conflicts ? ` ${summary.sleepAuthority.conflicts}次校准遇到后续修改，原修改已保留，待核对。` : ''}</div>}
    <div className="grid gap-4 lg:grid-cols-2">
      <Card padding="md"><h2 className="text-title-lg">{summary?.groupOnly ? '大类分布' : '性质分布'}</h2><p className="text-caption mt-1">{summary?.groupOnly ? '按本人整理的大类' : '固定四类'} · {measure === "pureMinutes" ? "纯时间" : "毛时间"}</p><EChart option={natureOption} className="mt-3 h-[340px]" /></Card>
      <Card padding="md"><h2 className="text-title-lg">{summary?.groupOnly ? '大类明细' : '分类分布'}</h2><p className="text-caption mt-1">{summary?.groupOnly ? '不再拆分细类' : '按写入时的分类快照汇总'}</p><EChart option={categoryOption} className="mt-3 h-[340px]" /></Card>
    </div>
    <Card padding="md"><h2 className="text-title-lg">逐日工作时间</h2><p className="text-caption mt-1">{summary?.groupOnly ? '只统计工作大类，学习成长和出行不混入工作' : '每日 core 纯时间'}</p><EChart option={lineOption} className="mt-3 h-[330px]" /></Card>
    {loading && <div aria-label="正在读取统计" className="zzm-skel h-1" />}
    </div>
  </div>;
}
