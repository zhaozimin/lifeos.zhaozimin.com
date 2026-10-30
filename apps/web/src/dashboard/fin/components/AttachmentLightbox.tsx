/**
 * [INPUT]: 依赖附件投影、带鉴权图像、finance API 删除能力、Portal 与共享确认弹层。
 * [OUTPUT]: 对外提供 AttachmentLightbox，支持键盘/按钮切换、关闭与经确认的附件删除回调。
 * [POS]: finance 附件的全屏检视边界；只管当前附件集，交易列表刷新交还调用方。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Trash2, X } from "lucide-react";
import { api } from "../api/client";
import { AuthedImage } from "./AuthedImage";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";
import { AlertDialog } from "./ui/AlertDialog";
import type { AttachmentRef } from "../types";

interface Props {
  open: boolean;
  attachments: AttachmentRef[];
  initialIndex?: number;
  onClose: () => void;
  onDelete?: (id: string) => void; // optional — callers may want to refresh tx list
}

export function AttachmentLightbox({ open, attachments, initialIndex = 0, onClose, onDelete }: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [failMessage, setFailMessage] = useState<string | null>(null);
  useBodyScrollLock(open);

  useEffect(() => {
    if (open) setIndex(Math.min(initialIndex, Math.max(0, attachments.length - 1)));
  }, [open, initialIndex, attachments.length]);

  const next = useCallback(() => {
    if (attachments.length === 0) return;
    setIndex((i) => (i + 1) % attachments.length);
  }, [attachments.length]);
  const prev = useCallback(() => {
    if (attachments.length === 0) return;
    setIndex((i) => (i - 1 + attachments.length) % attachments.length);
  }, [attachments.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, next, prev]);

  if (!open || typeof document === "undefined" || attachments.length === 0) return null;

  const current = attachments[index];

  const performDelete = async () => {
    if (!current || busy) return;
    setBusy(true);
    try {
      await api.deleteAttachment(current.id);
      setConfirmOpen(false);
      onDelete?.(current.id);
      // 自动跳到下一张或关闭
      if (attachments.length <= 1) {
        onClose();
      } else {
        setIndex((i) => Math.min(i, attachments.length - 2));
      }
    } catch (err) {
      setConfirmOpen(false);
      setFailMessage((err as Error).message || "未知错误");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center" role="dialog" aria-modal="true">
      <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/85" onClick={onClose} />

      {/* Top bar */}
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between gap-3 px-5 py-3 text-white">
        <div className="min-w-0 truncate text-[13px] font-medium">
          {current.originalName}
          <span className="ml-2 text-[12px] text-white/55">
            {(current.sizeBytes / 1024).toFixed(1)} KB · {index + 1} / {attachments.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => current && !busy && setConfirmOpen(true)}
            disabled={busy}
            title="删除附件"
            aria-label="删除附件"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-white/85 hover:bg-white/10 hover:text-zzm-accent-ink disabled:cursor-not-allowed disabled:text-zzm-muted"
          >
            <Trash2 size={16} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="关闭"
            aria-label="关闭"
            className="zzm-btn zzm-btn--ondark zzm-btn--icon"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Image */}
      <div className="relative z-0 flex max-h-full max-w-full items-center justify-center px-12 py-16">
        {current.mime?.startsWith("image/") ? (
          <AuthedImage
            id={current.id}
            alt={current.originalName}
            className="max-h-[85vh] max-w-[85vw] object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-lg bg-white/10 px-8 py-10 text-white">
            <span className="text-[14px]">无法在此预览此类附件</span>
            <button
              type="button"
              onClick={async () => {
                const blob = await api.fetchAttachmentBlob(current.id);
                const objUrl = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = objUrl;
                a.download = current.originalName;
                a.click();
                URL.revokeObjectURL(objUrl);
              }}
              className="text-[13px] underline underline-offset-4"
            >
              下载 {current.originalName}
            </button>
          </div>
        )}
      </div>

      {/* Prev / next */}
      {attachments.length > 1 && (
        <>
          <button
            type="button"
            onClick={prev}
            aria-label="上一张"
            className="zzm-btn zzm-btn--ondark zzm-btn--icon zzm-btn--lg absolute left-3 top-1/2 z-10 -translate-y-1/2"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="下一张"
            className="zzm-btn zzm-btn--ondark zzm-btn--icon zzm-btn--lg absolute right-3 top-1/2 z-10 -translate-y-1/2"
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}

      <AlertDialog
        open={confirmOpen}
        tone="destructive"
        title="删除附件"
        description={`确定删除附件「${current.originalName}」？此操作不可恢复。`}
        confirmLabel="删除"
        busy={busy}
        onConfirm={performDelete}
        onCancel={() => setConfirmOpen(false)}
      />
      <AlertDialog
        open={failMessage !== null}
        title="删除失败"
        description={failMessage}
        confirmLabel="知道了"
        onConfirm={() => setFailMessage(null)}
      />
    </div>,
    document.body,
  );
}
