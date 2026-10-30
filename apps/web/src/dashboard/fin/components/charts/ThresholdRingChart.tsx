/**
 * [INPUT]: 依赖账户当前值/阈值/分区线、finance 主题/系列色、EChart 容器与金额转义。
 * [OUTPUT]: 对外提供 ThresholdAccount 与 ThresholdRingChart，以同心环展示多账户阈值达成与分区风险。
 * [POS]: finance 图表层的账户阈值视图；颜色从分区规则派生，点击只回传账户交调用方处理。
 * 访客图表统一经过financialOption，不显示金额或比例。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import {financialOption} from "../../lib/presentation";
import type { EChartsOption } from "echarts";
import { EChart } from "../../../components/charts/EChart";
import { ZZM_TOKENS, type ZzmTokens } from "../../../theme";
import { getPalette, getSeriesPalette } from "../../../components/charts/theme";
import { useThemeStore } from "../../store/theme";
import { escapeHtml, formatCurrency, privateValue } from "../../lib/format";

export interface ThresholdAccount {
  name: string;
  current: number;
  threshold: number;
  color?: string;
  /** W3：低 / 中两条警戒线。current < low 成功色、low ≤ current ≤ mid 提醒色、current > mid 朱色，超 threshold 警告。 */
  lowZone?: number;
  midZone?: number;
}

/** 按 current 在哪一档返回颜色；无 zone 配置时回退到序列色。画布读不到 CSS 变量，角色色取主题实色。 */
function zoneColor(account: ThresholdAccount, fallback: string, tokens: ZzmTokens) {
  const low = account.lowZone || 0;
  const mid = account.midZone || 0;
  if (low <= 0 && mid <= 0) return fallback;
  // 越过中线需要处理：朱；越过低线提醒；其余成功墨绿
  if (mid > 0 && account.current > mid) return tokens.accentInk;
  if (low > 0 && account.current > low) return tokens.warning;
  return tokens.ok;
}

interface Props {
  accounts: ThresholdAccount[];
  height?: number;
  onAccountClick?: (account: ThresholdAccount) => void;
}

/**
 * 账户阈值同心圆图。
 * 每个账户一圈环形进度（current / threshold），中心展示综合达成率。
 * 用 ECharts gauge 系列叠加实现。
 */
