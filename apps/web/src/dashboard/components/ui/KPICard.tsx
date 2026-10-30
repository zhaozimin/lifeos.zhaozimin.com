/**
 * [INPUT]: 依赖 clsx、lucide 趋势图标与 zzm.css 的 .zzm-card。
 * [OUTPUT]: 对外提供 KPICard：标签、数值、变化与辅助口径。
 * [POS]: components/ui 的指标卡原语；时间统计页消费。
 *   标签用 mono 节标签；趋势只用墨与灰，不用红绿——涨跌好坏由业务口径决定，颜色不替用户下结论。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ReactNode } from "react";
import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

interface Props {
  label: string;
  value: string;
  change?: string;
  trend?: "up" | "down" | "flat";
  helper?: string;
  icon?: ReactNode;
  emphasis?: "default" | "primary" | "subtle";
}

export function KPICard({
  label,
  value,
  change,
  trend = "flat",
  helper,
  icon,
  emphasis = "default",
}: Props) {
  const inverted = emphasis === "primary";
  const TrendIcon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus;

  return (
    <div
      className={clsx(
        "flex min-h-[144px] flex-col gap-3 p-5",
        emphasis === "default" && "zzm-card",
        emphasis === "subtle" && "rounded-xl border border-border bg-zzm-fill",
        inverted && "rounded-xl bg-primary text-primary-foreground",
      )}
    >
      <div className="flex items-center justify-between">
        <span className={clsx("text-caption-uppercase", inverted && "!text-current opacity-70")}>{label}</span>
        {icon && <span className={inverted ? "opacity-70" : "text-zzm-muted"}>{icon}</span>}
      </div>
      <div className="text-display-md mt-1 tabular-nums">{value}</div>
      <div className="mt-auto flex items-center gap-2">
        {change && (
          <span className={clsx("inline-flex items-center gap-1 text-[12px] font-semibold leading-4", !inverted && "text-foreground")}>
            <TrendIcon size={14} strokeWidth={1.5} />
            {change}
          </span>
        )}
        {helper && <span className={clsx("text-[12px] leading-4", inverted ? "opacity-70" : "text-zzm-muted")}>{helper}</span>}
      </div>
    </div>
  );
}
