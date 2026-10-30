/**
 * [INPUT]: 依赖 api 余额动作、Subscription 与统一 Dialog/异步请求身份
 * [OUTPUT]: 提供 BalanceSettings，支持充值、校准与父级提交互斥通知
 * [POS]: 右侧设置面板的余额入口；按订阅周期说明抵扣，重试沿用充值编号
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAsyncScope } from "../lib/asyncScope";
import { yuan } from "../lib/format";
import type { Subscription } from "../types";
import { Dialog } from "./ui/dialog";

type BalanceAction = "top-up" | "set";
const TOP_UP_AMOUNTS = ["50", "100"];

export function BalanceSettings({ item, onUpdated, onBusyChange, disabled = false }: {
  item: Subscription;
  onUpdated?: (item: Subscription) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [current, setCurrent] = useState(item);
  const [dialog, setDialog] = useState<BalanceAction | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const pending = useRef<{ amount: string; requestId: string } | null>(null);
  const scope = useAsyncScope();
  useEffect(() => { setCurrent(item); }, [item]);
  useEffect(() => () => { onBusyChange?.(false); }, [onBusyChange]);

  if (item.billing_mode !== "balance") return null;
  const unavailable = busy || disabled;

  function open(action: BalanceAction) {
    setAmount(action === "set" ? current.balance_yuan ?? "" : "");
    setError("");
    setDialog(action);
  }

  async function submit(action: BalanceAction, value: string) {
    if (submitting.current || disabled) return;
    const normalized = value.trim();
    if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(normalized) || (action === "top-up" && Number(normalized) <= 0)) {
      setError(action === "top-up" ? "请输入大于 0 的金额，最多两位小数。" : "请输入不小于 0 的余额，最多两位小数。");
      return;
    }
    submitting.current = true;
    onBusyChange?.(true);
    setBusy(true);
    setError("");
    const alive = scope.begin();
    try {
      let updated: Subscription;
      if (action === "top-up") {
        if (pending.current?.amount !== normalized) {
          pending.current = { amount: normalized, requestId: crypto.randomUUID() };
        }
        updated = await api.topUpBalance(item.id, normalized, pending.current.requestId);
        pending.current = null;
      } else {
        updated = await api.setBalance(item.id, normalized);
      }
      if (!alive()) return;
      setCurrent(updated);
      setDialog(null);
      onUpdated?.(updated);
    } catch (err) {
      if (alive()) setError(err instanceof Error ? err.message : "余额更新失败，请重试。");
    } finally {
      submitting.current = false;
      if (alive()) { setBusy(false); onBusyChange?.(false); }
    }
  }

  return (
    <div className="phone-balance">
      <div className="flex items-baseline justify-between gap-2">
        <span className="money meta">
          余额 {current.balance_yuan == null ? "未设置" : yuan(current.balance_yuan)}
        </span>
        <button type="button" className="caption" disabled={unavailable} onClick={() => open("set")}>
          {current.balance_yuan == null ? "设置余额" : "校准余额"}
        </button>
      </div>
      <p className={`caption mt-1${current.balance_low ? " text-[var(--zhu-text)]" : ""}`}>
        {current.balance_stopped ? "余额不足，已停止；充足后自动恢复。"
          : current.balance_yuan == null ? "设置或充值后，按订阅周期自动抵扣。"
          : current.status !== "active" ? "当前已停止，余额保留。"
          : !current.auto_renew ? "自动续费已关闭，余额保留。"
          : current.balance_low ? `${current.next_renewal_on} 余额不足将停止。`
          : current.amount_fen === 0 ? "当前订阅费为 0，余额不扣减。"
          : `可抵扣 ${current.balance_cycles} 个周期`}
      </p>
      <div className="phone-balance-actions" role="group" aria-label={`${item.name}充值`}>
        {TOP_UP_AMOUNTS.map((value) => (
          <button key={value} type="button" className="btn" disabled={unavailable} onClick={() => void submit("top-up", value)}>
            +{value}
          </button>
        ))}
        <button type="button" className="btn" disabled={unavailable} onClick={() => open("top-up")}>
          自定义
        </button>
      </div>
      {busy ? <p className="caption mt-2" role="status">正在更新余额…</p> : null}
      {error && !dialog ? <p className="error-text mt-2" role="alert">{error}</p> : null}
      <Dialog open={dialog !== null} onOpenChange={(next) => { if (!busy && !next) setDialog(null); }}
        title={dialog === "set" ? "设置当前余额" : "自定义充值"}
        description={dialog === "set" ? "填写当前实际余额，将替换记录的余额。" : "增加记录的余额；因余额不足停止时，充足后扣除一期费用并从今天恢复。"}>
        <label className="field-label">
          {dialog === "set" ? "当前余额（元）" : "充值金额（元）"}
          <input className="field mt-2" inputMode="decimal" autoComplete="off" autoFocus value={amount} disabled={busy}
            onChange={(event) => setAmount(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && dialog) { event.preventDefault(); void submit(dialog, amount); } }}
            placeholder={dialog === "set" ? "例如 28.50" : "输入金额"} />
        </label>
        {error ? <p className="error-text mt-2" role="alert">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn" disabled={busy} onClick={() => setDialog(null)}>取消</button>
          <button type="button" className="btn btn-zhu" disabled={busy || !amount.trim()}
            onClick={() => { if (dialog) void submit(dialog, amount); }}>
            {busy ? "更新中…" : dialog === "set" ? "保存余额" : "确认充值"}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
