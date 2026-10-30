/**
 * [INPUT]: 依赖项目名、成本/收入对齐数组、finance 主题色板与 EChart 容器。
 * [OUTPUT]: 对外提供 RoiChart，以并列柱图比较各项目成本与收入。
 * [POS]: finance 图表层的项目回报比较视图；只消费已聚合数组，不重算交易归属。
 * 访客图表统一经过financialOption，不显示金额或比例。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import {financialOption} from "../../lib/presentation";
import type { EChartsOption } from "echarts";
import { EChart } from "../../../components/charts/EChart";
import { getPalette } from "../../../components/charts/theme";
import { useThemeStore } from "../../store/theme";

interface Props {
  projects: string[];
  cost: number[];
  revenue: number[];
  height?: number;
}

export function RoiChart({ projects, cost, revenue, height = 320 }: Props) {
  const resolved = useThemeStore((s) => s.resolved);
  const palette = getPalette(resolved === "dark");

  if (!projects.length) return <div className="empty-state">暂无项目数据</div>;

  const option: EChartsOption = {
    grid: { top: 32, bottom: 28, left: 64, right: 24 },
    legend: {
      top: 0,
      right: 0,
      icon: "circle",
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: palette.muted, fontSize: 12 },
    },
    xAxis: {
      type: "category",
      data: projects,
      axisLine: { lineStyle: { color: palette.hairline } },
      axisTick: { show: false },
      axisLabel: { color: palette.body, fontSize: 12 },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        color: palette.muted,
        formatter: (v: number) => `¥${(v / 1000).toFixed(0)}k`,
      },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: palette.hairline, type: "dashed" } },
    },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    series: [
      {
        name: "收入",
        type: "bar",
        data: revenue,
        itemStyle: { color: palette.brandBlue, borderRadius: [4, 4, 0, 0] },
        barWidth: 22,
      },
      {
        name: "成本",
        type: "bar",
        data: cost,
        itemStyle: { color: palette.brandOrange, borderRadius: [4, 4, 0, 0] },
        barWidth: 22,
      },
    ],
  };

  return <EChart option={financialOption(option)} style={{ width: "100%", height }} />;
}
