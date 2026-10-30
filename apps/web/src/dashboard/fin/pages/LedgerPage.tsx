/**
 * [INPUT]: 依赖账本 API、Layout 的软刷新信号、交易类型、筛选工具与编辑/附件组件、
 *   lib/financeAnalytics 聚合、lib/reimbursement 判定、ReimbursementSettleSheet 回款核销抽屉。
 * [OUTPUT]: 对外提供 LedgerPage，展示有效流水、灰色删除线修改版本和可审计的已删除流水；报销 tab 提供
 *   垫付清单（默认待回款、不受时间区间限制）、行内快捷标记与回款核销入口。
 * [POS]: web-dashboard 的流水工作台；删除对象仍留在原日期组内但不参与金额汇总。
 * 访客复用原版展示；编辑与私人修改痕迹保持本人权限。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowLeftRight, ArrowUpRight, Eye, History, Pencil, Plus, Search } from "lucide-react";
import { useRefreshSignal } from "../../components/Layout";
import { RevisionHistoryModal } from "../../components/RevisionHistoryModal";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { CategoryTabs } from "../../components/ui/Tabs";
import { TextInput } from "../../components/ui/TextInput";
import { TransactionEditSheet } from "../components/TransactionEditSheet";
import { AttachmentLightbox } from "../components/AttachmentLightbox";
import { ReimbursementSettleSheet } from "../components/ReimbursementSettleSheet";
import { FinTimeRangeBar } from "../components/FinTimeRangeBar";
import { AlertDialog } from "../components/ui/AlertDialog";
import { ReimbursementActions, ReimbursementStatusTag, SettlePill } from "../components/ReimbursementPill";
import type { AttachmentRef } from "../types";
import { api } from "../api/client";
import { useApi } from "../lib/useApi";
import { formatCurrency, privateValue } from "../lib/format";
import { useTimeRangeStore } from "../store/timeRange";
import { dailyGroups, filterTransactions, summarizeTransactions } from "../lib/financeAnalytics";
import { isPendingReimbursement, isReimbursable, isReimbursementIncome } from "../lib/reimbursement";
import type { Transaction, TransactionKind } from "../types";

type KindFilter = "all" | TransactionKind | "adjustment" | "reimbursement";
// 报销状态桶：待报销=未出结果(draft+submitted) / 已驳回 / 已报销 / 全部
type ReimbFilter = "pending" | "rejected" | "reimbursed" | "all";

const KIND_OPTIONS: Array<{ value: KindFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "income", label: "收入" },
  { value: "expense", label: "支出" },
  { value: "transfer", label: "转账" },
  { value: "adjustment", label: "余额调整" },
  { value: "reimbursement", label: "报销" },
];

const REIMB_FILTER_OPTIONS: Array<{ value: ReimbFilter; label: string }> = [
  { value: "pending", label: "待报销" },
  { value: "rejected", label: "已驳回" },
  { value: "reimbursed", label: "已报销" },
  { value: "all", label: "全部" },
];


const KIND_LABEL: Record<TransactionKind, string> = {
  income: "收入",
  expense: "支出",
  transfer: "转账",
};

// 支出不是错误，不标朱色；收入用成功墨绿，转账用第一数据色
const KIND_TONE: Record<TransactionKind, "success" | "neutral" | "brand-blue"> = {
  income: "success",
  expense: "neutral",
  transfer: "brand-blue",
};

const KIND_ICON: Record<TransactionKind, ReactNode> = {
  income: <ArrowDownRight size={12} strokeWidth={1.5} />,
  expense: <ArrowUpRight size={12} strokeWidth={1.5} />,
  transfer: <ArrowLeftRight size={12} strokeWidth={1.5} />,
};

import {useAccess} from "../../../access";
export function LedgerPage() {
  const {owner}=useAccess();
  const dimension = useTimeRangeStore((s) => s.dimension);
  const bucket = useTimeRangeStore((s) => s.bucket);
  const refreshKey = useRefreshSignal();
  const [kind, setKind] = useState<KindFilter>("all");
  const [search, setSearch] = useState("");
  const [reimbFilter, setReimbFilter] = useState<ReimbFilter>("pending");
  const [settleIncome, setSettleIncome] = useState<Transaction | null>(null);
  const [quickBusyId, setQuickBusyId] = useState<string | null>(null);
  const [quickError, setQuickError] = useState<string | null>(null);

  const [editTarget, setEditTarget] = useState<Transaction | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    const target = sessionStorage.getItem("ledger-search-q");
    if (target) {
      setSearch(target);
      sessionStorage.removeItem("ledger-search-q");
    }
  }, []);
  const [lightboxAttachments, setLightboxAttachments] = useState<AttachmentRef[]>([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const { data: configuration } = useApi(() => api.configuration(), [refreshKey]);
  const { data: transactionData, loading, refresh } = useApi(
    // 报销 tab 扫全历史，仅要求包含已删除记录，不设数量上限。
    () => api.listTransactions({ includeDeleted: 1 }),
    [refreshKey],
  );
  const currentMonth = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);
  const { data: budgetStatus } = useApi(
    () => api.budgetStatus({ month: currentMonth }),
    [currentMonth, refreshKey],
  );
  const { data: auditData, error: auditError, loading: auditLoading } = useApi(
    () => api.auditEvents(),
    [refreshKey],
  );

  const accounts = configuration?.accounts || [];
  const transactions = transactionData || [];
  // 报销 tab 下快捷按钮独立成列；其他 tab 保持行内紧凑形态
  const showReimbCol = kind === "reimbursement";
  const filtered = useMemo(() => {
    let items: Transaction[];
    if (kind === "reimbursement") {
      // 报销视图是"欠账清单"而非区间报表：忽略时间区间，扫全历史，防止老垫付被区间滤掉
      items = transactions.filter((tx) => !tx.deletedAt && isReimbursable(tx));
      if (reimbFilter === "pending") {
        // 待报销 = 还没出结果：未上报(draft)+ 已提交等结果(submitted)，不含已驳回/已报销
        items = items.filter((tx) => tx.reimbursementStatus === "draft" || tx.reimbursementStatus === "submitted");
      } else if (reimbFilter === "rejected") {
        items = items.filter((tx) => tx.reimbursementStatus === "rejected");
      } else if (reimbFilter === "reimbursed") {
        items = items.filter((tx) => tx.reimbursementStatus === "reimbursed");
      }
    } else {
      items = filterTransactions(transactions, accounts, "combined", dimension, bucket);
      if (kind === "adjustment") {
        items = items.filter((tx) => tx.source === "adjustment");
      } else if (kind !== "all") {
        items = items.filter((tx) => tx.kind === kind);
      }
    }
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      items = items.filter((tx) =>
        [tx.title, tx.merchant, tx.note, tx.accountName, tx.category?.name, tx.projectName, ...(tx.tags || [])]
          .filter(Boolean)
          .some((item) => String(item).toLowerCase().includes(needle)),
      );
    }
    return items;
  }, [accounts, bucket, dimension, kind, reimbFilter, search, transactions]);

  const stats = useMemo(() => summarizeTransactions(filtered.filter((tx) => !tx.deletedAt)), [filtered]);
  // 报销总览：不随二级筛选变化，始终显示全貌
  const reimbStats = useMemo(() => {
    const all = transactions.filter((tx) => !tx.deletedAt && isReimbursable(tx));
    const pending = all.filter(isPendingReimbursement);
    const reimbursed = all.filter((tx) => tx.reimbursementStatus === "reimbursed");
    const sum = (items: Transaction[]) => items.reduce((total, tx) => total + tx.amount, 0);
    return {
      total: all.length,
      pendingCount: pending.length,
      pendingSum: sum(pending),
      reimbursedSum: sum(reimbursed),
    };
  }, [transactions]);
  const groups = useMemo(
    () => dailyGroups(filtered).map((group) => ({
      ...group,
      summary: summarizeTransactions(group.items.filter((tx) => !tx.deletedAt)),
    })),
    [filtered],
  );

  const onSaved = () => {
    setEditorOpen(false);
    setEditTarget(null);
    refresh();
  };

  const onDeleted = () => {
    setEditorOpen(false);
    setEditTarget(null);
    refresh();
  };

  // 快捷标记：已报销/已驳回 双按钮，点击激活项撤回待报销（目标状态由按钮组计算）
  const onQuickMark = async (tx: Transaction, next: "reimbursed" | "rejected" | "draft") => {
    if (quickBusyId) return;
    setQuickBusyId(tx.id);
    try {
      await api.updateReimbursement(tx.id, next);
      refresh();
    } catch (err) {
      setQuickError(err instanceof Error ? err.message : "报销状态更新失败，请重试");
    } finally {
      setQuickBusyId(null);
    }
  };

  // 每笔回款名下已核销的垫付笔数（核销按钮角标）
  const settledCountByIncome = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of transactions) {
      if (!tx.deletedAt && tx.reimbursedBy) {
        map.set(tx.reimbursedBy, (map.get(tx.reimbursedBy) || 0) + 1);
      }
    }
    return map;
  }, [transactions]);

  return (
    <div className="space-y-5">
      <FinTimeRangeBar transactions={transactions} />
      <Card padding="none">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-title-lg">流水</h2>
            <p className="text-caption mt-1">
              按日期汇总当前区间内的收支记录。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CategoryTabs value={kind} onChange={setKind} options={KIND_OPTIONS} variant="pills" />
            <Button disabled={!owner} variant="ghost" leading={<History size={14} strokeWidth={1.5} />} onClick={() => setHistoryOpen(true)}>
              修改痕迹
            </Button>
            <Button
              disabled={!owner}
              leading={<Plus size={14} strokeWidth={1.5} />}
              onClick={() => {
                setEditTarget(null);
                setEditorOpen(true);
              }}
            >
              新增交易
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-[1fr_260px]">
          {kind === "reimbursement" ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <SmallStat label="垫付总笔数" value={reimbStats.total} />
              <SmallStat label="待回款笔数" value={reimbStats.pendingCount} tone={reimbStats.pendingCount > 0 ? "warning" : "neutral"} />
              <SmallStat label="待回款金额" value={formatCurrency(reimbStats.pendingSum)} tone={reimbStats.pendingSum > 0 ? "warning" : "neutral"} />
              <SmallStat label="已回款金额" value={formatCurrency(reimbStats.reimbursedSum)} tone="success" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <SmallStat label="记录天数" value={stats.dayCount} />
              <SmallStat label="记录条数" value={stats.count} />
              <SmallStat label="区间收入" value={formatCurrency(stats.income)} tone="success" />
              <SmallStat label="内部转账" value={formatCurrency(stats.transfer)} />
              <SmallStat
                label="区间净额"
                value={formatCurrency(stats.net)}
                tone={stats.net > 0 ? "success" : stats.net < 0 ? "warning" : "neutral"}
              />
            </div>
          )}
          <TextInput
            label="搜索"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="标题 / 商户 / 账户 / 分类"
            leading={<Search size={14} strokeWidth={1.5} />}
          />
        </div>
        {kind === "expense" && budgetStatus && budgetStatus.items.length > 0 && (
          <BudgetMiniBar
            totalBudget={budgetStatus.totalBudget}
            totalSpent={budgetStatus.totalSpent}
            month={budgetStatus.month}
          />
        )}
        {kind === "reimbursement" && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
            <div className="flex items-center gap-2">
              {REIMB_FILTER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setReimbFilter(option.value)}
                  className={`zzm-btn zzm-btn--sm ${reimbFilter === option.value ? "zzm-btn--accent" : ""}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <span className="text-[12px] leading-4 text-zzm-muted">
              报销视图扫描全部历史，不受时间区间限制；已驳回可二次报销，仍计入待回款；点击激活的按钮可撤回待报销
            </span>
          </div>
        )}
      </Card>

      {loading && !transactionData && <div aria-label="正在读取流水" className="zzm-skel h-[360px] rounded-xl" />}
      {!loading && groups.length === 0 && (
        <Card>
          <div className="empty-state">
            {transactions.length === 0
              ? "还没有流水。点右上角「新增交易」记第一笔，或对你的 AI 记账员说：「午饭 50，走微信」。"
              : "当前筛选下暂无流水，试试放宽时间区间或切换类型。"}
          </div>
        </Card>
      )}

      {groups.map((group) => (
        <Card key={group.date} padding="none">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-title-lg tabular-nums">{group.date.replaceAll("-", ".")}</h2>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <Pill label="收入" value={formatCurrency(group.summary.income)} tone={group.summary.income > 0 ? "success" : "neutral"} />
              <Pill label="支出" value={formatCurrency(group.summary.expense)} tone="neutral" />
              <Pill label="转账" value={formatCurrency(group.summary.transfer)} tone="neutral" />
              <Pill
                label="净额"
                value={formatCurrency(group.summary.net)}
                tone={group.summary.net > 0 ? "success" : "neutral"}
              />
            </div>
          </div>

          <div>
            <table className="w-full table-fixed border-collapse text-left">
              <colgroup>
                <col className="w-[60px]" />
                <col className="w-[82px]" />
                <col />
                <col />
                <col className="w-[104px]" />
                <col className="w-[92px]" />
                {showReimbCol && <col className="w-[172px]" />}
                <col className="w-[44px]" />
                <col className="w-[44px]" />
                <col className="w-[118px]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border text-caption-uppercase [&>th]:font-normal">
                  <th className="px-3 py-3 font-semibold">时间</th>
                  <th className="px-2 py-3 font-semibold">类型</th>
                  <th className="px-3 py-3 font-semibold">摘要</th>
                  <th className="px-3 py-3 font-semibold">账户</th>
                  <th className="px-3 py-3 font-semibold">分类</th>
                  <th className="px-3 py-3 font-semibold">项目</th>
                  {showReimbCol && <th className="px-2 py-3 font-semibold">是否报销</th>}
                  <th className="px-1 py-3 text-center font-semibold">附件</th>
                  <th className="px-1 py-3 text-center font-semibold">编辑</th>
                  <th className="px-3 py-3 text-right font-semibold">金额</th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((tx) => (
                  <tr key={tx.id} className={`border-b border-border last:border-0 transition-colors hover:bg-zzm-fill ${tx.deletedAt ? "bg-zzm-fill text-muted-foreground" : ""}`}>
                    <td className="px-3 py-3 text-mono text-muted-foreground">{owner?tx.occurredAt.slice(11, 16):"••:••"}</td>
                    <td className="px-2 py-3">
                      <Badge tone={KIND_TONE[tx.kind]} className="gap-1">
                        {KIND_ICON[tx.kind]}
                        {KIND_LABEL[tx.kind]}
                      </Badge>
                      {!showReimbCol && isReimbursable(tx) && !tx.deletedAt && (
                        <ReimbursementStatusTag status={tx.reimbursementStatus} className="mt-1" />
                      )}
                      {isReimbursementIncome(tx) && !tx.deletedAt && (
                        <SettlePill
                          count={settledCountByIncome.get(tx.id)}
                          onClick={() => setSettleIncome(tx)}
                          className="mt-1"
                        />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => {
                          if(!owner)return;
                          setEditTarget(tx);
                          setEditorOpen(true);
                        }}
                        disabled={!owner}
                        className={`block max-w-full truncate text-left font-semibold ${tx.deletedAt ? "text-muted-foreground line-through" : "text-foreground hover:underline hover:underline-offset-4"}`}
                      >
                        {tx.title}
                      </button>
                      {tx.merchant && tx.merchant !== tx.title && (
                        <div className="truncate text-caption">{tx.merchant}</div>
                      )}
                      {tx.deletedAt && (
                        <div className="mt-1 text-[11.5px] text-zzm-muted">
                          已由 {tx.deletedBy || "Agent"} 删除 · {new Date(tx.deletedAt).toLocaleString("zh-CN")}
                        </div>
                      )}
                    </td>
                    <td className="truncate px-3 py-3 text-body-sm text-muted-foreground">
                      {tx.kind === "transfer"
                        ? `${tx.fromAccountName || "?"} → ${tx.toAccountName || "?"}`
                        : tx.accountName}
                    </td>
                    <td className="truncate px-3 py-3 text-body-sm">{tx.category?.name || "未分类"}</td>
                    <td className="truncate px-3 py-3 text-body-sm text-muted-foreground">{tx.projectName || "—"}</td>
                    {showReimbCol && (
                      <td className="px-2 py-3">
                        {isReimbursable(tx) && !tx.deletedAt ? (
                          <ReimbursementActions
                            status={tx.reimbursementStatus}
                            disabled={quickBusyId === tx.id}
                            onMark={(next) => onQuickMark(tx, next)}
                          />
                        ) : (
                          <span className="text-[12px] text-zzm-faint">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-1 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {(tx.attachments?.length || 0) > 0 ? (
                          <button
                            type="button"
                            onClick={() => {
                              setLightboxAttachments(tx.attachments || []);
                              setLightboxOpen(true);
                            }}
                            title={`查看 ${tx.attachments!.length} 个附件`}
                            aria-label={`查看 ${tx.attachments!.length} 个附件`}
                            className="zzm-btn zzm-btn--ghost zzm-btn--icon zzm-btn--sm relative"
                          >
                            <Eye size={14} strokeWidth={1.5} />
                            {tx.attachments!.length > 1 && (
                              <span className="absolute -top-1 -right-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-primary px-[3px] text-[9px] font-semibold leading-none text-primary-foreground">
                                {tx.attachments!.length}
                              </span>
                            )}
                          </button>
                        ) : (
                          <span className="text-[12px] text-zzm-faint">—</span>
                        )}
                        {tx.invoiceIssued && !tx.invoiceAttachmentId && (
                          <span
                            title="缺发票附件"
                            className="rounded-full bg-warning/15 px-1.5 text-[10px] font-semibold leading-4 text-warning"
                          >
                            缺
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-1 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => {
                          if(!owner)return;
                          setEditTarget(tx);
                          setEditorOpen(true);
                        }}
                        title="编辑"
                        aria-label="编辑"
                        disabled={!owner}
                        className="zzm-btn zzm-btn--ghost zzm-btn--icon zzm-btn--sm"
                      >
                        <Pencil size={14} strokeWidth={1.5} />
                      </button>
                    </td>
                    <td className={`px-3 py-3 text-right text-[14.5px] font-semibold tabular-nums ${tx.deletedAt ? "text-muted-foreground line-through" : tx.kind === "income" ? "text-zzm-ok" : tx.kind === "expense" ? "text-foreground" : "text-muted-foreground"}`}>
                      {tx.kind === "expense" ? "−" : tx.kind === "income" ? "+" : ""}
                      {formatCurrency(tx.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      <TransactionEditSheet
        open={editorOpen}
        initial={editTarget}
        onClose={() => {
          setEditorOpen(false);
          setEditTarget(null);
        }}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />

      <AttachmentLightbox
        open={lightboxOpen}
        attachments={lightboxAttachments}
        onClose={() => {
          setLightboxOpen(false);
          setLightboxAttachments([]);
        }}
        onDelete={() => {
          setLightboxOpen(false);
          setLightboxAttachments([]);
          refresh();
        }}
      />

      <ReimbursementSettleSheet
        open={settleIncome !== null}
        income={settleIncome}
        transactions={transactions}
        onClose={() => setSettleIncome(null)}
        onSettled={() => {
          setSettleIncome(null);
          refresh();
        }}
      />

      <AlertDialog
        open={quickError !== null}
        title="操作失败"
        description={quickError}
        confirmLabel="知道了"
        onConfirm={() => setQuickError(null)}
      />
      <RevisionHistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} events={auditData?.events || []} loading={auditLoading} error={auditError?.message || ""} entityType="transaction" />
    </div>
  );
}

function BudgetMiniBar({
  totalBudget,
  totalSpent,
  month,
}: {
  totalBudget: number;
  totalSpent: number;
  month: string;
}) {
  const percent = totalBudget > 0 ? Math.min(100, (totalSpent / totalBudget) * 100) : 0;
  const overflow = totalBudget > 0 && totalSpent > totalBudget;
  const remaining = totalBudget - totalSpent;
  const fill = overflow ? "bg-zzm-accent" : percent > 80 ? "bg-warning" : "bg-foreground";
  const text = overflow ? "font-semibold text-zzm-accent-ink" : percent > 80 ? "text-warning" : "text-muted-foreground";
  return (
    <div className="border-t border-border px-5 py-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-caption">{month} 总预算进度</span>
        <span className={`text-[12.5px] leading-5 tabular-nums ${text}`}>
          {formatCurrency(totalSpent)} / {formatCurrency(totalBudget)} · {privateValue(percent.toFixed(1)+"%")}
          {overflow ? ` · 超支 ${formatCurrency(-remaining)}` : ` · 剩余 ${formatCurrency(remaining)}`}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-[2px] bg-[var(--zzm-hairline-2)]">
        <div className={`h-full rounded-[2px] ${fill}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function SmallStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "success" | "warning";
}) {
  // warning＝待回款，需要你处理，所以用朱字
  const color = { neutral: "text-foreground", success: "text-zzm-ok", warning: "text-zzm-accent-ink" }[tone];
  return (
    <div className="rounded-lg bg-zzm-fill p-4">
      <div className="text-caption-uppercase">{label}</div>
      <div className={`mt-2 text-display-sm tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

// 日汇总是只读信息：不做成键，只是一行「标签 数值」
function Pill({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success";
}) {
  const valueClass = { neutral: "text-foreground", success: "text-zzm-ok" }[tone];
  return (
    <span className="text-[12.5px] leading-5 tabular-nums text-zzm-muted">
      {label} <span className={`font-semibold ${valueClass}`}>{value}</span>
    </span>
  );
}
