/**
 * [INPUT]: 依赖 @radix-ui/react-dialog
 * [OUTPUT]: 对外提供居中 Dialog，进出带动画与毛玻璃
 * [POS]: components/ui 的短表单弹窗，Sheet 留给长编辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content className="dialog-panel">
          <DialogPrimitive.Title className="sheet-title">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="sheet-desc">{description}</DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">对话框</DialogPrimitive.Description>
          )}
          <DialogPrimitive.Close className="sheet-x" aria-label="关闭">
            ×
          </DialogPrimitive.Close>
          <div className="mt-5">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
