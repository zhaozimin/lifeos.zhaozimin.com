/**
 * [INPUT]: 依赖 ReactNode。
 * [OUTPUT]: 提供财务看板 KPI 状态卡。
 * [POS]: Overview 的可复用指标展示原语。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ReactNode } from "react";


export function StatusCard({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn";
}) {
  // 收入用成功墨绿；支出与净额为负不标红——金额本身不是错误，朱色只留给需要处理的地方
  const color = { neutral: "text-foreground", good: "text-zzm-ok", warn: "text-foreground" }[tone];
  return (
    <div className="zzm-card p-5">
      <div className="mb-3 flex items-center justify-between text-zzm-muted">
        <span className="text-caption-uppercase">{label}</span>
        {icon}
      </div>
      <div className={`text-display-sm tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
