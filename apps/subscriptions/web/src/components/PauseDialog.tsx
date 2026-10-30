/**
 * [INPUT]: 依赖 ui/dialog 的居中弹窗，依赖 types 的订阅形状
 * [OUTPUT]: 对外提供 PauseDialog。回传「剩余期限留不留」，不自己发请求
 * [POS]: components 的暂停时点选择器，只被 Editor 的暂停按钮唤起。写库在 store，日期算术在 clock
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useState } from "react";
import type { Subscription } from "../types";
import { Dialog } from "./ui/dialog";

/**
 * 暂停只有一个变量：这一期剩下的天数留不留。
 * 留 = 立即冻结剩余天数，恢复时原样还回来；
 * 不留 = 在本机标记停用，剩余作废，恢复时按重订一期算。
 * 已经过期的没有剩余可留，不问，直接停。
 */
export function PauseDialog({
  item,
  open,
  busy,
  onOpenChange,
  onConfirm,
}: {
  item: Subscription;
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (keepRemaining: boolean) => void;
}) {
  const remaining = item.days_left;
  const hasRemainder = remaining > 0;
  const [keep, setKeep] = useState(true);

  useEffect(() => {
    if (open) setKeep(hasRemainder);
  }, [open, hasRemainder]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`暂停 ${item.name}`}
      description="记录留着，倒计时停住。以后想续订，点恢复就回来。"
    >
      {hasRemainder ? (
        <div className="pause-choices" role="radiogroup" aria-label="从什么时候停">
          <PauseChoice
            checked={keep}
            onPick={() => setKeep(true)}
            title="暂停并保留剩余天数"
            hint={`现在冻结剩余 ${remaining} 天，恢复时从当天重新计算。这只修改本机记录，请自行核对服务商是否支持暂停。`}
          />
          <PauseChoice
            checked={!keep}
            onPick={() => setKeep(false)}
            title="暂停并放弃剩余天数"
            hint={`在本机标记停用，剩下的 ${remaining} 天作废。恢复时从那天起重新算一期。`}
          />
        </div>
      ) : (
        <p className="text-[13px] text-[var(--muted)]">
          这一期已经走完，没有剩余期限可留。恢复时从那天起重新算一期。
        </p>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn" onClick={() => onOpenChange(false)}>
          取消
        </button>
        <button
          type="button"
          className="btn btn-zhu disabled:opacity-50"
          disabled={busy}
          onClick={() => onConfirm(hasRemainder ? keep : false)}
        >
          暂停订阅
        </button>
      </div>
    </Dialog>
  );
}

function PauseChoice({
  checked,
  onPick,
  title,
  hint,
}: {
  checked: boolean;
  onPick: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onPick}
      className={checked ? "pause-choice is-picked" : "pause-choice"}
    >
      <span className="pause-choice-dot" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-[14px] font-medium text-[var(--ink)]">{title}</span>
        <span className="mt-1 block text-[12px] leading-relaxed text-[var(--muted)]">{hint}</span>
      </span>
    </button>
  );
}
