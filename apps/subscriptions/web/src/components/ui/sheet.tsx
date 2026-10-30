/**
 * [INPUT]: 依赖 @radix-ui/react-dialog 的焦点陷阱与 Esc / 点遮罩关闭
 * [OUTPUT]: 对外提供 Sheet / SheetContent / Header / Title / Description / Footer / Close
 * [POS]: 对齐 shadcn Sheet 的组合；遮罩是毛玻璃，面板从右侧滑出
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { ComponentPropsWithoutRef, HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;
export const SheetPortal = Dialog.Portal;

export function SheetOverlay({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Dialog.Overlay>) {
  return <Dialog.Overlay className={cn("sheet-overlay", className)} {...props} />;
}

export function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: ComponentPropsWithoutRef<typeof Dialog.Content> & {
  side?: "right" | "left";
  children?: ReactNode;
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <Dialog.Content
        className={cn("sheet-panel", side === "left" && "sheet-panel-left", className)}
        {...props}
      >
        {children}
        <Dialog.Close className="sheet-x" aria-label="关闭">
          ×
        </Dialog.Close>
      </Dialog.Content>
    </SheetPortal>
  );
}

export function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("sheet-header", className)} {...props} />;
}

export function SheetFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("sheet-footer", className)} {...props} />;
}

export function SheetTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Dialog.Title>) {
  return <Dialog.Title className={cn("sheet-title", className)} {...props} />;
}

export function SheetDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Dialog.Description>) {
  return <Dialog.Description className={cn("sheet-desc", className)} {...props} />;
}
