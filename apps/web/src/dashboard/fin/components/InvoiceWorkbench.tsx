/**
 * [INPUT]: 依赖交易的发票开具/附件投影与 finance 金额格式化。
 * [OUTPUT]: 对外提供 InvoiceWorkbench，按缺附件/已绑定/全部分组展示并回传选中交易。
 * [POS]: finance 看板的发票派生工作台；不修改发票状态，编辑交还交易流程。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText } from "lucide-react";
import type { Transaction } from "../types";
import { formatCurrency } from "../lib/format";

type Tab = "missing" | "bound" | "all";

const TAB_OPTIONS: Array<{ value: Tab; label: string; tone: string }> = [
  { value: "missing", label: "应开未上传", tone: "warning" },
  { value: "bound", label: "已上传发票", tone: "success" },
  { value: "all", label: "全部已开", tone: "neutral" },
];

export function InvoiceWorkbench({
  transactions,
  onSelectTransaction,
}: {
  transactions: Transaction[];
  onSelectTransaction?: (tx: Transaction) => void;
}) {
  const [tab, setTab] = useState<Tab>("missing");

  const groups = useMemo(() => {
    const issued = transactions.filter((tx) => tx.invoiceIssued);
    const missing = issued.filter((tx) => !tx.invoiceAttachmentId);
    const bound = issued.filter((tx) => Boolean(tx.invoiceAttachmentId));
    return { all: issued, missing, bound };
  }, [transactions]);

  const list = tab === "missing" ? groups.missing : tab === "bound" ? groups.bound : groups.all;
  const totalAmount = list.reduce((sum, tx) => sum + tx.amount, 0);

  if (groups.all.length === 0) {
    return (
      <div className="empty-state">
        在「编辑流水」时勾选「已开 / 应开发票」后，发票相关的交易会出现在这里。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 顶部 3 个汇总按钮，相当于 tabs */}
      <div className="grid grid-cols-3 gap-2">
        {TAB_OPTIONS.map((opt) => {
          const count =
            opt.value === "missing"
              ? groups.missing.length
              : opt.value === "bound"
                ? groups.bound.length
                : groups.all.length;
          const active = tab === opt.value;
          const toneClass = active
            ? opt.tone === "warning"
              ? "border-warning bg-warning/10 text-warning "
              : opt.tone === "success"
                ? "border-zzm-ok bg-zzm-ok/10 text-zzm-ok "
                : "border-zzm-accent bg-zzm-accent-soft text-zzm-accent-ink"
            : "border-border text-muted-foreground hover:border-[var(--zzm-line-hover)]";
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTab(opt.value)}
              className={`rounded-lg border p-3 text-left transition-colors ${toneClass}`}
            >
              <div className="flex items-center gap-2 text-[12px]">
                {opt.value === "missing" && <AlertTriangle size={13} />}
                {opt.value === "bound" && <CheckCircle2 size={13} />}
                {opt.value === "all" && <FileText size={13} />}
                <span>{opt.label}</span>
              </div>
              <div className="mt-1 text-[22px] font-bold leading-8 tabular-nums">{count}</div>
            </button>
          );
        })}
      </div>

      <div className="flex items-baseline justify-between gap-3 px-1 text-[12.5px] text-muted-foreground">
        <span>当前视图共 {list.length} 笔</span>
        <span>合计 <span className="font-semibold text-foreground tabular-nums">{formatCurrency(totalAmount)}</span></span>
      </div>

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
          {tab === "missing" && "✨ 没有缺发票的交易，发票工作台清空"}
          {tab === "bound" && "还没有已绑定发票附件的交易"}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full table-fixed border-collapse text-left text-[13px]">
            <colgroup>
              <col className="w-[110px]" />
              <col className="w-[70px]" />
              <col className="w-auto" />
              <col className="w-[80px]" />
              <col className="w-[120px]" />
            </colgroup>
            <thead className="bg-zzm-fill text-caption-uppercase">
              <tr>
                <th className="px-3 py-2 font-semibold">日期</th>
                <th className="px-3 py-2 font-semibold">类型</th>
                <th className="px-3 py-2 font-semibold">摘要</th>
                <th className="px-3 py-2 font-semibold">状态</th>
                <th className="px-3 py-2 text-right font-semibold">金额</th>
              </tr>
            </thead>
            <tbody>
              {list.map((tx) => (
                <tr
                  key={tx.id}
                  className={onSelectTransaction ? "cursor-pointer border-t border-border hover:bg-zzm-fill" : "border-t border-border"}
                  onClick={onSelectTransaction ? () => onSelectTransaction(tx) : undefined}
                >
                  <td className="px-3 py-2 font-mono text-[11.5px] text-muted-foreground">
                    {tx.occurredAt.slice(0, 10)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        tx.kind === "income"
                          ? "rounded border border-zzm-ok/30 bg-zzm-ok/10 px-1.5 py-0.5 text-[10.5px] text-zzm-ok "
                          : "rounded border border-zzm-accent-ink/30 bg-zzm-accent-ink/10 px-1.5 py-0.5 text-[10.5px] text-zzm-accent-ink "
                      }
                    >
                      {tx.kind === "income" ? "收入" : "支出"}
                    </span>
                  </td>
                  <td className="truncate px-3 py-2">{tx.title}</td>
                  <td className="px-3 py-2">
                    {tx.invoiceAttachmentId ? (
                      <span className="inline-flex items-center gap-1 text-[11.5px] text-zzm-ok">
                        <CheckCircle2 size={11} /> 已绑
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11.5px] text-warning">
                        <AlertTriangle size={11} /> 缺
                      </span>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right font-medium tabular-nums ${tx.kind === "income" ? "text-zzm-ok" : "text-zzm-accent-ink"}`}>
                    {tx.kind === "income" ? "+" : "−"}¥{tx.amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
