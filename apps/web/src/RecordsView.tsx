/**
 * [INPUT]: 同源历史 API、刷新版本、编辑回调与记录板块的默认类型偏好。
 * [OUTPUT]: 时间、流水、任务和账户的分页检索入口。
 * [POS]: 历史页面；列表不自行写库，编辑交给统一对话框。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { RecordsRange } from "./RecordsRange";
import { Search, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import type { Api } from "./Auth";
import { Empty } from "./ui";
import { useRecordsPreferences } from "./dashboard/store/records";
import {
  clock,
  today,
  money,
  duration,
  type TimeEntry,
  type Transaction,
} from "./model";
import {
  RECORD_KINDS,
  type RecordKind,
  type RecordPage,
  type RecordRow,
  type LocalRecord,
  type OnEdit,
} from "./record-model";
function summary(row: RecordRow): string {
  if (row.kind === "time") {
    const t = row.data as TimeEntry;
    const minutes = t.end_at
      ? Math.floor((Date.parse(t.end_at) - Date.parse(t.start_at)) / 60000) -
        (t.deduction_minutes ?? 0)
      : null;
    return `${today(new Date(t.start_at))} ${clock(t.start_at)} — ${t.end_at ? clock(t.end_at) : "进行中"}${minutes === null ? "" : ` · 净 ${duration(minutes)}`}${t.deduction_minutes ? ` · 扣减 ${t.deduction_minutes} 分钟` : ""}`;
  }
  if (row.kind === "money") {
    const t = row.data as Transaction;
    const direction = { expense: "支出", income: "收入", transfer: "转账" }[
      t.direction
    ];
    return `${today(new Date(t.occurred_at))} ${clock(t.occurred_at)} · ${direction} ${money(Number(t.amount_cents), t.currency)}${t.direction === "transfer" ? ` · ${t.from_account} → ${t.to_account}` : t.account ? ` · ${t.account}` : ""}`;
  }
  const data = (row.data as LocalRecord).data;
  if (row.kind === "account")
    return `${String(data.currency ?? "CNY")} · 期初余额 ${money(Math.round(Number(data.openingBalance ?? 0) * 100), String(data.currency ?? "CNY"))}`;
  if (row.kind === "task")
    return `${data.status === "completed" ? "已完成" : "待完成"} · ${data.task_date ? `${data.task_date} ${data.start_time}–${data.end_time}` : "未排期"}`;
  return String(data.note ?? "");
}
export function RecordsView({
  api,
  onEdit,
  revision,
}: {
  api: Api;
  onEdit: OnEdit;
  revision: number;
}) {
  const defaultKind = useRecordsPreferences((s) => s.defaultKind);
  const [kind, setKind] = useState<RecordKind>(() => Object.hasOwn(RECORD_KINDS, defaultKind) ? defaultKind : "time");
  const [draft, setDraft] = useState({ q: "", start: "", end: "" });
  const [filter, setFilter] = useState(draft),
    [page, setPage] = useState(0);
  const [result, setResult] = useState<RecordPage | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setResult(null);
    const params = new URLSearchParams({ kind, page: String(page), ...filter });
    api<RecordPage>("/api/records?" + params, undefined, abort.signal)
      .then(setResult)
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [api, kind, page, filter, revision]);
  function search(e: FormEvent) {
    e.preventDefault();
    setPage(0);
    setFilter((current) => ({ ...current, q: draft.q }));
  }
  // 日期面板选完立即生效；关键词仍由「查询」提交
  const applyRange = useCallback((range: { start: string; end: string }) => {
    setPage(0);
    setFilter((current) => current.start === range.start && current.end === range.end ? current : { ...current, ...range });
  }, []);
  return (
    <>
      <div className="record-tabs" aria-label="记录类型">
        {Object.entries(RECORD_KINDS).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`zzm-btn zzm-btn--sm ${kind === value ? "zzm-btn--accent" : ""}`}
            aria-pressed={kind === value}
            onClick={() => {
              setKind(value as RecordKind);
              setPage(0);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <RecordsRange onChange={applyRange} />
      <form className="record-filters" onSubmit={search}>
        <label>
          搜索
          <input
            className="field"
            aria-label="搜索历史记录"
            placeholder="活动、标题、账户或备注"
            value={draft.q}
            maxLength={100}
            onChange={(e) =>
              setDraft((current) => ({ ...current, q: e.target.value }))
            }
          />
        </label>
        <button type="submit" className="zzm-btn">
          <Search size={14} strokeWidth={1.5} />
          查询
        </button>
        <button
          type="button"
          className="zzm-btn zzm-btn--ghost"
          onClick={() => {
            setDraft((current) => ({ ...current, q: "" }));
            setFilter((current) => ({ ...current, q: "" }));
            setPage(0);
          }}
        >
          清空搜索
        </button>
      </form>
      <p className="muted record-help">
        日期在左侧日历选择，按开始日期筛选 · 上海时间。编辑后会保存修改记录。
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <section className="card records-card" aria-busy={loading}>
        <div className="card-heading">
          <h2>{RECORD_KINDS[kind]}</h2>
          <span className="tag">
            {loading ? "正在读取…" : `共 ${result?.total ?? 0} 条`}
          </span>
        </div>
        {!result?.rows.length && !loading ? (
          <Empty title="没有符合条件的记录" />
        ) : (
          <div className="record-list">
            {result?.rows.map((row) => (
              <article
                className="record-item"
                key={row.id}
                data-testid={"record-" + row.id}
              >
                <div className="entry-main">
                  <strong>{row.title}</strong>
                  <span>{summary(row)}</span>
                  <small>
                    {row.source === "wechat" ? "微信记录" : "本机 LifeOS 导入"}
                  </small>
                </div>
                <button
                  type="button"
                  className="zzm-btn zzm-btn--sm"
                  onClick={() => onEdit(row.kind, row.id)}
                  aria-label={`编辑 ${row.title}`}
                >
                  <Pencil size={14} strokeWidth={1.5} />
                  编辑
                </button>
              </article>
            ))}
          </div>
        )}
        <div className="record-pagination">
          <span>
            第 {page + 1} / {Math.max(1, Math.ceil((result?.total ?? 0) / 50))}{" "}
            页
          </span>
          <button
            type="button"
            className="zzm-btn zzm-btn--sm"
            disabled={loading || page === 0}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={14} strokeWidth={1.5} />
            上一页
          </button>
          <button
            type="button"
            className="zzm-btn zzm-btn--sm"
            disabled={loading || !result || (page + 1) * 50 >= result.total}
            onClick={() => setPage(page + 1)}
          >
            下一页
            <ChevronRight size={14} strokeWidth={1.5} />
          </button>
        </div>
      </section>
    </>
  );
}
