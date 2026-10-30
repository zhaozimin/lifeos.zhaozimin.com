/**
 * [INPUT]: 依赖周期账目规则、financeAnalytics 预测、主题色板与 EChart 容器。
 * [OUTPUT]: 对外提供 CashflowForecastCard，切换并绘制 30/60/90 天未来净现金流。
 * [POS]: finance 看板的未来派生视图；预测算法留在 lib，本组件只管视窗选择与图表表达。
 * 访客图表统一经过financialOption，不显示金额或比例。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import {financialOption} from "../lib/presentation";
import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { EChart } from "../../components/charts/EChart";
import { CategoryTabs } from "../../components/ui/Tabs";
import { useThemeStore } from "../store/theme";
import { getPalette } from "../../components/charts/theme";
import { formatCurrency } from "../lib/format";
import { forecastCashflow } from "../lib/financeAnalytics";
import type { RecurringRule } from "../types";

const HORIZON_OPTIONS = [
  { value: "30", label: "30 天" },
  { value: "60", label: "60 天" },
  { value: "90", label: "90 天" },
];

export function CashflowForecastCard({ rules }: { rules: RecurringRule[] }) {
  const [horizon, setHorizon] = useState<"30" | "60" | "90">("30");
  const resolved = useThemeStore((s) => s.resolved);
  const palette = getPalette(resolved === "dark");

  const forecast = useMemo(() => forecastCashflow(rules, Number(horizon)), [rules, horizon]);
  const finalNet = forecast.cumulativeNet[forecast.cumulativeNet.length - 1] || 0;

  if (!rules.some((r) => r.enabled)) {
    return (
      <div className="empty-state">
        在「财务设置 → 周期账目」启用至少一条周期规则后，这里会出现未来 30/60/90 天的预测折线。
      </div>
    );
  }

  const option: EChartsOption = {
    tooltip: { trigger: "axis" },
    grid: { top: 24, right: 16, bottom: 36, left: 60 },
    xAxis: {
      type: "category",
      data: forecast.labels,
      axisLine: { lineStyle: { color: palette.hairline } },
      axisLabel: { color: palette.muted, interval: Math.floor(forecast.labels.length / 8) },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        color: palette.muted,
        formatter: (v: number) => (Math.abs(v) >= 1000 ? `¥${(v / 1000).toFixed(1)}k` : `¥${Math.round(v)}`),
      },
      splitLine: { lineStyle: { color: palette.hairline } },
    },
    series: [
      {
        name: "累计净额",
        type: "line",
        smooth: true,
        symbolSize: 6,
        data: forecast.cumulativeNet,
        lineStyle: { width: 2.5, color: palette.brandBlue },
        itemStyle: { color: palette.brandBlue },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: palette.hairline, type: "dashed" },
          data: [{ yAxis: 0 }],
        },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: `${palette.brandBlue}80` },
              { offset: 1, color: `${palette.brandBlue}10` },
            ],
          },
        },
      },
    ],
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-caption">未来 {horizon} 天预计净额</div>
          <div className={`text-[22px] font-bold leading-8 tabular-nums ${finalNet >= 0 ? "text-zzm-ok " : "text-destructive"}`}>
            {finalNet >= 0 ? "+" : "−"}{formatCurrency(Math.abs(finalNet))}
          </div>
        </div>
        <CategoryTabs value={horizon} onChange={(v) => setHorizon(v as "30" | "60" | "90")} options={HORIZON_OPTIONS} variant="pills" />
      </div>
      <EChart option={financialOption(option)} style={{ height: 280 }} />
    </div>
  );
}
