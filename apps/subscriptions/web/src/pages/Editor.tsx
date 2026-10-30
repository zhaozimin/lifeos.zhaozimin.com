/**
 * [INPUT]: 依赖 api、统一刷新与请求身份、信用卡主数据及计费设置组件
 * [OUTPUT]: 提供订阅编辑与直接切换方式；余额和方式写入互斥，详情写入不覆盖草稿
 * [POS]: pages 的编辑表单，只活在 Sheet 里，不再占整页
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { BrandMark } from "../components/BrandMark";
import { PauseDialog } from "../components/PauseDialog";
import { BalanceSettings } from "../components/BalanceSettings";
import { BillingModeSettings } from "../components/BillingModeSettings";
import { useVeil } from "../components/Veil";
import { useConfirm } from "../components/ui/confirm";
import { Select, fromSelectNone, selectNone, withNone } from "../components/ui/select";
import { SheetDescription, SheetHeader, SheetTitle } from "../components/ui/sheet";
import { CYCLE_OPTIONS, countdownLabel, yuan } from "../lib/format";
import { useAsyncScope } from "../lib/asyncScope";
import { useRefresh } from "../lib/refresh";
import type { Account, BillingMode, Category, Cycle, PaymentMethod, Status, Subscription } from "../types";

type Draft = {
  name: string;
  website: string;
  amount_yuan: string;
  cycle: Cycle;
  cycle_days: string;
  next_renewal_on: string;
  auto_renew: boolean;
  billing_mode: BillingMode;
  status: Status;
  payment_method_id: string;
  account_id: string;
  account_email: string;
  category_id: string;
  logo_url: string;
  notes: string;
};

const emptyDraft: Draft = {
  name: "",
  website: "",
  amount_yuan: "",
  cycle: "monthly",
  cycle_days: "",
  next_renewal_on: "",
  auto_renew: true,
  billing_mode: "auto_charge",
  status: "active",
  payment_method_id: "",
  account_id: "",
  account_email: "",
  category_id: "",
  logo_url: "",
  notes: "",
};

function fromItem(item: Subscription): Draft {
  return {
    name: item.name,
    website: item.website,
    amount_yuan: item.amount_yuan,
    cycle: item.cycle,
    cycle_days: item.cycle_days ? String(item.cycle_days) : "",
    next_renewal_on: item.next_renewal_on,
    auto_renew: item.auto_renew,
    billing_mode: item.billing_mode,
    status: item.status,
    payment_method_id: item.payment_method_id ?? "",
    account_id: item.account_id ?? "",
    account_email: item.account_identifier ?? "",
    category_id: item.category_id || "",
    logo_url: item.logo_url || "",
    notes: item.notes,
  };
}

function toPayload(draft: Draft) {
  return {
    name: draft.name,
    website: draft.website,
    amount_yuan: draft.amount_yuan,
    cycle: draft.cycle,
    cycle_days: draft.cycle === "custom" ? Number(draft.cycle_days) : null,
    next_renewal_on: draft.next_renewal_on,
    auto_renew: draft.auto_renew,
    billing_mode: draft.billing_mode,
    status: draft.status,
    payment_method_id: draft.payment_method_id || null,
    account_id: draft.account_id || null,
    category_id: draft.category_id,
    logo_url: draft.logo_url,
    notes: draft.notes,
  };
}

export function EditorForm({
  id,
  onSaved,
  onClosed,
}: {
  id?: string;
  onSaved: () => void;
  onClosed: () => void;
}) {
  const isNew = !id;
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [item, setItem] = useState<Subscription | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [balanceBusy, setBalanceBusy] = useState(false);
  const actionBusy = busy || modeBusy || balanceBusy;
  const ask = useConfirm();
  const { veiled } = useVeil();
  const [resolvedLogo, setResolvedLogo] = useState("");
  const [editing, setEditing] = useState(isNew);
  const [pauseOpen, setPauseOpen] = useState(false);
  const locked = !isNew && !editing;
  const paused = item?.status === "paused";
  const amountRef = useRef<HTMLInputElement>(null);
  const readScope = useAsyncScope();

  useEffect(() => { readScope.invalidate(); }, [id, editing]);
  useRefresh(async () => {
    if (!id || editing || !item || actionBusy) return;
    const alive = readScope.begin();
    try {
      const updated = await api.getSubscription(id);
      if (!alive()) return;
      setItem(updated);
      setDraft(fromItem(updated));
    } catch (err) {
      if (alive()) setError(err instanceof Error ? err.message : "加载失败");
    }
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [methodList, accountList, categoryList] = await Promise.all([
          api.listMethods(),
          api.listAccounts(),
          api.listCategories(),
        ]);
        if (cancelled) return;
        setMethods(methodList.items);
        setAccounts(accountList.items);
        setCategories(categoryList.items);
        if (id) {
          const next = await api.getSubscription(id);
          if (cancelled) return;
          setItem(next);
          setDraft(fromItem(next));
        } else {
          setItem(null);
          setDraft(emptyDraft);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    setEditing(!id);
  }, [id]);

  function startEdit() {
    setEditing(true);
  }

  useEffect(() => {
    if (!editing || isNew) return;
    amountRef.current?.focus();
    amountRef.current?.select();
  }, [editing, isNew]);

  useEffect(() => {
    if (!draft.website && !draft.logo_url) {
      setResolvedLogo("");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api
        .resolveLogo(draft.website, draft.logo_url)
        .then((result) => {
          if (!cancelled) setResolvedLogo(result.logo_src);
        })
        .catch(() => {
          if (!cancelled) setResolvedLogo("");
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [draft.website, draft.logo_url]);

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function resolveAccountId(): Promise<string | null> {
    const email = draft.account_email.trim();
    if (email) {
      const found = accounts.find(
        (account) => account.identifier.toLowerCase() === email.toLowerCase(),
      );
      if (found) return found.id;
      const created = await api.createAccount({
        label: email,
        identifier: email,
      });
      return created.id;
    }
    return draft.account_id || null;
  }

  async function save() {
    if (busy || (!isNew && !item)) return;
    setBusy(true);
    setError("");
    try {
      const accountId = await resolveAccountId();
      const payload = { ...toPayload(draft), account_id: accountId,
        ...(item ? { expected_next_renewal_on: item.next_renewal_on } : {}) };
      if (isNew) {
        await api.createSubscription(payload);
        onSaved();
        onClosed();
      } else if (id) {
        const updated = await api.updateSubscription(id, payload);
        setItem(updated);
        setDraft(fromItem(updated));
        setEditing(false);
        onSaved();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRenewal() {
    if (!id) return;
    setBusy(true);
    setError("");
    try {
      const updated = await api.confirmRenewal(id);
      setItem(updated);
      setDraft(fromItem(updated));
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "续费确认失败");
    } finally {
      setBusy(false);
    }
  }

  async function pause(keepRemaining: boolean) {
    if (!id) return;
    setBusy(true);
    setError("");
    try {
      const updated = await api.pauseSubscription(id, keepRemaining);
      setItem(updated);
      setDraft(fromItem(updated));
      setPauseOpen(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "暂停失败");
    } finally {
      setBusy(false);
    }
  }

  async function resume() {
    if (!id) return;
    setBusy(true);
    setError("");
    try {
      const updated = await api.resumeSubscription(id);
      setItem(updated);
      setDraft(fromItem(updated));
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "恢复失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!id) return;
    const ok = await ask({
      title: "删除订阅",
      description: "记下的内容会一起消失。",
      confirmLabel: "删除",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.deleteSubscription(id);
      onSaved();
      onClosed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
      setBusy(false);
    }
  }

  const field = "field";
  const label = "field-label";
  const copy = editorCopy(item, isNew);
  const previewSite = draft.website.startsWith("http")
    ? draft.website
    : draft.website
      ? `https://${draft.website}`
      : "https://example.com";
  const previewLogo = resolvedLogo || item?.logo_src || "";

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <SheetHeader>
        <SheetTitle>{copy.title}</SheetTitle>
        <SheetDescription>{copy.desc}</SheetDescription>
      </SheetHeader>
      <div className="grid flex-1 auto-rows-min gap-5 overflow-y-auto px-5 pb-6">
        <div className="flex items-center gap-4">
          <BrandMark
            name={draft.name || "订阅"}
            website={previewSite}
            logoSrc={previewLogo}
            size={48}
          />
          <p className="meta">
            {locked
              ? "点编辑才能改金额、日期和账号。"
              : "填网站，不靠名称。已知域名会自动套商店方图；其他用网站图标。"}
          </p>
        </div>
        <BillingModeSettings item={item} value={draft.billing_mode} editing={!locked} disabled={actionBusy}
          onDraftChange={(value) => patch("billing_mode", value)} onBusyChange={setModeBusy}
          onUpdated={(updated) => { readScope.invalidate(); setItem(updated); setDraft(fromItem(updated)); onSaved(); }} />
        {draft.billing_mode === "auto_charge" && item && !item.auto_charge_ready && locked
          ? <p className="caption text-[var(--zhu-text)]">尚未绑定正常状态的信用卡。点编辑选择信用卡后启用自动续期。</p> : null}
        {item?.billing_mode === "balance" && draft.billing_mode === "balance" ? <BalanceSettings key={item.id} item={item} disabled={busy || modeBusy || editing}
          onBusyChange={setBalanceBusy}
          onUpdated={(updated) => { readScope.invalidate(); setItem(updated); setDraft(fromItem(updated)); onSaved(); }} /> : null}
        {draft.billing_mode === "balance" && item?.billing_mode !== "balance"
          ? <p className="caption">保存订阅方式后，即可设置余额或充值。</p> : null}
        <Field label="订阅名称" className={label}>
          <input
            className={locked ? `${field} is-locked` : field}
            required
            readOnly={locked}
            value={draft.name}
            onChange={(event) => patch("name", event.target.value)}
            placeholder="ChatGPT Plus"
          />
        </Field>
        <Field label="网站" className={label}>
          <input
            className={locked ? `${field} is-locked` : field}
            required
            readOnly={locked}
            value={draft.website}
            onChange={(event) => patch("website", event.target.value)}
            placeholder="chatgpt.com"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4 max-[520px]:grid-cols-1">
          <Field label="金额（人民币）" className={label}>
            <input
              ref={amountRef}
              key={locked ? "amount-lock" : "amount-edit"}
              className={locked ? `${field} is-locked` : field}
              required
              type="text"
              inputMode="decimal"
              autoComplete="off"
              readOnly={locked}
              value={draft.amount_yuan}
              onChange={(event) => patch("amount_yuan", event.target.value)}
              placeholder="140"
            />
          </Field>
          <Field label="周期" className={label}>
            <Select
              key={locked ? "cycle-lock" : "cycle-edit"}
              disabled={locked}
              value={draft.cycle}
              onValueChange={(value) => patch("cycle", value as Cycle)}
              options={CYCLE_OPTIONS}
            />
          </Field>
        </div>
        {draft.cycle === "custom" ? (
          <Field label="自定义天数" className={label}>
            <input
              className={locked ? `${field} is-locked` : field}
              required
              readOnly={locked}
              inputMode="numeric"
              value={draft.cycle_days}
              onChange={(event) => patch("cycle_days", event.target.value)}
              placeholder="30"
            />
          </Field>
        ) : null}
        <Field label="分类" className={label}>
          <Select
            disabled={locked}
            value={selectNone(draft.category_id)}
            onValueChange={(value) => patch("category_id", fromSelectNone(value))}
            options={withNone(
              categories.map((category) => ({ value: category.id, label: category.name })),
              "按网站自动归类",
            )}
          />
        </Field>
        <Field label="Logo 地址（可空）" className={label}>
          <input
            className={locked ? `${field} is-locked` : field}
            readOnly={locked}
            value={draft.logo_url}
            onChange={(event) => patch("logo_url", event.target.value)}
            placeholder="https://…"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4 max-[520px]:grid-cols-1">
          <Field label="下次扣款日" className={label}>
            <input
              className={locked ? `${field} is-locked` : field}
              required
              readOnly={locked}
              type="date"
              value={draft.next_renewal_on}
              onChange={(event) => patch("next_renewal_on", event.target.value)}
            />
          </Field>
          <p className="caption self-end pb-2">
            提醒固定提前 7 / 3 / 1 天，各响一次。
          </p>
        </div>
        <div>
          <Field label={draft.billing_mode === "auto_charge" ? "扣款信用卡" : "充值支付方式（可选）"} className={label}>
            <Select
              disabled={locked}
              sensitive={veiled}
              value={selectNone(draft.payment_method_id)}
              onValueChange={(value) => patch("payment_method_id", fromSelectNone(value))}
              options={withNone(
                methods
                  .filter(
                    (method) =>
                      method.id === draft.payment_method_id || (method.status === "active" &&
                        (draft.billing_mode === "balance" || (method.kind !== "other" && method.card_type === "credit"))),
                  )
                  .map((method) => ({
                    value: method.id,
                    label: [
                      method.account ? `${method.name} · ${method.account}` : method.name,
                      method.status === "frozen"
                        ? "已冻结"
                        : method.status === "closed"
                          ? "已注销"
                          : "",
                    ]
                      .filter(Boolean)
                      .join(" · "),
                  })),
              )}
            />
          </Field>
          {locked ? null : (
            <span className="caption mt-1 inline-flex gap-3">
              <Link to="/cards">管理银行卡</Link>
              <Link to="/methods">管理其他支付</Link>
            </span>
          )}
        </div>
        <div>
          <Field label="选用已有账号" className={label}>
            <Select
              disabled={locked}
              sensitive={veiled}
              value={selectNone(draft.account_id)}
              onValueChange={(value) => {
                const next = fromSelectNone(value);
                const picked = accounts.find((account) => account.id === next);
                setDraft((prev) => ({
                  ...prev,
                  account_id: next,
                  account_email: picked?.identifier ?? "",
                }));
              }}
              options={withNone(
                accounts.map((account) => ({
                  value: account.id,
                  label: `${account.label} · ${account.identifier}`,
                })),
                "不选用，下面手填",
              )}
            />
          </Field>
          <Field label="账号邮箱（每个订阅可以不同）" className={`${label} mt-4`}>
            <input
              className={[
                veiled ? `${field} is-veiled-field` : field,
                locked ? "is-locked" : "",
              ].join(" ")}
              readOnly={locked}
              value={draft.account_email}
              onChange={(event) => patch("account_email", event.target.value)}
              placeholder="name@example.com"
              autoComplete="off"
            />
          </Field>
          {locked ? null : (
            <>
              <p className="caption mt-1">
                多数订阅各用各的邮箱。填了邮箱会按标识复用或新建账号，不会写密码。
              </p>
              <Link to="/methods" className="caption mt-1 inline-block">
                管理账号
              </Link>
            </>
          )}
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            disabled={locked}
            checked={draft.auto_renew}
            onChange={(event) => patch("auto_renew", event.target.checked)}
          />
          会自动续费
        </label>
        <Field label="状态" className={label}>
          <Select
            disabled={locked || paused}
            value={draft.status}
            onValueChange={(value) => patch("status", value as Status)}
            options={
              paused
                ? [{ value: "paused", label: "已暂停（用下面的恢复按钮）" }]
                : [
                    { value: "active", label: "生效中" },
                    { value: "cancelled", label: "已取消（用到下次扣款日）" },
                    { value: "expired", label: "已到期" },
                  ]
            }
          />
        </Field>
        <Field label="备注" className={label}>
          <textarea
            className={`${field} min-h-[88px]${locked ? " is-locked" : ""}`}
            readOnly={locked}
            value={draft.notes}
            onChange={(event) => patch("notes", event.target.value)}
          />
        </Field>
        {error ? <p className="error-text">{error}</p> : null}
      </div>

      <div className="sheet-footer">
        {locked ? (
          <button
            type="button"
            className="btn btn-zhu disabled:opacity-50"
            disabled={!item || actionBusy}
            onClick={startEdit}
          >
            编辑
          </button>
        ) : null}
        {!locked ? (
          <button
            type="button"
            disabled={actionBusy}
            className="btn btn-zhu disabled:opacity-50"
            onClick={() => void save()}
          >
            {isNew ? "保存" : "更新"}
          </button>
        ) : null}
        {!isNew && editing ? (
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (item) setDraft(fromItem(item));
              setEditing(false);
            }}
          >
            取消
          </button>
        ) : null}
        {!isNew && item?.status === "active" ? (
          <button type="button" disabled={actionBusy} onClick={() => setPauseOpen(true)} className="btn">
            暂停
          </button>
        ) : null}
        {!isNew && paused ? (
          <button type="button" disabled={actionBusy} onClick={() => void resume()} className="btn btn-ink">
            恢复订阅
          </button>
        ) : null}
        {!isNew && item?.status === "active" && !(item.billing_mode === "balance" && item.balance_fen != null)
          && !(item.billing_mode === "auto_charge" && item.auto_charge_ready && item.auto_renew) ? (
          <button type="button" disabled={actionBusy} onClick={() => void confirmRenewal()} className="btn">
            确认已续费
          </button>
        ) : null}
        {!isNew ? (
          <button
            type="button"
            disabled={actionBusy}
            onClick={() => void remove()}
            className="btn text-[var(--zhu-text)]"
          >
            删除
          </button>
        ) : null}
        <button type="button" className="btn" onClick={onClosed}>
          关闭
        </button>
      </div>
      {item ? (
        <PauseDialog
          item={item}
          open={pauseOpen}
          busy={busy}
          onOpenChange={setPauseOpen}
          onConfirm={(keepRemaining) => void pause(keepRemaining)}
        />
      ) : null}
    </form>
  );
}

export function editorCopy(item: Subscription | null, isNew: boolean): { title: string; desc: string } {
  if (isNew) {
    return { title: "新订阅", desc: "记下一条会扣款的承诺。保存后会出现在对应分类里。" };
  }
  if (item) {
    return {
      title: item.name,
      desc: `${countdownLabel(item)} · 下次 ${item.next_renewal_on} · ${yuan(item.amount_yuan)}`,
    };
  }
  return { title: "编辑订阅", desc: "改完点更新。" };
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className={className}>{label}</span>
      {children}
    </label>
  );
}
