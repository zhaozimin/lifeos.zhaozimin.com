/**
 * [INPUT]: 依赖 api 的订阅更新、Subscription 与统一 Select/异步请求身份
 * [OUTPUT]: 提供 BillingModeSettings；详情中切换即保存，编辑中只更新草稿
 * [POS]: 侧栏订阅方式入口；只提交方式和原扣款日，错误贴近控件显示
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAsyncScope } from "../lib/asyncScope";
import type { BillingMode, Subscription } from "../types";
import { Select } from "./ui/select";

const OPTIONS = [
  { value: "balance", label: "余额式订阅" },
  { value: "auto_charge", label: "自动扣款订阅" },
];

export function BillingModeSettings({ item, value, editing, disabled, onDraftChange, onUpdated, onBusyChange }: {
  item: Subscription | null;
  value: BillingMode;
  editing: boolean;
  disabled: boolean;
  onDraftChange: (value: BillingMode) => void;
  onUpdated: (item: Subscription) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const scope = useAsyncScope();
  useEffect(() => { scope.invalidate(); setNotice(""); setError(""); }, [item?.id, editing]);
  useEffect(() => () => { onBusyChange(false); }, [onBusyChange]);

  async function change(next: BillingMode) {
    if (disabled || submitting.current || next === value) return;
    setNotice("");
    setError("");
    if (editing) { onDraftChange(next); return; }
    if (!item) return;
    submitting.current = true;
    setBusy(true);
    onBusyChange(true);
    const alive = scope.begin();
    try {
      const updated = await api.updateSubscription(item.id, {
        billing_mode: next, expected_next_renewal_on: item.next_renewal_on,
      });
      if (!alive()) return;
      onUpdated(updated);
      setNotice(`已切换为${OPTIONS.find((option) => option.value === updated.billing_mode)?.label}，已保存。`);
    } catch (err) {
      if (alive()) setError(err instanceof Error ? err.message : "切换失败，请重试。");
    } finally {
      submitting.current = false;
      if (alive()) { setBusy(false); onBusyChange(false); }
    }
  }

  return (
    <div>
      <label className="block">
        <span className="field-label">订阅方式</span>
        <Select disabled={disabled || busy || (!editing && !item)} value={value}
          onValueChange={(next) => void change(next as BillingMode)} options={OPTIONS} />
      </label>
      <p className="caption mt-2">
        {editing ? "修改后点保存或更新。余额和当前状态保留。" : "直接切换，立即保存。余额和当前状态保留。"}
      </p>
      <p className="caption mt-1">
        {value === "balance" ? "充值后按订阅周期抵扣。"
          : "绑定信用卡后按周期更新续费记录，实际扣款由订阅服务商执行。"}
      </p>
      {busy ? <p className="caption mt-2" role="status">正在保存订阅方式…</p>
        : notice ? <p className="caption mt-2" role="status">{notice}</p> : null}
      {error ? <p className="error-text mt-2" role="alert">{error}</p> : null}
    </div>
  );
}
