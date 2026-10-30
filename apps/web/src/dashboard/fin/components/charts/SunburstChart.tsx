/**
 * [INPUT]: 依赖层级支出 SunburstNode 树、finance 主题色板、EChart 容器与 tooltip HTML 转义。
 * [OUTPUT]: 对外提供 SunburstChart，用多层旭日图展示支出分类结构与路径金额。
 * [POS]: finance 图表层的层级支出视图；树构造留在聚合层，本组件只解释渲染契约。
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
import type { SunburstNode } from "../../types";

interface Props {
  data: SunburstNode[];
  height?: number;
}

export function SunburstChart({ data, height = 360 }: Props) {
  const resolved = useThemeStore((s) => s.resolved);
  const palette = getPalette(resolved === "dark");

  if (!data.length) {
    return <div className="empty-state">本期暂无支出分布</div>;
  }

  const option: EChartsOption = {
    tooltip: {
      trigger: "item",
      formatter: ((params: any) => {
        const path =
          (params.treePathInfo as Array<{ name: string }> | undefined)
            ?.map((p) => p.name)
            .filter(Boolean)
            .slice(1)
            .join(" / ") || params.name;
        const value = Number(params.value || 0);
        return `${escapeHtml(path)}<br/><b>¥${value.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}</b>`;
      }) as any,
    },
    series: [
      {
        type: "sunburst",
        data,
        radius: ["18%", "92%"],
        emphasis: { focus: "ancestor" },
        label: {
          rotate: "tangential",
          color: palette.bg,
          fontFamily: ZZM_TOKENS.light.font,
          fontSize: 11,
        },
        levels: [
          {},
          {
            r0: "18%",
            r: "55%",
            label: { rotate: "tangential", fontWeight: 500 },
            itemStyle: { borderRadius: 4, borderColor: palette.bg, borderWidth: 1.5 },
          },
          {
            r0: "55%",
            r: "92%",
            label: { align: "right" },
            itemStyle: { borderRadius: 3, borderColor: palette.bg, borderWidth: 1 },
          },
        ],
      },
    ],
  };

  return <EChart option={financialOption(option)} style={{ width: "100%", height }} />;
}
