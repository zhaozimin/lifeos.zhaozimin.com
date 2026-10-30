/**
 * [INPUT]: 依赖 api 的银行卡 CRUD 与前 8 位瞬时识别，依赖 BankCardVisual、CardWallet、CardCoverPicker 的照片脱敏/AI 生成与 Sheet / Select / Confirm 的安全交互
 * [OUTPUT]: 对外提供点卡即编辑的 Wallet 式卡包、实体/虚拟卡筛选、编辑会话隔离的 BIN 候选识别、照片自动重绘/公开候选与结构化编辑 Sheet
 * [POS]: pages 的银行卡资产页。完整卡号最多短暂存在浏览器输入态，请求只发送前 8 位；原始卡片照片也只短暂存在浏览器，持久层仍只接收末 4 位、管理元数据与最终封面
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useMemo, useState, type ReactNode } from "react";
import { useRefresh } from "../lib/refresh";
import { useAsyncScope } from "../lib/asyncScope";
import { api } from "../api";
import {
  BankCardVisual,
  cardTypeLabel,
  networkLabel,
} from "../components/BankCardVisual";
import { CardCoverPicker } from "../components/CardCoverPicker";
import { CardWallet } from "../components/CardWallet";
import { useConfirm } from "../components/ui/confirm";
import { Select } from "../components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet";
import type {
  BankCard,
  CardKind,
  CardNetwork,
  CardStatus,
  CardType,
} from "../types";

type CardFilter = "all" | CardKind | "frozen" | "closed";

type CardDraft = {
  name: string;
  kind: CardKind;
  issuer: string;
  card_type: CardType;
  network: CardNetwork;
  last4: string;
  currency: string;
  expiry_month: string;
  billing_day: string;
  payment_due_day: string;
  status: CardStatus;
  cover_key: string;
  cover_src: string;
  cover_source_url: string;
  note: string;
};

const KIND_OPTIONS = [
  { value: "physical_card", label: "实体卡" },
  { value: "virtual_card", label: "虚拟卡" },
];

const TYPE_OPTIONS = [
  { value: "credit", label: "信用卡" },
  { value: "debit", label: "借记卡" },
  { value: "prepaid", label: "预付卡" },
];

const NETWORK_OPTIONS = [
  { value: "unionpay", label: "银联 UnionPay" },
  { value: "visa", label: "Visa" },
  { value: "mastercard", label: "Mastercard" },
  { value: "amex", label: "American Express" },
  { value: "jcb", label: "JCB" },
  { value: "discover", label: "Discover" },
  { value: "other", label: "其他" },
];

const CURRENCY_OPTIONS = ["CNY", "USD", "HKD", "EUR", "GBP", "JPY"].map((value) => ({
  value,
  label: value,
}));

const STATUS_OPTIONS = [
  { value: "active", label: "正常" },
  { value: "frozen", label: "已冻结" },
  { value: "closed", label: "已注销" },
];

function emptyDraft(kind: CardKind): CardDraft {
  return {
    name: "",
    kind,
    issuer: "",
    card_type: "credit",
    network: "unionpay",
    last4: "",
    currency: "CNY",
    expiry_month: "",
    billing_day: "",
    payment_due_day: "",
    status: "active",
    cover_key: "",
    cover_src: "",
    cover_source_url: "",
    note: "",
  };
}

function draftOf(card: BankCard): CardDraft {
  return {
    name: card.name,
    kind: card.kind,
    issuer: card.issuer,
    card_type: card.card_type,
    network: card.network,
    last4: card.last4,
    currency: card.currency,
    expiry_month: card.expiry_month,
    billing_day: card.billing_day?.toString() ?? "",
    payment_due_day: card.payment_due_day?.toString() ?? "",
    status: card.status,
    cover_key: card.cover_key,
    cover_src: card.cover_src,
    cover_source_url: card.cover_source_url,
    note: card.note,
  };
}

export function CardsPage() {
  const [cards, setCards] = useState<BankCard[]>([]);
  const [filter, setFilter] = useState<CardFilter>("all");
  const [editing, setEditing] = useState<BankCard | null>(null);
  const [draft, setDraft] = useState<CardDraft>(() => emptyDraft("physical_card"));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [identifyInput, setIdentifyInput] = useState("");
  const [recognitionNote, setRecognitionNote] = useState("");
  const [issuerWebsite, setIssuerWebsite] = useState("");
  const [coverSearchVersion, setCoverSearchVersion] = useState(0);
  const [coverSessionKey, setCoverSessionKey] = useState(0);
  const [error, setError] = useState("");
  const ask = useConfirm();
  const editScope = useAsyncScope();
  const identifyScope = useAsyncScope();
  const [coverBusy, setCoverBusy] = useState(false);
  const [sessionCurrent, setSessionCurrent] = useState<() => boolean>(() => () => false);

  const readScope = useAsyncScope();
  async function load() {
    const current = readScope.begin();
    try {
      const pack = await api.listCards();
      if (!current()) return;
      setCards(pack.items);
      setError("");
    } catch (err) {
      if (!current()) return;
      setError(err instanceof Error ? err.message : "银行卡加载失败");
    }
  }

  useRefresh(load);

  const counts = useMemo(
    () => ({
      all: cards.length,
      physical: cards.filter((card) => card.kind === "physical_card").length,
      virtual: cards.filter((card) => card.kind === "virtual_card").length,
      frozen: cards.filter((card) => card.status === "frozen").length,
      closed: cards.filter((card) => card.status === "closed").length,
    }),
    [cards],
  );

  const visible = useMemo(
    () =>
      cards.filter((card) => {
        if (filter === "all") return true;
        if (filter === "frozen" || filter === "closed") return card.status === filter;
        return card.kind === filter;
      }),
    [cards, filter],
  );

  function create(kind: CardKind) {
    const current = editScope.begin();
    setSessionCurrent(() => current);
    identifyScope.invalidate();
    setIdentifying(false);
    setCoverBusy(false);
    setEditing(null);
    setDraft(emptyDraft(kind));
    setError("");
    setRecognitionNote("");
    setIdentifyInput("");
    setIssuerWebsite("");
    setCoverSearchVersion(0);
    setCoverSessionKey((value) => value + 1);
    setOpen(true);
  }

  function edit(card: BankCard) {
    const current = editScope.begin();
    setSessionCurrent(() => current);
    identifyScope.invalidate();
    setIdentifying(false);
    setCoverBusy(false);
    setEditing(card);
    setDraft(draftOf(card));
    setError("");
    setRecognitionNote("");
    setIdentifyInput("");
    setIssuerWebsite("");
    setCoverSearchVersion(0);
    setCoverSessionKey((value) => value + 1);
    setOpen(true);
  }

  function closeEditor() {
    if (busy || coverBusy) return;
    editScope.invalidate();
    identifyScope.invalidate();
    setIdentifying(false);
    setOpen(false);
  }

  function patch<K extends keyof CardDraft>(key: K, value: CardDraft[K]) {
    identifyScope.invalidate();
    setIdentifying(false);
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (coverBusy || identifying || busy) return;
    const current = sessionCurrent;
    setBusy(true);
    setError("");
    try {
      const { cover_src: _coverPreview, ...storedDraft } = draft;
      const payload = {
        ...storedDraft,
        billing_day: draft.billing_day || null,
        payment_due_day: draft.payment_due_day || null,
      };
      if (editing) await api.updateCard(editing.id, payload);
      else await api.createCard(payload);
      if (!current()) return;
      editScope.invalidate();
      setOpen(false);
      setEditing(null);
      await load();
    } catch (err) {
      if (!current()) return;
      setError(err instanceof Error ? err.message : "银行卡保存失败");
    } finally {
      setBusy(false);
    }
  }

  function recognizeFromName() {
    const text = `${draft.issuer} ${draft.name}`.trim().toLowerCase();
    const changes: Partial<CardDraft> = {};
    const found: string[] = [];
    if (/\bvirtual\b|虚拟|一次性/.test(text)) {
      changes.kind = "virtual_card";
      found.push("虚拟卡");
    }
    if (/\bdebit\b|借记|储蓄/.test(text)) {
      changes.card_type = "debit";
      found.push("借记卡");
    } else if (/\bprepaid\b|预付|礼品卡/.test(text)) {
      changes.card_type = "prepaid";
      found.push("预付卡");
    } else if (/\bcredit\b|信用/.test(text)) {
      changes.card_type = "credit";
      found.push("信用卡");
    }
    const networks: Array<[RegExp, CardNetwork, string]> = [
      [/unionpay|银联/, "unionpay", "UnionPay"],
      [/mastercard|master card|万事达/, "mastercard", "Mastercard"],
      [/american express|\bamex\b|运通/, "amex", "Amex"],
      [/\bvisa\b/, "visa", "Visa"],
      [/\bjcb\b/, "jcb", "JCB"],
      [/\bdiscover\b/, "discover", "Discover"],
    ];
    const network = networks.find(([pattern]) => pattern.test(text));
    if (network) {
      changes.network = network[1];
      found.push(network[2]);
    }
    if (!found.length) {
      setRecognitionNote("未找到可靠关键词，请手动选择卡片信息。");
      return;
    }
    setDraft((current) => ({ ...current, ...changes }));
    setRecognitionNote(`已识别：${found.join(" · ")}。保存前请确认。`);
  }

  async function recognizeFromNumber() {
    const requestCurrent = identifyScope.begin();
    const current = () => requestCurrent() && sessionCurrent();
    const digits = identifyInput.replace(/\D/g, "");
    const isFullNumber = digits.length >= 12 && digits.length <= 19;
    if (digits.length !== 8 && !isFullNumber) {
      setError("请输入卡号前 8 位，或粘贴 12–19 位完整卡号");
      return;
    }
    const iin = digits.slice(0, 8);
    const last4 = isFullNumber ? digits.slice(-4) : "";
    setIdentifyInput("");
    setIdentifying(true);
    setError("");
    try {
      const result = await api.identifyCard(iin);
      if (!current()) return;
      setIssuerWebsite(result.issuer_website);
      setDraft((current) => {
        const issuer = result.issuer || current.issuer;
        const cardType = result.card_type || current.card_type;
        const generatedName = result.product || (issuer ? `${networkLabel(result.network)} ${cardTypeLabel(cardType)}` : "");
        const supportedCurrency = CURRENCY_OPTIONS.some((option) => option.value === result.currency);
        return {
          ...current,
          issuer,
          name: current.name || generatedName,
          network: result.network,
          card_type: cardType,
          currency: supportedCurrency ? result.currency : current.currency,
          last4: last4 || current.last4,
        };
      });
      const geography = result.country_code ? ` · ${result.country_code}` : "";
      setRecognitionNote(`${result.notice}${geography} 正在按候选信息搜索卡面；输入内容已清除。`);
      setCoverSearchVersion((value) => value + 1);
    } catch (err) {
      if (!current()) return;
      setError(err instanceof Error ? err.message : "无法识别这张卡");
    } finally {
      if (current()) setIdentifying(false);
    }
  }

  async function remove() {
    if (!editing || coverBusy || busy) return;
    const current = sessionCurrent;
    const ok = await ask({
      title: "删除银行卡",
      description:
        editing.subscription_count > 0
          ? `还有 ${editing.subscription_count} 项订阅绑定这张卡，需先改掉支付方式。`
          : "删除后不能撤销。如果只是不再使用，改成「已注销」更适合。",
      confirmLabel: "删除",
    });
    if (!ok || !current()) return;
    setBusy(true);
    try {
      await api.deleteCard(editing.id);
      if (!current()) return;
      editScope.invalidate();
      setOpen(false);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法删除银行卡");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="cards-page-head">
        <div>
          <h1 className="page-title">银行卡</h1>
          <p className="page-lead">
            像 Wallet 一样浏览实体卡和虚拟卡。识别时只发送前 8 位，账本仍只保存末 4 位。
          </p>
        </div>
        <div className="cards-head-actions">
          <button type="button" className="btn" onClick={() => create("virtual_card")}>
            新增虚拟卡
          </button>
          <button type="button" className="btn btn-zhu" onClick={() => create("physical_card")}>
            新增实体卡
          </button>
        </div>
      </header>

      <p className="cards-ledger">
        共 {counts.all} 张 <span /> 实体 {counts.physical} <span /> 虚拟 {counts.virtual}
        {counts.frozen ? (
          <>
            <span /> 冻结 {counts.frozen}
          </>
        ) : null}
      </p>

      <div className="cards-filters" role="tablist" aria-label="筛选银行卡">
        <FilterButton label="全部" count={counts.all} value="all" current={filter} onPick={setFilter} />
        <FilterButton
          label="实体卡"
          count={counts.physical}
          value="physical_card"
          current={filter}
          onPick={setFilter}
        />
        <FilterButton
          label="虚拟卡"
          count={counts.virtual}
          value="virtual_card"
          current={filter}
          onPick={setFilter}
        />
        <FilterButton
          label="已冻结"
          count={counts.frozen}
          value="frozen"
          current={filter}
          onPick={setFilter}
        />
        <FilterButton
          label="已注销"
          count={counts.closed}
          value="closed"
          current={filter}
          onPick={setFilter}
        />
      </div>

      {error && !open ? <p className="error-text mt-5">{error}</p> : null}

      <CardWallet
        cards={visible}
        hasAnyCard={Boolean(cards.length)}
        onEdit={edit}
        onCreate={() => create("physical_card")}
      />

      <Sheet open={open} onOpenChange={(next) => { if (!next) closeEditor(); }}>
        <SheetContent side="right">
          <form
            className="card-editor-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <SheetHeader>
              <SheetTitle>{editing ? "编辑银行卡" : `新增${draft.kind === "physical_card" ? "实体卡" : "虚拟卡"}`}</SheetTitle>
              <SheetDescription>可用前 8 位联网识别；账本只保存末 4 位与管理信息。</SheetDescription>
            </SheetHeader>
            <div className="card-editor-body">
              {error ? <p className="error-text">{error}</p> : null}
              <div className="card-editor-live-preview">
                <BankCardVisual card={draft} preview />
              </div>
              <section className="card-identify-panel" aria-labelledby="card-identify-title">
                <div className="card-identify-head">
                  <div>
                    <h3 id="card-identify-title">通过卡号识别</h3>
                    <p>输入前 8 位，或粘贴完整号码后在本页立即截断。</p>
                  </div>
                  <span>不保存</span>
                </div>
                <div className="card-identify-row">
                  <input
                    className="field"
                    inputMode="numeric"
                    autoComplete="off"
                    value={identifyInput}
                    onChange={(event) => setIdentifyInput(event.target.value.replace(/\D/g, "").slice(0, 19))}
                    placeholder="前 8 位或完整卡号"
                    aria-describedby="card-identify-privacy"
                  />
                  <button
                    type="button"
                    className="btn"
                    disabled={identifying || !identifyInput}
                    onClick={() => void recognizeFromNumber()}
                  >
                    {identifying ? "识别中…" : "联网识别"}
                  </button>
                </div>
                <p id="card-identify-privacy" className="caption">
                  点击后仅向 BINLIST 发送前 8 位；输入框随即清空，完整号码不会发送到 SubOS 服务端。
                </p>
              </section>
              <Field label="卡片形态">
                <Select
                  value={draft.kind}
                  onValueChange={(value) => patch("kind", value as CardKind)}
                  options={KIND_OPTIONS}
                />
              </Field>
              <Field label="卡片名称">
                <input
                  className="field"
                  required
                  value={draft.name}
                  onChange={(event) => patch("name", event.target.value)}
                  placeholder="经典白 / 海外订阅卡"
                />
              </Field>
              <Field label="发卡机构">
                <input
                  className="field"
                  required
                  value={draft.issuer}
                  onChange={(event) => patch("issuer", event.target.value)}
                  placeholder="招商银行 / Wise"
                />
              </Field>
              <div className="card-recognize-row">
                <button type="button" className="btn" onClick={recognizeFromName}>
                  从名称识别
                </button>
                <p className={recognitionNote ? "caption" : "caption is-quiet"}>
                  {recognitionNote || "可识别「虚拟 / 信用 / 借记 / Visa / 银联」等关键词。"}
                </p>
              </div>
              <div className="card-editor-pair">
                <Field label="卡片类型">
                  <Select
                    value={draft.card_type}
                    onValueChange={(value) => patch("card_type", value as CardType)}
                    options={TYPE_OPTIONS}
                  />
                </Field>
                <Field label="卡组织">
                  <Select
                    value={draft.network}
                    onValueChange={(value) => patch("network", value as CardNetwork)}
                    options={NETWORK_OPTIONS}
                  />
                </Field>
              </div>
              <div className="card-editor-pair">
                <Field label="卡号末 4 位">
                  <input
                    className="field"
                    required
                    inputMode="numeric"
                    autoComplete="off"
                    minLength={4}
                    maxLength={4}
                    pattern="[0-9]{4}"
                    value={draft.last4}
                    onChange={(event) => patch("last4", event.target.value.replace(/\D/g, ""))}
                    placeholder="3201"
                  />
                </Field>
                <Field label="主结算币种">
                  <Select
                    value={draft.currency}
                    onValueChange={(value) => patch("currency", value)}
                    options={CURRENCY_OPTIONS}
                  />
                </Field>
              </div>
              <Field label="有效期（可空）">
                <input
                  className="field"
                  type="month"
                  value={draft.expiry_month}
                  onChange={(event) => patch("expiry_month", event.target.value)}
                />
              </Field>
              {draft.card_type === "credit" ? (
                <div className="card-editor-pair">
                  <Field label="账单日（可空）">
                    <input
                      className="field"
                      inputMode="numeric"
                      min={1}
                      max={31}
                      type="number"
                      value={draft.billing_day}
                      onChange={(event) => patch("billing_day", event.target.value)}
                      placeholder="12"
                    />
                  </Field>
                  <Field label="还款日（可空）">
                    <input
                      className="field"
                      inputMode="numeric"
                      min={1}
                      max={31}
                      type="number"
                      value={draft.payment_due_day}
                      onChange={(event) => patch("payment_due_day", event.target.value)}
                      placeholder="30"
                    />
                  </Field>
                </div>
              ) : null}
              <CardCoverPicker
                key={coverSessionKey}
                issuer={draft.issuer}
                product={draft.name}
                network={draft.network}
                issuerWebsite={issuerWebsite}
                autoSearchVersion={coverSearchVersion}
                coverKey={draft.cover_key}
                coverSrc={draft.cover_src}
                coverSourceUrl={draft.cover_source_url}
                onSourceUrlChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    cover_source_url: value,
                    cover_key: "",
                    cover_src: "",
                  }))
                }
                onResolved={(cover) => {
                  if (sessionCurrent()) setDraft((current) => ({ ...current, ...cover }));
                }}
                onBusyChange={setCoverBusy}
                onClear={() =>
                  setDraft((current) => ({
                    ...current,
                    cover_key: "",
                    cover_src: "",
                    cover_source_url: "",
                  }))
                }
                onError={(message) => { if (sessionCurrent()) setError(message); }}
              />
              <Field label="状态">
                <Select
                  value={draft.status}
                  onValueChange={(value) => patch("status", value as CardStatus)}
                  options={STATUS_OPTIONS}
                />
              </Field>
              <Field label="用途 / 备注（可空）">
                <textarea
                  className="field"
                  value={draft.note}
                  onChange={(event) => patch("note", event.target.value)}
                  placeholder="例如：只用于海外订阅。不要写卡密、安全码或验证码。"
                />
              </Field>
            </div>
            <SheetFooter>
              {editing ? (
                <button type="button" className="btn btn-danger" disabled={busy || coverBusy || identifying} onClick={() => void remove()}>
                  删除
                </button>
              ) : null}
              <button type="submit" className="btn btn-zhu" disabled={busy || coverBusy || identifying}>
                {busy ? "正在保存…" : "保存"}
              </button>
              <button type="button" className="btn" disabled={busy || coverBusy || identifying} onClick={closeEditor}>
                取消
              </button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function FilterButton({
  label,
  count,
  value,
  current,
  onPick,
}: {
  label: string;
  count: number;
  value: CardFilter;
  current: CardFilter;
  onPick: (value: CardFilter) => void;
}) {
  const active = value === current;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={active ? "cards-filter is-current" : "cards-filter"}
      onClick={() => onPick(value)}
    >
      {label} <span>{count}</span>
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
