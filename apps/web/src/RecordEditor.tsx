/**
 * [INPUT]: 记录标识、本人同源 API 和保存回调。
 * [OUTPUT]: 手动编辑、冲突提示、修改前后版本和私有附件入口。
 * [POS]: 云端附加历史页的编辑对话框；草稿不写本地存储，来源只展示。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { X, Save, Paperclip, History } from "lucide-react";
import type { Api } from "./Auth";
import { money } from "./model";
import {
  RECORD_KINDS,
  shanghaiInput,
  type EditTarget,
  type RecordDetail,
  type RecordChange,
} from "./record-model";
import {
  fieldsFor,
  initialValues,
  changedPatch,
  FIELD_NAMES,
} from "./record-fields";

function HistoryList({ detail }: { detail: RecordDetail }) {
  function value(
    key: string,
    v: unknown,
    row: Record<string, unknown>,
  ): string {
    if (v == null || v === "") return "未填写";
    if (key === "category_id")
      return detail.categories.find((c) => c.id === v)?.name ?? String(v);
    if (["start_at", "end_at", "occurred_at"].includes(key))
      return shanghaiInput(String(v)).replace("T", " ");
    if (key === "amount_cents")
      return money(Number(v), String(row.currency ?? "CNY"));
    if (key === "direction")
      return (
        { expense: "支出", income: "收入", transfer: "转账" }[String(v)] ??
        String(v)
      );
    if (key === "status") return v === "completed" ? "已完成" : "待完成";
    if (Array.isArray(v)) return v.join("、") || "未填写";
    return String(v);
  }
  function differences(change: RecordChange) {
    const before = (change.before_data.data ?? change.before_data) as Record<
      string,
      unknown
    >;
    const after = (change.after_data.data ?? change.after_data) as Record<
      string,
      unknown
    >;
    return Object.entries(FIELD_NAMES)
      .filter(
        ([key]) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
      )
      .map(([key, label]) => (
        <li key={key}>
          <strong>{label}</strong>
          <span>{value(key, before[key], before)}</span>
          <span className="muted">→</span>
          <span>{value(key, after[key], after)}</span>
        </li>
      ));
  }
  return (
    <details className="record-history">
      <summary>
        <History size={15} />
        修改记录（{detail.changes.length}
        {detail.changesMore ? "+" : ""}）
      </summary>
      {!detail.changes.length ? (
        <p className="muted">还没有修改记录，导入原始数据已保留。</p>
      ) : (
        detail.changes.map((change) => (
          <article key={change.revision}>
            <header>
              第 {change.revision} 版 ·{" "}
              {shanghaiInput(change.changed_at).replace("T", " ")} ·{" "}
              {change.actor === "web" ? "网页修改" : "系统更新"}
            </header>
            <ul>{differences(change)}</ul>
          </article>
        ))
      )}
      {detail.changesMore && (
        <p className="muted">
          这里只展示最近50次修改，完整版本保存在数据库中。
        </p>
      )}
    </details>
  );
}
export function RecordEditor({
  target,
  api,
  onClose,
  onSaved,
}: {
  target: EditTarget;
  api: Api;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [detail, setDetail] = useState<RecordDetail | null>(null),
    [initial, setInitial] = useState<Record<string, string>>({}),
    [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [discard, setDiscard] = useState(false),
    [reload, setReload] = useState(0);
  const root = useRef<HTMLDivElement>(null),
    closeRef = useRef<() => void>(() => {});
  const dirty = JSON.stringify(initial) !== JSON.stringify(values);
  closeRef.current = () => {
    if (!busy) {
      if (dirty) setDiscard(true);
      else onClose();
    }
  };
  useEffect(() => {
    const abort = new AbortController();
    setDetail(null);
    setError("");
    api<RecordDetail>(
      "/api/record?" + new URLSearchParams(target),
      undefined,
      abort.signal,
    )
      .then((next) => {
        setDetail(next);
        const form = initialValues(next);
        setInitial(form);
        setValues({ ...form });
        setDiscard(false);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [api, target.kind, target.id, reload]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null,
      overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === "Tab") {
        const elements = Array.from(
          root.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],summary",
          ) ?? [],
        ).filter((e) => e.getClientRects().length);
        const first = elements[0],
          last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first && last) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === last &&
          first
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  function update(key: string, value: string) {
    setDiscard(false);
    setValues((current) => {
      const next = { ...current, [key]: value };
      if (key === "direction" && detail) {
        const choices = detail.categories.filter(
          (c) =>
            c.kind === "money" &&
            (c.is_active !== false || c.direction === null) &&
            (c.direction === null || c.direction === value),
        );
        if (!choices.some((c) => String(c.id) === next.category_id))
          next.category_id = String(choices[0]?.id ?? "");
      }
      return next;
    });
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!detail || busy) return;
    try {
      const patch = changedPatch(detail, initial, values);
      if (!Object.keys(patch).length) {
        setError("没有需要保存的修改");
        return;
      }
      setBusy(true);
      setError("");
      await api("/api/records/edit", {
        ...target,
        revision: detail.record.data.revision ?? 1,
        patch,
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="record-modal-backdrop">
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-editor-title"
        className="record-editor"
      >
        <header className="record-editor-header">
          <div>
            <span className="eyebrow">手动修正 · 上海时间</span>
            <h2 id="record-editor-title">编辑{RECORD_KINDS[target.kind]}</h2>
          </div>
          <button
            type="button"
            className="zzm-btn zzm-btn--ghost zzm-btn--icon zzm-btn--sm"
            aria-label="关闭编辑"
            disabled={busy}
            onClick={() => closeRef.current()}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </header>
        {error && (
          <div role="alert" className="error">
            {error}
            {error.includes("已被更新") && (
              <button type="button" className="zzm-btn zzm-btn--sm" onClick={() => setReload((x) => x + 1)}>
                重新载入（放弃草稿）
              </button>
            )}
          </div>
        )}
        {discard && (
          <div className="discard-prompt" role="alert">
            <p>有尚未保存的修改。关闭将丢弃草稿。</p>
            <div className="discard-actions">
              <button type="button" className="zzm-btn zzm-btn--sm zzm-btn--ghost" onClick={() => setDiscard(false)}>继续编辑</button>
              <button type="button" className="zzm-btn zzm-btn--sm zzm-btn--accent" onClick={onClose}>放弃修改</button>
            </div>
          </div>
        )}
        {!detail && !error && <div role="status" aria-label="正在读取记录" className="grid gap-3"><div className="zzm-skel h-9" /><div className="zzm-skel h-9" /><div className="zzm-skel h-20" /></div>}
        {detail && (
          <>
            <form onSubmit={submit}>
              <div className="record-form-grid">
                {fieldsFor(detail, values).map((field) => (
                  <label
                    key={field.key}
                    className={field.type === "textarea" ? "wide" : ""}
                  >
                    <span>{field.label}</span>
                    {field.type === "textarea" ? (
                      <textarea
                        className="field field--area"
                        rows={3}
                        value={values[field.key] ?? ""}
                        maxLength={
                          field.key === "deduction_note" ? 2000 : 10000
                        }
                        onChange={(e) => update(field.key, e.target.value)}
                        disabled={busy}
                      />
                    ) : field.type === "select" ? (
                      <select
                        className="field"
                        value={values[field.key] ?? ""}
                        onChange={(e) => update(field.key, e.target.value)}
                        disabled={busy}
                      >
                        {field.options?.map(([value, label]) => (
                          <option value={value} key={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="field"
                        type={field.type}
                        value={values[field.key] ?? ""}
                        onChange={(e) => update(field.key, e.target.value)}
                        step={field.type === "datetime-local" ? 1 : undefined}
                        min={field.type === "number" ? 0 : undefined}
                        maxLength={500}
                        inputMode={
                          ["amount_cents", "openingBalance"].includes(field.key)
                            ? "decimal"
                            : undefined
                        }
                        disabled={busy}
                        required={
                          [
                            "activity",
                            "name",
                            "start_at",
                            "occurred_at",
                            "amount_cents",
                            "currency",
                            "deduction_minutes",
                            "openingBalance",
                          ].includes(field.key) ||
                          (field.key === "title" && target.kind !== "money")
                        }
                      />
                    )}
                    {field.help && <small>{field.help}</small>}
                  </label>
                ))}
              </div>
              <div className="record-editor-actions">
                <span className="muted">修改会保存前后版本。</span>
                <button
                  type="button"
                  className="zzm-btn zzm-btn--ghost"
                  onClick={() => closeRef.current()}
                  disabled={busy}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className={`zzm-btn zzm-btn--accent ${busy ? "zzm-btn--busy" : ""}`}
                  disabled={busy || !dirty}
                >
                  {!busy && <Save size={14} strokeWidth={1.5} />}
                  {busy ? "正在保存…" : "保存修改"}
                </button>
              </div>
            </form>
            {!!detail.attachments.length && (
              <section className="record-attachments">
                <h3>原始附件</h3>
                {detail.attachments.map((file) => (
                  <a
                    key={file.id}
                    href={"/api/attachment?id=" + file.id}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Paperclip size={15} />
                    {file.filename} · {Math.ceil(file.size_bytes / 1024)} KB
                  </a>
                ))}
              </section>
            )}
            {detail.source && (
              <details className="record-source">
                <summary>查看原始来源</summary>
                <p>
                  {detail.source.source === "wechat"
                    ? "微信原话"
                    : "本机 LifeOS 原记录"}
                  ：{detail.source.text}
                </p>
                <p className="muted">原始来源不会被编辑覆盖。</p>
              </details>
            )}
            <HistoryList detail={detail} />
          </>
        )}
      </div>
    </div>
  );
}
