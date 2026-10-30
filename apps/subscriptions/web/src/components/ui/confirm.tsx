/**
 * [INPUT]: 依赖 @radix-ui/react-dialog
 * [OUTPUT]: 对外提供 ConfirmProvider / useConfirm，替代 window.confirm
 * [POS]: components/ui 的确认层，压在 Sheet 之上，纸面按钮不是系统蓝
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";

type AskOptions = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type AskFn = (options: AskOptions) => Promise<boolean>;

const ConfirmContext = createContext<AskFn | null>(null);

export function useConfirm(): AskFn {
  const ask = useContext(ConfirmContext);
  if (!ask) {
    throw new Error("useConfirm 必须包在 ConfirmProvider 里");
  }
  return ask;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<AskOptions>({
    title: "",
    description: "",
  });
  const resolveRef = useRef<(value: boolean) => void>(() => undefined);

  const ask: AskFn = (next) => {
    setOptions(next);
    setOpen(true);
    return new Promise((resolve) => {
      resolveRef.current = resolve;
    });
  };

  function finish(value: boolean) {
    setOpen(false);
    resolveRef.current(value);
  }

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <DialogPrimitive.Root
        open={open}
        onOpenChange={(next) => {
          if (!next) finish(false);
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="dialog-overlay confirm-overlay" />
          <DialogPrimitive.Content className="dialog-panel confirm-panel">
            <DialogPrimitive.Title className="sheet-title">{options.title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sheet-desc">
              {options.description}
            </DialogPrimitive.Description>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => finish(false)}>
                {options.cancelLabel ?? "取消"}
              </button>
              <button type="button" className="btn btn-zhu" onClick={() => finish(true)}>
                {options.confirmLabel ?? "确定"}
              </button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </ConfirmContext.Provider>
  );
}
