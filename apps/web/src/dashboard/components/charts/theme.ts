/**
 * [INPUT]: 依赖 theme 的 ZZM_TOKENS、DATA_SERIES 与 ECharts 主题注册 API。
 * [OUTPUT]: 对外提供 ChartPalette、chartThemeName、ensureChartTheme、getPalette 与 getSeriesPalette。
 * [POS]: 纸墨朱令牌到 ECharts 画布的唯一桥；时间统计与财务图表共用，业务图不另造颜色真源。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as echarts from "echarts/core";
import { DATA_SERIES, ZZM_TOKENS, type ThemeMode } from "../../theme";

export interface ChartPalette {
  bg: string;
  fg: string;
  body: string;
  muted: string;
  hairline: string;
  brandOrange: string;
  brandApricot: string;
  brandCream: string;
  brandViolet: string;
  brandBlueViolet: string;
  brandBlue: string;
  success: string;
}

export type ChartThemeName = `zzm-${ThemeMode}`;

const modeOf = (isDark: boolean): ThemeMode => (isDark ? "dark" : "light");

export function chartThemeName(resolved: ThemeMode): ChartThemeName {
  return `zzm-${resolved}`;
}

// 业务图沿用旧字段名；字段只表示序列位置，不再对应品牌色
export function getPalette(isDark: boolean): ChartPalette {
  const t = ZZM_TOKENS[modeOf(isDark)];
  const s = DATA_SERIES[modeOf(isDark)];
  return {
    bg: t.surface,
    fg: t.ink,
    body: t.text4,
    muted: t.muted,
    hairline: t.hairline,
    brandOrange: s[0],
    brandApricot: s[4],
    brandCream: t.paper,
    brandViolet: s[2],
    brandBlueViolet: s[3],
    brandBlue: s[1],
    success: t.ok,
  };
}

export function getSeriesPalette(isDark: boolean): string[] {
  return DATA_SERIES[modeOf(isDark)];
}

const registered = new Set<ChartThemeName>();

export function ensureChartTheme(name: ChartThemeName) {
  if (registered.has(name)) return;
  const isDark = name === "zzm-dark";
  const t = ZZM_TOKENS[modeOf(isDark)];
  const text = { fontFamily: t.font, color: t.text4 };
  // 坐标轴：细线三档里的 .09，刻度字用 muted；网格只留横线，不画刻度
  const axis = {
    axisLine: { show: true, lineStyle: { color: t.hairline } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontFamily: t.font, fontSize: 11 },
    splitLine: { lineStyle: { color: t.hairline } },
    splitArea: { show: false },
  };
  echarts.registerTheme(name, {
    color: getSeriesPalette(isDark),
    backgroundColor: "transparent",
    textStyle: text,
    title: { textStyle: { ...text, color: t.ink }, subtextStyle: { ...text, color: t.muted } },
    legend: { textStyle: { ...text, fontSize: 12 }, itemWidth: 8, itemHeight: 8, icon: "circle" },
    categoryAxis: { ...axis, splitLine: { show: false } },
    valueAxis: { ...axis, axisLine: { show: false } },
    timeAxis: axis,
    pie: { label: { color: t.text4, fontSize: 11.5, textBorderWidth: 0 }, labelLine: { lineStyle: { color: t.hairline } }, itemStyle: { borderColor: t.surface, borderWidth: 2 } },
    line: { symbolSize: 6, lineStyle: { width: 2 } },
    bar: { itemStyle: { borderRadius: 2 } },
    // 浮层取 surface-2 与 .14 细线；投影值对齐 --zzm-float-shadow
    tooltip: {
      backgroundColor: t.surface2,
      borderColor: t.hairline,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { ...text, color: t.ink, fontSize: 12 },
      axisPointer: { lineStyle: { color: t.hairline }, shadowStyle: { color: t.fill } },
      extraCssText: isDark
        ? "box-shadow: 0 1px 2px rgba(0,0,0,.5), 0 18px 48px rgba(0,0,0,.6); border-radius: 12px;"
        : "box-shadow: 0 1px 2px rgba(0,0,0,.10), 0 18px 48px rgba(0,0,0,.22); border-radius: 12px;",
    },
  });
  registered.add(name);
}
