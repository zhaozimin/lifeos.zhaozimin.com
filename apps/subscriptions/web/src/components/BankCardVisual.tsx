/**
 * [INPUT]: 依赖 types 的银行卡视图字段与 Veil 的脱敏显示，借 cover_source_url 区分公开原卡图与 AI 无文字底图
 * [OUTPUT]: 对外提供 Apple Wallet 式银行卡卡面、公开原卡图无覆盖展示、AI 底图上的本地动态管理字段、状态/类型/组织标签格式化能力
 * [POS]: components 的银行卡纯视觉组件，由卡包清单与编辑器实时预览共同消费；AI 只画背景，准确文字与尾号始终由本地数据层呈现
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Veil } from "./Veil";
import type {
  BankCard,
  CardKind,
  CardNetwork,
  CardStatus,
  CardType,
} from "../types";

export type BankCardVisualData = Pick<
  BankCard,
  | "name"
  | "kind"
  | "issuer"
  | "card_type"
  | "network"
  | "last4"
  | "currency"
  | "expiry_month"
  | "status"
  | "cover_src"
  | "cover_source_url"
>;

export function BankCardVisual({
  card,
  selected,
  onSelect,
  preview = false,
}: {
  card: BankCardVisualData;
  selected?: boolean;
  onSelect?: () => void;
  preview?: boolean;
}) {
  const aiCover = card.cover_source_url.startsWith("https://api.openai.com/");
  const className = [
    "wallet-card",
    `is-${card.status}`,
    `is-network-${card.network}`,
    card.kind === "virtual_card" ? "is-virtual-card" : "",
    card.cover_src ? "has-cover" : "",
    aiCover ? "is-ai-cover" : "",
    selected ? "is-selected" : "",
    preview ? "is-preview" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const label = `${card.issuer || "未命名机构"} ${card.name || "未命名卡片"}，末四位 ${card.last4 || "未填写"}`;
  const content = (
    <>
      {card.cover_src ? <img className="wallet-card-cover" src={card.cover_src} alt="" /> : null}
      <span className="wallet-card-sheen" aria-hidden="true" />
      <span className="wallet-card-content">
        <span className="wallet-card-topline">
          <span className="wallet-card-issuer">{card.issuer || "发卡机构"}</span>
          <span className={`card-status is-${card.status}`}>{cardStatusLabel(card.status)}</span>
        </span>
        <span className="wallet-card-title">
          <span>{card.name || "卡片名称"}</span>
          <small>{kindLabel(card.kind)}</small>
        </span>
        <span className="wallet-card-chip" aria-hidden="true">
          <i />
        </span>
        <span className="wallet-card-number" aria-label={`卡号末四位 ${card.last4 || "未填写"}`}>
          <span>••••</span>
          <span>••••</span>
          <span>••••</span>
          <Veil>{card.last4 || "••••"}</Veil>
        </span>
        <span className="wallet-card-footline">
          <span>
            {cardTypeLabel(card.card_type)} · {card.currency || "CNY"}
          </span>
          <strong>{networkLabel(card.network)}</strong>
        </span>
      </span>
    </>
  );

  if (!onSelect) {
    return (
      <div className={className} aria-label={label}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      aria-pressed={selected === undefined ? undefined : selected}
      onClick={onSelect}
    >
      {content}
    </button>
  );
}

export function cardStatusLabel(status: CardStatus): string {
  if (status === "frozen") return "已冻结";
  if (status === "closed") return "已注销";
  return "正常";
}

export function cardTypeLabel(type: CardType): string {
  if (type === "debit") return "借记";
  if (type === "prepaid") return "预付";
  return "信用";
}

export function kindLabel(kind: CardKind): string {
  return kind === "physical_card" ? "实体卡" : "虚拟卡";
}

export function networkLabel(network: CardNetwork): string {
  return (
    {
      unionpay: "UnionPay",
      visa: "VISA",
      mastercard: "Mastercard",
      amex: "AMEX",
      jcb: "JCB",
      discover: "Discover",
      other: "CARD",
    } as const
  )[network];
}
