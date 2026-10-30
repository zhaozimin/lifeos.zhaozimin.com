/**
 * [INPUT]: 依赖 BankCardVisual 的标准/AI 卡面与 types 的银行卡详情，接收筛选后的卡片和编辑/新增回调
 * [OUTPUT]: 对外提供 Apple Wallet 式层叠卡包；点按任意实体卡面直接进入该卡编辑，筛选为空时保留安全空状态
 * [POS]: components 的银行卡卡包编排器；不维护选中详情态，不介入卡片过滤、识别或持久化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { BankCardVisual, type BankCardVisualData } from "./BankCardVisual";
import type { BankCard } from "../types";

const EMPTY_PREVIEW_CARD: BankCardVisualData = {
  name: "你的第一张卡",
  kind: "physical_card",
  issuer: "SubOS Wallet",
  card_type: "credit",
  network: "visa",
  last4: "••••",
  currency: "CNY",
  expiry_month: "",
  status: "active",
  cover_src: "",
  cover_source_url: "",
};

export function CardWallet({
  cards,
  hasAnyCard,
  onEdit,
  onCreate,
}: {
  cards: BankCard[];
  hasAnyCard: boolean;
  onEdit: (card: BankCard) => void;
  onCreate: () => void;
}) {
  return (
    <div className="wallet-layout mt-6">
      <section className="wallet-stage" aria-label="银行卡卡包">
        <div className="wallet-stage-head">
          <div>
            <span className="wallet-kicker">MY WALLET</span>
            <h2>{cards.length ? "我的卡片" : "你的卡包"}</h2>
          </div>
          <span className="wallet-count">{cards.length ? `${cards.length} 张` : "等待第一张"}</span>
        </div>
        {cards.length ? (
          <div
            className="wallet-deck"
            style={{ paddingBottom: `calc(63.05% + ${Math.max(0, cards.length - 1) * 58}px)` }}
          >
            {cards.map((card, index) => (
              <div
                className="wallet-deck-item"
                key={card.id}
                style={{ top: `${index * 58}px`, zIndex: index + 1 }}
              >
                <BankCardVisual card={card} onSelect={() => onEdit(card)} />
              </div>
            ))}
          </div>
        ) : (
          <div className="wallet-empty-preview">
            <BankCardVisual card={EMPTY_PREVIEW_CARD} preview />
            <p>{hasAnyCard ? "这个筛选下还没有卡。" : "加入第一张卡，卡包会在这里层叠展开。"}</p>
          </div>
        )}
        <p className="wallet-stage-hint">
          {cards.length ? "点击卡片本身，直接查看和编辑这张卡。" : "卡面比例和层叠方式采用 Wallet 式布局。"}
        </p>
        {!cards.length && !hasAnyCard ? (
          <button type="button" className="btn btn-zhu wallet-create-button" onClick={onCreate}>
            记下第一张卡
          </button>
        ) : null}
      </section>
    </div>
  );
}
