/**
 * [INPUT]: 依赖账户金额序列、当前 finance 主题色板、EChart 容器与 tooltip HTML 转义。
 * [OUTPUT]: 对外提供 AccountBarChart，以横向柱状图展示金额最高的十个账户。
 * [POS]: finance 图表层的账户比较视图；排序/截取只影响显示，不回写账户真源。
 * 访客图表统一经过financialOption，不显示金额或比例。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import {financialOption} from "../../lib/presentation";
import type { EChartsOption } from "echarts";
import { EChart } from "../../../components/charts/EChart";
import { ZZM_TOKENS } from "../../../theme";
import { getPalette } from "../../../components/charts/theme";
import { useThemeStore } from "../../store/theme";
import { escapeHtml } from "../../lib/format";

interface Props {
  data: Array<{ name: string; amount: number; color?: string }>;
  height?: number;
}

export function AccountBarChart({ data, height = 320 }: Props) {
  const resolved = useThemeStore((s) => s.resolved);
  const palette = getPalette(resolved === "dark");

  if (!data.length) {
    return <div className="empty-state">暂无账户数据</div>;
  }

  const sorted = [...data].sort((a, b) => b.amount - a.amount).slice(0, 10);

  const option: EChartsOption = {
    grid: { top: 16, bottom: 24, left: 100, right: 56 },
    xAxis: {
      type: "value",
      axisLabel: {
        color: palette.muted,
        formatter: (value: number) => `¥${(value / 10000).toFixed(0)}万`,
      },
      axisLine: { lineStyle: { color: palette.hairline } },
      splitLine: { lineStyle: { color: palette.hairline, type: "dashed" } },
    },
    yAxis: {
      type: "category",
      data: sorted.map((d) => d.name),
      axisLabel: { color: palette.body, fontWeight: 500 },
      axisLine: { lineStyle: { color: palette.hairline } },
      axisTick: { show: false },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: ((params: any) => {
        const arr = Array.isArray(params) ? params : [params];
        const item = arr[0];
        const value = Number(item?.value || 0);
        return `${escapeHtml(item?.name)}<br/><b>¥${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</b>`;
      }) as any,
    },
    series: [
      {
        type: "bar",
        data: sorted.map((d) => ({
          value: d.amount,
          itemStyle: {
            color: d.color || palette.brandOrange,
            borderRadius: [0, 6, 6, 0],
          },
        })),
        barWidth: 18,
        label: {
          show: true,
          position: "right",
          color: palette.body,
          fontFamily: ZZM_TOKENS.light.font,
          fontSize: 11,
          formatter: ((params: any) => {
            const v = Number(params.value || 0);
            return `¥${v.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
          }) as any,
        },
      },
    ],
  };

  return <EChart option={financialOption(option)} style={{ width: "100%", height }} />;
}
