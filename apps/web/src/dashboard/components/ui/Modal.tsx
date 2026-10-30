/**
 * [INPUT]: 依赖 React Portal、滚动锁、lucide 关闭图标、zzm.css 的纸面与键、全局弹层动效。
 * [OUTPUT]: 对外提供统一尺寸、Esc/遮罩关闭、弹窗内错误槽与固定 footer 的 Modal 原语。
 * [POS]: components/ui 的编辑弹层边界；时间补录与两域主数据表单共享，禁止页面复制遮罩逻辑。
 *   纸面卡片 16 圆角，遮罩只降亮不模糊：背景仍能认出正在操作什么。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ReactNode } from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { X } from "lucide-react";
import { useBodyScrollLock } from "../../lib/useBodyScrollLock";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  error?: ReactNode;
  size?: "sm" | "md" | "lg";
  lockScroll?: boolean;
}

// sm 与确认窗同宽 440；md / lg 给多字段表单
const sizeClass = {
  sm: "max-w-[440px]",
  md: "max-w-2xl",
  lg: "max-w-4xl",
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  error,
  size = "md",
  lockScroll = true,
}: Props) {
  useBodyScrollLock(open && lockScroll);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="关闭"
        className="animate-overlay-in absolute inset-0 cursor-default bg-[var(--zzm-overlay)]"
        onClick={onClose}
      />
      <div
        className={clsx(
          "animate-modal-in relative flex max-h-[calc(100vh-48px)] w-full flex-col overflow-hidden rounded-xl border border-[var(--zzm-hairline-strong)] bg-popover text-popover-foreground shadow-[var(--zzm-float-shadow)]",
          sizeClass[size],
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 pt-5 pb-4">
          <div className="grid gap-1">
            {title && <h2 className="text-[17px] font-bold leading-6 text-[var(--zzm-ink-strong)]">{title}</h2>}
            {description && <p className="text-[13px] leading-5 text-muted-foreground">{description}</p>}
          </div>
          <button type="button" aria-label="关闭" onClick={onClose} className="zzm-btn zzm-btn--ghost zzm-btn--icon zzm-btn--sm -mr-2">
            <X size={16} strokeWidth={1.5} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {error && (
          <p role="alert" className="mx-6 mb-3 text-[13px] leading-5 text-zzm-accent-ink">
            {error}
          </p>
        )}
        {footer && (
          <footer className="flex shrink-0 justify-end gap-2 border-t border-border bg-popover px-6 pt-4 pb-5">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
