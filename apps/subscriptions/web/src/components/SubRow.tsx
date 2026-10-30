/**
 * [INPUT]: 依赖 format、BrandMark 与 CycleRing/BalanceRing 只读指标
 * [OUTPUT]: 提供可排序订阅卡片；余额式显示可抵扣月数或余额缺口，扣款式显示倒计时
 * [POS]: components 的主列表单元
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DragEvent } from "react";
import { Link } from "react-router-dom";
import { cycleLabel, yuan } from "../lib/format";
import type { Subscription } from "../types";
import { BrandMark } from "./BrandMark";
import { BalanceRing, CycleRing, isEnded } from "./CycleRing";
import { Veil } from "./Veil";

export function SubRow({
  item,
  draggable = false,
  dragging = false,
  dropReady = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  item: Subscription;
  draggable?: boolean;
  dragging?: boolean;
  dropReady?: boolean;
  onDragStart?: (event: DragEvent<HTMLLIElement>) => void;
  onDragOver?: (event: DragEvent<HTMLLIElement>) => void;
  onDrop?: (event: DragEvent<HTMLLIElement>) => void;
  onDragEnd?: (event: DragEvent<HTMLLIElement>) => void;
}) {
  const paused = item.status === "paused";
  const ended = isEnded(item.days_left, item.status, item.display_status);
  const account = item.account_identifier || item.account_label || "未指定账号";
  const sensitive = Boolean(item.account_identifier);
  return (
    <li
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div
        className={[
          paused ? "sub-card sub-card-paused" : ended ? "sub-card sub-card-ended" : "sub-card",
          draggable ? "is-sortable" : "",
          dragging ? "is-dragging" : "",
          dropReady ? "is-drop" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <Link to={`/s/${item.id}`} className="sub-card-body" draggable={false}>
          <BrandMark name={item.name} website={item.website} logoSrc={item.logo_src} size={40} />
          <div className="sub-card-copy">
            <h3 className="card-title truncate">
              {item.name}
              {paused ? (
                <span className="caption ml-2 font-normal">{item.balance_stopped ? "已停止" : "已暂停"}</span>
              ) : item.status === "cancelled" ? (
                <span className="caption ml-2 font-normal">已取消</span>
              ) : item.urgency === "overdue" ? (
                <span className="caption ml-2 font-normal text-[var(--zhu-text)]">已过期</span>
              ) : item.urgency === "today" ? (
                <span className="caption ml-2 font-normal text-[var(--zhu-text)]">今天</span>
              ) : null}
            </h3>
            <p className="caption mt-0.5 truncate">
              {sensitive ? <Veil>{account}</Veil> : account}
            </p>
            <p className="money meta mt-1.5 truncate">
              {yuan(item.amount_yuan)} / {cycleLabel(item.cycle, item.cycle_days)}
            </p>
          </div>
          {item.billing_mode === "balance"
            ? <BalanceRing balanceFen={item.balance_fen} amountFen={item.amount_fen} cycle={item.cycle} cycleDays={item.cycle_days} />
            : <CycleRing daysLeft={item.days_left} ratio={item.remain_ratio} ended={ended} />}
        </Link>
      </div>
    </li>
  );
}