export function ThresholdRingChart({ accounts, height = 360, onAccountClick }: Props) {
  const resolved = useThemeStore((s) => s.resolved);
  const palette = getPalette(resolved === "dark");
  const series = getSeriesPalette(resolved === "dark");

  const valid = accounts.filter((a) => a.threshold > 0);

  if (valid.length === 0) {
    return (
      <div className="empty-state">
        <div className="text-[14px] mb-1">暂未设置账户阈值</div>
        <div className="text-[12px] opacity-60 not-italic font-sans">
          在「设置 → 账户」中为账户设置阈值，会进入这里的同心圆总览。
        </div>
      </div>
    );
  }

  const visible = valid.slice(0, 5);

  // 综合达成率：所有账户加权平均
  const overall =
    visible.reduce((sum, a) => sum + Math.min(a.current / a.threshold, 1.5), 0) / visible.length;

  // 每个账户一个环（ECharts gauge），半径从大到小
  const ringSeries = visible.map((account, index) => {
    const ratio = Math.min(account.current / account.threshold, 1);
    const innerRadius = 92 - index * 14;
    const fallback = account.color || series[index % series.length];
    const color = zoneColor(account, fallback, ZZM_TOKENS[resolved]);
    return {
      type: "gauge" as const,
      startAngle: 90,
      endAngle: -270,
      radius: `${innerRadius}%`,
      center: ["50%", "50%"],
      pointer: { show: false },
      progress: {
        show: true,
        roundCap: true,
        width: 9,
        itemStyle: { color },
      },
      axisLine: {
        lineStyle: {
          width: 9,
          color: [[1, palette.hairline]],
        },
      },
      splitLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      anchor: { show: false },
      title: { show: false },
      detail: { show: false },
      data: [{ value: ratio * 100, name: account.name }],
      silent: false,
      tooltip: {
        // 账户名是用户可控输入，而 tooltip 的字符串型 formatter 返回值走 innerHTML——必须转义。
        formatter: () =>
          `${escapeHtml(account.name)}<br/>当前 <b>${formatCurrency(account.current)}</b><br/>上限 ${formatCurrency(account.threshold)}<br/>达成率 <b>${privateValue((ratio * 100).toFixed(1)+"%")}</b>`,
      },
      animationDuration: 800,
      animationDelay: index * 60,
    } as any;
  });

  const option: EChartsOption = {
    tooltip: { trigger: "item" },
    graphic: [
      {
        type: "text",
        left: "center",
        top: "44%",
        z: 100,
        style: {
          text: privateValue(`${(overall * 100).toFixed(0)}%`),
          fontFamily: ZZM_TOKENS.light.font,
          fontSize: 26,
          fontWeight: 700,
          fill: palette.fg,
          textAlign: "center",
        },
      },
      {
        type: "text",
        left: "center",
        top: "60%",
        z: 100,
        style: {
          text: "综合达成率",
          fontFamily: ZZM_TOKENS.light.font,
          fontSize: 11,
          fill: palette.muted,
          textAlign: "center",
        },
      },
    ],
    series: ringSeries,
  } as EChartsOption;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:justify-center sm:gap-6">
      <div
        className="relative w-full max-w-[360px] shrink-0"
        style={{ height }}
      >
        <EChart
          option={financialOption(option)}
          style={{ width: "100%", height: "100%" }}
          onChartClick={(params) => {
            const name = String(params.name || "");
            const account = visible.find((item) => item.name === name);
            if (account) onAccountClick?.(account);
          }}
        />
      </div>
      <ul className="w-full max-w-[360px] space-y-2 sm:w-[280px] sm:max-w-none">
        {visible.map((account, index) => {
          const rawRatio = account.current / account.threshold;
          const ratio = Math.max(0, Math.min(rawRatio, 1));
          const overflow = rawRatio > 1;
          const fallback = account.color || series[index % series.length];
          const color = zoneColor(account, fallback, ZZM_TOKENS[resolved]);
          const hasZones = (account.lowZone || 0) > 0 || (account.midZone || 0) > 0;
          return (
            <li key={account.name}>
              <button
                type="button"
                onClick={() => onAccountClick?.(account)}
                className="w-full rounded-md border border-transparent px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-zzm-fill"
              >
                <div className="flex items-baseline gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 shrink-0 translate-y-[-2px] rounded-sm"
                    style={{ background: color }}
                  />
                  <span className="truncate text-[13px] font-medium text-foreground">
                    {account.name}
                  </span>
                  <span
                    className={
                      "ml-auto text-[14px] font-semibold tabular-nums " +
                      (overflow ? "text-destructive" : "text-foreground")
                    }
                  >
                    {privateValue(`${Math.round(rawRatio * 100)}%`)}
                  </span>
                </div>
                <div className="relative mt-2 h-1 overflow-hidden rounded-[2px] bg-[var(--zzm-hairline-2)]">
                  {hasZones && (account.lowZone || 0) > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute top-0 h-full w-px bg-foreground/30"
                      style={{ left: `${Math.min(100, ((account.lowZone || 0) / account.threshold) * 100)}%` }}
                    />
                  )}
                  {hasZones && (account.midZone || 0) > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute top-0 h-full w-px bg-foreground/40"
                      style={{ left: `${Math.min(100, ((account.midZone || 0) / account.threshold) * 100)}%` }}
                    />
                  )}
                  <div
                    className="h-full rounded-[2px]"
                    style={{ width: `${ratio * 100}%`, background: color }}
                  />
                  {overflow && (
                    <div
                      className="-mt-1 h-1 rounded-[2px] bg-zzm-accent/60"
                      style={{ width: "100%" }}
                    />
                  )}
                </div>
                <div className="mt-1.5 flex items-baseline justify-between text-[11.5px] tabular-nums text-muted-foreground">
                  <span>
                    当前{" "}
                    <span className="font-medium text-foreground">
                      {formatCurrency(account.current)}
                    </span>
                  </span>
                  <span>
                    上限{" "}
                    <span className="font-medium text-foreground">
                      {formatCurrency(account.threshold)}
                    </span>
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
