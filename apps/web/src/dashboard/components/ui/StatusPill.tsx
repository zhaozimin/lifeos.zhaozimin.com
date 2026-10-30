/**
 * [INPUT]: 依赖 lucide 的 CheckCircle2/AlertCircle、clsx 与 --zzm-* 令牌。
 * [OUTPUT]: 对外提供 StatusPill：保存状态指示（success/warning 两种语气）。
 * [POS]: components/ui 的保存反馈原语；财务设置页头的「已保存 / 有未保存改动」消费它。
 *   它不可点，所以不长成键：无面、无光影，只有图标加一行字。
 *   对比度铁律：文字永远是墨色，状态色只落在图标上。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import clsx from "clsx";

export function StatusPill({ tone, children, className }: { tone: "success" | "warning"; children: ReactNode; className?: string }) {
  return (
    <span
      aria-live="polite"
      className={clsx(
        "inline-flex h-9 select-none items-center gap-2 whitespace-nowrap px-1 text-[13px] font-medium text-foreground",
        className,
      )}
    >
      {tone === "success" ? (
        <CheckCircle2 size={14} strokeWidth={1.5} className="shrink-0 text-zzm-ok" aria-hidden />
      ) : (
        <AlertCircle size={14} strokeWidth={1.5} className="shrink-0 text-warning" aria-hidden />
      )}
      {children}
    </span>
  );
}
