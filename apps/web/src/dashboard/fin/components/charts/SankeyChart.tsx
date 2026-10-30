/**
 * [INPUT]: 依赖资金流 SankeyNode/SankeyLink 结构、finance 主题/系列色、EChart 容器与 tooltip 转义。
 * [OUTPUT]: 对外提供 SankeyChart 与 SankeySelection，绘制资金流向并回传节点/边选择。
 * [POS]: finance 图表层的资金流拓扑视图；链路身份直接使用 source/target 字段，不做易冲突的字符串回解。
 * 访客图表统一经过financialOption，不显示金额或比例。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import {financialOption} from "../../lib/presentation";
import type { EChartsOption } from "echarts";
import {isVisitor} from "../../../../access";
import { EChart } from "../../../components/charts/EChart";
import { ZZM_TOKENS } from "../../../theme";
import { getPalette, getSeriesPalette } from "../../../components/charts/theme";
import { useThemeStore } from "../../store/theme";
import { escapeHtml } from "../../lib/format";
import type { SankeyLink, SankeyNode } from "../../types";

export type SankeySelection =
  | { kind: "node"; name: string }
  | { kind: "edge"; source: string; target: string };

interface Props {
  nodes: SankeyNode[];
  links: SankeyLink[];
  /** 支持 CSS 表达式（如 calc/max），容器尺寸变化由 EChart 的 ResizeObserver 接管 */
  height?: number | string;
  onSelect?: (selection: SankeySelection) => void;
}

export function SankeyChart({ nodes, links, height = 420, onSelect }: Props) {
  const resolved = useThemeStore((s) => s.resolved);
  const isDark = resolved === "dark";
  const palette = getPalette(isDark);
  const series = getSeriesPalette(isDark);

  if (!nodes.length || !links.length) {
    // 空态占据与图表相同的高度：容器尺寸不随数据多少改变
    return (
      <div className="empty-state flex items-center justify-center" style={{ height }}>
        本期暂无资金流向
      </div>
    );
  }

  const targetNames = new Set(links.map((link) => link.target));
  const sourceNames = new Set(links.map((link) => link.source));
  const styledNodes = nodes.map((node, index) => {
    const labelPosition = !targetNames.has(node.name) && sourceNames.has(node.name)
      ? ("left" as const)
      : ("right" as const);
    return {
      name: node.name,
      itemStyle: {
        color: node.itemStyle?.color || series[index % series.length],
        borderColor: palette.bg,
        borderWidth: 1,
      },
      label: {
        position: labelPosition,
      },
    };
  });

  const option: EChartsOption = {
    tooltip: {
      trigger: "item",
      formatter: ((params: any) => {
        if(isVisitor())return "资金流向 · ••••";
        if (params.dataType === "edge") {
          const value = Number(params.data?.value || 0);
          return `${escapeHtml(params.data?.source)} → ${escapeHtml(params.data?.target)}<br/><b>¥${value.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}</b>`;
        }
        return escapeHtml(params.data?.name || params.name || "");
      }) as any,
    },
    series: [
      {
        type: "sankey",
        data: styledNodes,
        links: links.map((link) => ({ source: link.source, target: link.target, value: link.value })),
        nodeAlign: "justify",
        nodeWidth: 16,
        nodeGap: 14,
        left: "10%",
        right: "10%",
        top: 22,
        bottom: 22,
        emphasis: { focus: "adjacency" },
        lineStyle: {
          color: "gradient",
          curveness: 0.5,
          opacity: isDark ? 0.55 : 0.45,
        },
        label: {
          fontFamily: ZZM_TOKENS.light.font,
          fontSize: 12,
          color: palette.body,
        },
        cursor: "pointer",
      },
    ],
  };

  return (
    <EChart
      option={financialOption(option)}
      style={{ width: "100%", height }}
      onChartClick={(params) => {
        if (!onSelect) return;
        // sankey 连线 dataType === "edge"
        if (params.dataType === "edge") {
          const data = params.data as { source?: string; target?: string } | undefined;
          const source = String(data?.source || "");
          const target = String(data?.target || "");
          if (source && target) onSelect({ kind: "edge", source, target });
          return;
        }
        // 其余（node 矩形 + 标签）按节点处理；标签点击有时不带 dataType
        const data = params.data as { name?: string } | undefined;
        const name = String(data?.name || params.name || "");
        if (name) onSelect({ kind: "node", name });
      }}
    />
  );
}
