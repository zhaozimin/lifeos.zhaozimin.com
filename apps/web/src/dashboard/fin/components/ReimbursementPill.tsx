/**
 * [INPUT]: 依赖 lucide 状态图标、clsx、types 的 ReimbursementStatus。
 * [OUTPUT]: 对外提供 ReimbursementActions（是否报销双按钮组：已报销/已驳回，点击激活项撤回待报销）、
 *   ReimbursementStatusTag（非交互展示态，可安全嵌入其他可点击容器）与
 *   SettlePill（回款核销入口按钮）。
 * [POS]: 报销流程的行内状态原语，被 LedgerPage 与 ReimbursementSettleSheet 消费；
 *   状态→图标/文案的唯一事实源（rejected 统一叫「已驳回」，与服务端一致）。
 *   已驳回 ≠ 终态：可二次报销或申诉，因此仍计入待回款。
 *   遵守 StatusPill 的对比度铁律：文字永远 --foreground，状态色只落在图标上。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { CheckCircle2, Clock, HandCoins, Send, XCircle } from "lucide-react";
import clsx from "clsx";
import type { ReimbursementStatus } from "../types";

const STATUS_META: Record<
  Exclude<ReimbursementStatus, "notApplicable">,
  { label: string; icon: typeof Clock; iconClass: string }
> = {
  draft: { label: "待报销", icon: Clock, iconClass: "text-warning" },
  submitted: { label: "已提交", icon: Send, iconClass: "text-data-1" },
  rejected: { label: "已驳回", icon: XCircle, iconClass: "text-zzm-accent-ink" },
  reimbursed: { label: "已报销", icon: CheckCircle2, iconClass: "text-zzm-ok" },
};

// 行内操作是 sm 纸键；激活态只由图标颜色与 aria-pressed 表达，表格里不堆墨键
const pillShell = "zzm-btn zzm-btn--sm";

/**
 * 是否报销双按钮组。点击未激活项 = 标记为该状态；点击激活项 = 撤回待报销。
 * 已报销 与 已驳回 互斥；两者都未激活时即 待报销/已提交。
 */
export function ReimbursementActions({
  status,
  disabled,
  onMark,
  className,
}: {
  status: ReimbursementStatus;
  disabled?: boolean;
  /** 点击后希望达到的目标状态（点击激活项 = 撤回 draft） */
  onMark: (next: "reimbursed" | "rejected" | "draft") => void;
  className?: string;
}) {
  if (status === "notApplicable") return null;
  const reimbursedActive = status === "reimbursed";
  const rejectedActive = status === "rejected";
  return (
    <div className={clsx("inline-flex items-center gap-2", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onMark(reimbursedActive ? "draft" : "reimbursed")}
        title={reimbursedActive ? "回款已到账；点击撤回到待报销" : "标记为已报销（回款到账）"}
        aria-pressed={reimbursedActive}
        className={pillShell}
      >
        <CheckCircle2
          size={14}
          strokeWidth={1.5}
          className={clsx("shrink-0", reimbursedActive ? "text-zzm-ok" : "text-zzm-faint")}
          aria-hidden
        />
        已报销
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onMark(rejectedActive ? "draft" : "rejected")}
        title={rejectedActive ? "已被驳回；可二次报销或申诉，点击撤回到待报销" : "标记为已驳回（公司拒付）"}
        aria-pressed={rejectedActive}
        className={pillShell}
      >
        <XCircle
          size={14}
          strokeWidth={1.5}
          className={clsx("shrink-0", rejectedActive ? "text-zzm-accent-ink" : "text-zzm-faint")}
          aria-hidden
        />
        已驳回
      </button>
    </div>
  );
}

/** 非交互展示态：核销抽屉的候选行本身是 button，内部只能嵌 span */
export function ReimbursementStatusTag({
  status,
  className,
}: {
  status: ReimbursementStatus;
  className?: string;
}) {
  if (status === "notApplicable") return null;
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-zzm-chip px-2 text-[11px] font-medium leading-5 text-foreground",
        className,
      )}
    >
      <Icon size={12} strokeWidth={1.5} className={clsx("shrink-0", meta.iconClass)} aria-hidden />
      {meta.label}
    </span>
  );
}

export function SettlePill({
  count,
  onClick,
  className,
}: {
  /** 已挂在这笔回款名下的垫付笔数 */
  count?: number;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="核销这笔回款覆盖的垫付支出"
      className={clsx(pillShell, className)}
    >
      <HandCoins size={14} strokeWidth={1.5} className="shrink-0" aria-hidden />
      核销{count && count > 0 ? ` ${count}笔` : ""}
    </button>
  );
}
