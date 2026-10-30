/**
 * [INPUT]: 依赖 api 的分类、通用支付方式与账号读写，依赖 Dialog / Select、Veil 隐私状态与统一刷新
 * [OUTPUT]: 提供独立订阅设置页：浏览器及微信提醒说明、分类、非卡支付与账号。
 * [POS]: 订阅板块的设置边界；银行卡交给 /cards，不承载 LifeOS 全局偏好。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useState, type ReactNode } from "react";
import { useRefresh } from "../lib/refresh";
import { useAsyncScope } from "../lib/asyncScope";
import { api } from "../api";
import { Veil, useVeil } from "../components/Veil";
import { useConfirm } from "../components/ui/confirm";
import { Dialog } from "../components/ui/dialog";
import {
  deliverDueReminders,
  notificationPermission,
  notificationSupported,
  requestNotifyPermission,
} from "../lib/notify";
import type { Account, Category, PaymentMethod } from "../types";

type Popup = "category" | "payment" | "account" | null;

export function MethodsPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState("");
  const [popup, setPopup] = useState<Popup>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [catName, setCatName] = useState("");
  const [payDraft, setPayDraft] = useState({ name: "", account: "" });
  const [accDraft, setAccDraft] = useState({ label: "", identifier: "" });
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState(notificationPermission());
  const ask = useConfirm();
  const { veiled } = useVeil();

  const readScope = useAsyncScope();
  async function load() {
    const current = readScope.begin();
    try {
      const [cats, methodList, accountList] = await Promise.all([
        api.listCategories(),
        api.listMethods(),
        api.listAccounts(),
      ]);
      if (!current()) return;
      setCategories(cats.items);
      setMethods(methodList.items.filter((method) => method.kind === "other"));
      setAccounts(accountList.items);
      setError("");
    } catch (err) {
      if (!current()) return;
      setError(err instanceof Error ? err.message : "加载失败");
    }
  }

  useRefresh(load);

  function closePopup() {
    setPopup(null);
    setEditId(null);
    setCatName("");
    setPayDraft({ name: "", account: "" });
    setAccDraft({ label: "", identifier: "" });
  }

  function openCategory(category?: Category) {
    setEditId(category?.id ?? null);
    setCatName(category?.name ?? "");
    setPopup("category");
  }

  function openPayment(method?: PaymentMethod) {
    setEditId(method?.id ?? null);
    setPayDraft({ name: method?.name ?? "", account: method?.account ?? "" });
    setPopup("payment");
  }

  function openAccount(account?: Account) {
    setEditId(account?.id ?? null);
    setAccDraft({ label: account?.label ?? "", identifier: account?.identifier ?? "" });
    setPopup("account");
  }

  async function saveCategory() {
    setBusy(true);
    try {
      if (editId) await api.updateCategory(editId, { name: catName });
      else await api.createCategory({ name: catName });
      closePopup();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法保存分类");
    } finally {
      setBusy(false);
    }
  }

  async function saveMethod() {
    setBusy(true);
    try {
      if (editId) await api.updateMethod(editId, payDraft);
      else await api.createMethod(payDraft);
      closePopup();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法保存支付方式");
    } finally {
      setBusy(false);
    }
  }

  async function saveAccount() {
    setBusy(true);
    try {
      if (editId) await api.updateAccount(editId, accDraft);
      else await api.createAccount(accDraft);
      closePopup();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法保存账号");
    } finally {
      setBusy(false);
    }
  }

  async function removeCategory(id: string) {
    const ok = await ask({
      title: "删除分类",
      description: "底下的订阅会变成未分类。",
      confirmLabel: "删除",
    });
    if (!ok) return;
    try {
      await api.deleteCategory(id);
      closePopup();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法删除");
    }
  }

  async function removeMethod(id: string) {
    const ok = await ask({
      title: "删除支付方式",
      description: "若还有订阅在用，这次不会删成。",
      confirmLabel: "删除",
    });
    if (!ok) return;
    try {
      await api.deleteMethod(id);
      closePopup();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法删除");
    }
  }

  async function removeAccount(id: string) {
    const ok = await ask({
      title: "删除账号",
      description: "若还有订阅挂在这个账号上，这次不会删成。",
      confirmLabel: "删除",
    });
    if (!ok) return;
    try {
      await api.deleteAccount(id);
      closePopup();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法删除");
    }
  }

  async function enableNotify() {
    const next = await requestNotifyPermission();
    setPermission(next);
    if (next === "granted") await deliverDueReminders();
  }

  const notifyCopy =
    !notificationSupported()
      ? "这个浏览器不支持系统通知。"
      : permission === "granted"
        ? "浏览器通知已打开，页面运行时在到期前 7 / 3 / 1 天发送系统通知。"
        : permission === "denied"
          ? "浏览器拒绝了通知，可在浏览器或系统设置中打开。"
          : "打开后，页面运行时在到期前 7 / 3 / 1 天发送系统通知。";

  return (
    <div>
      <header>
        <h1 className="page-title">订阅设置</h1>
        <p className="page-lead">
          分类是目录。这里只放 Apple Pay、支付宝等非卡支付；实体卡与虚拟卡在「银行卡」页统一管理。
        </p>
      </header>
      {error ? <p className="error-text mt-4">{error}</p> : null}

      <section className="mt-10 border-b border-[var(--hairline)] pb-10">
        <h2 className="section-title">到期通知</h2>
        <p className="page-lead">微信在自动续费扣款前 7 天提醒，包含预计金额和日期。VPS 每天北京时间 9 点开始检查，关闭网页也能收到。</p>
        <p className="page-lead">{notifyCopy}</p>
        {notificationSupported() && permission !== "granted" && permission !== "denied" ? (
          <button type="button" className="btn mt-4" onClick={() => void enableNotify()}>
            打开浏览器通知
          </button>
        ) : null}
      </section>

      <Section title="分类" addLabel="添加分类" onAdd={() => openCategory()}>
        {categories.map((category) => (
          <article
            key={category.id}
            className="settings-card"
            role="button"
            tabIndex={0}
            onClick={() => openCategory(category)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openCategory(category);
              }
            }}
          >
            <p className="card-title min-w-0 truncate">{category.name}</p>
          </article>
        ))}
      </Section>

      <Section title="其他支付方式" addLabel="添加支付方式" onAdd={() => openPayment()}>
        {methods.map((method) => (
          <article
            key={method.id}
            className="settings-card"
            role="button"
            tabIndex={0}
            onClick={() => openPayment(method)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openPayment(method);
              }
            }}
          >
            <div className="min-w-0">
              <p className="card-title truncate">{method.name}</p>
              {method.account ? (
                <p className="meta mt-1 truncate">
                  <Veil>{method.account}</Veil>
                </p>
              ) : null}
            </div>
          </article>
        ))}
      </Section>

      <Section title="账号" addLabel="添加账号" onAdd={() => openAccount()}>
        {accounts.map((account) => (
          <article
            key={account.id}
            className="settings-card"
            role="button"
            tabIndex={0}
            onClick={() => openAccount(account)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openAccount(account);
              }
            }}
          >
            <div className="min-w-0">
              <p className="card-title truncate">
                <Veil
                  active={
                    Boolean(account.identifier) &&
                    account.label.trim().toLowerCase() === account.identifier.trim().toLowerCase()
                  }
                >
                  {account.label}
                </Veil>
              </p>
              <p className="meta mt-1 truncate">
                <Veil active={Boolean(account.identifier)}>{account.identifier}</Veil>
              </p>
            </div>
          </article>
        ))}
      </Section>

      <Dialog
        open={popup === "category"}
        onOpenChange={(open) => (open ? setPopup("category") : closePopup())}
        title={editId ? "编辑分类" : "添加分类"}
        description="例如保险、会员。删掉的分类，底下的订阅会变成未分类。"
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void saveCategory();
          }}
        >
          <label className="block">
            <span className="field-label">名称</span>
            <input
              className="field"
              required
              value={catName}
              onChange={(event) => setCatName(event.target.value)}
              placeholder="保险"
            />
          </label>
          <FormActions
            editing={Boolean(editId)}
            busy={busy}
            onCancel={closePopup}
            onDelete={editId ? () => void removeCategory(editId) : undefined}
          />
        </form>
      </Dialog>

      <Dialog
        open={popup === "payment"}
        onOpenChange={(open) => (open ? setPopup("payment") : closePopup())}
        title={editId ? "编辑支付方式" : "添加支付方式"}
        description="名称写支付宝、Apple Pay 等。账号可写手机号或 Apple ID；银行卡请去专门页面。"
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void saveMethod();
          }}
        >
          <label className="block">
            <span className="field-label">名称</span>
            <input
              className="field"
              required
              value={payDraft.name}
              onChange={(event) => setPayDraft((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="支付宝 / Apple Pay"
            />
          </label>
          <label className="block">
            <span className="field-label">账号（可空）</span>
            <input
              className={veiled ? "field is-veiled-field" : "field"}
              type={veiled ? "password" : "text"}
              autoComplete="off"
              value={payDraft.account}
              onChange={(event) => setPayDraft((prev) => ({ ...prev, account: event.target.value }))}
              placeholder="手机号或 Apple ID"
            />
          </label>
          <FormActions
            editing={Boolean(editId)}
            busy={busy}
            onCancel={closePopup}
            onDelete={editId ? () => void removeMethod(editId) : undefined}
          />
        </form>
      </Dialog>

      <Dialog
        open={popup === "account"}
        onOpenChange={(open) => (open ? setPopup("account") : closePopup())}
        title={editId ? "编辑账号" : "添加账号"}
        description="只记邮箱或用户名。每个订阅可以各用一个。"
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void saveAccount();
          }}
        >
          <label className="block">
            <span className="field-label">名称</span>
            <input
              className="field"
              required
              value={accDraft.label}
              onChange={(event) => setAccDraft((prev) => ({ ...prev, label: event.target.value }))}
              placeholder="ChatGPT 专用"
            />
          </label>
          <label className="block">
            <span className="field-label">邮箱或用户名</span>
            <input
              className={veiled ? "field is-veiled-field" : "field"}
              required
              type={veiled ? "password" : "text"}
              autoComplete="off"
              value={accDraft.identifier}
              onChange={(event) =>
                setAccDraft((prev) => ({ ...prev, identifier: event.target.value }))
              }
              placeholder="name@example.com"
            />
          </label>
          <FormActions
            editing={Boolean(editId)}
            busy={busy}
            onCancel={closePopup}
            onDelete={editId ? () => void removeAccount(editId) : undefined}
          />
        </form>
      </Dialog>
    </div>
  );
}

function FormActions({
  editing,
  busy,
  onDelete,
  onCancel,
}: {
  editing: boolean;
  busy: boolean;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex gap-2">
      {editing && onDelete ? (
        <button type="button" disabled={busy} className="btn btn-danger" onClick={onDelete}>
          删除
        </button>
      ) : null}
      <button type="submit" disabled={busy} className="btn btn-zhu">
        保存
      </button>
      <button type="button" className="btn" onClick={onCancel}>
        取消
      </button>
    </div>
  );
}

function Section({
  title,
  addLabel,
  onAdd,
  children,
}: {
  title: string;
  addLabel: string;
  onAdd: () => void;
  children: ReactNode;
}) {
  return (
    <section className="mt-10">
      <header className="flex items-center justify-between gap-3">
        <h2 className="section-title">{title}</h2>
        <button type="button" onClick={onAdd} className="btn">
          {addLabel}
        </button>
      </header>
      <div className="settings-row mt-4">{children}</div>
    </section>
  );
}
