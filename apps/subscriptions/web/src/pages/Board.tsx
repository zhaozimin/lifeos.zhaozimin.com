/**
 * [INPUT]: 依赖 api 拉列表，依赖 shell 的筛选与分类，依赖 SubRow
 * [OUTPUT]: 对外提供主列卡片。全部与分类只摆生效中的，取消/结束有独立入口，与边栏计数同口径。每个分类都带名称和月合计。换分类淡入淡出
 * [POS]: pages 的主页。统计 / 设置走边栏，提醒在 App 壳上。卡片网格按标准卡宽自动排列列数（sub-grid）
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useRefresh } from "../lib/refresh";
import { useAsyncScope } from "../lib/asyncScope";
import { api } from "../api";
import { FadeSwap } from "../components/FadeSwap";
import { SubRow } from "../components/SubRow";
import { yuan } from "../lib/format";
import { useShell } from "../shell";
import type { Subscription } from "../types";
import {isVisitor} from '../visitor';

export function BoardPage() {
  const { filter, categories, summary } = useShell();
  const [items, setItems] = useState<Subscription[] | null>(null);
  const [error, setError] = useState("");
  const loadSeq = useRef(0);

  const readScope = useAsyncScope();
  async function load() {
    const current = readScope.begin();
    const seq = (loadSeq.current += 1);
    try {
      const list = await api.listSubscriptions();
      if (!current() || seq !== loadSeq.current) return;
      setItems(list.items);
      setError("");
    } catch (err) {
      if (!current() || seq !== loadSeq.current) return;
      setError(err instanceof Error ? err.message : "加载失败");
    }
  }

  useRefresh(load);

  const visible = useMemo(() => {
    if (!items) return [];
    return items.filter((item) => {
      if (filter === "soon") {
        return item.status === "active" && (item.urgency === "soon" || item.urgency === "today");
      }
      // 暂停的时钟是冻住的，urgency 恒为 ok，不会混进「已过期」
      if (filter === "ended") return item.status === "cancelled" || item.status === "expired";
      if (filter === "paused") return item.status === "paused";
      if (filter === "overdue") return item.urgency === "overdue";
      // 全部和各分类只摆正在进行的。暂停、取消、到期各有各的入口。
      // 边栏计数和分类头上的月合计本来就只算 active，卡片跟着对齐，
      // 数字才不会跟眼睛看到的打架。过了账单日还没确认的仍是 active，
      // 留在板上标红——那正是首页该喊的一笔。
      if (item.status !== "active") return false;
      if (filter !== "all") return (item.category_id || "") === filter;
      return true;
    });
  }, [items, filter]);

  const groups = useMemo(() => {
    const map = new Map<string, Subscription[]>();
    for (const item of visible) {
      const key = item.category_id || "uncat";
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    const order = new Map(categories.map((cat, index) => [cat.id, cat.sort_order * 100 + index]));
    return [...map.entries()]
      .sort((a, b) => (order.get(a[0]) ?? 999) - (order.get(b[0]) ?? 999))
      .map(([id, list]) => ({
        id,
        name:
          id === "uncat"
            ? "未分类"
            : list[0]?.category_name || categories.find((cat) => cat.id === id)?.name || "未分类",
        monthly:
          filter === "soon" || filter === "overdue" || filter === "paused" || filter === "ended"
            ? undefined
            : summary?.by_category.find((row) => row.id === id)?.monthly_yuan,
        items: list.slice().sort((a, b) => {
          const order = (a.sort_order ?? 0) - (b.sort_order ?? 0);
          if (order !== 0) return order;
          return a.name.localeCompare(b.name, "zh");
        }),
      }));
  }, [visible, categories, summary, filter]);

  async function applyOrder(categoryId: string, ids: string[]) {
    setItems((prev) => {
      if (!prev) return prev;
      const rank = new Map(ids.map((id, index) => [id, (index + 1) * 10]));
      return prev.map((item) => {
        const next = rank.get(item.id);
        return next === undefined ? item : { ...item, sort_order: next };
      });
    });
    try {
      await api.reorderSubscriptions(categoryId, ids);
    } catch (err) {
      setError(err instanceof Error ? err.message : "排序失败");
      void load();
    }
  }

  if (error && !items) {
    return <p className="error-text">{error}</p>;
  }

  if (!items) {
    return <p className="quiet">正在读取订阅数据…</p>;
  }

  return (
    <div>
      {error ? <p className="error-text mb-4">{error}</p> : null}
      <FadeSwap token={filter}>
        {items.length === 0 ? (
          <EmptyState />
        ) : groups.length === 0 ? (
          <p className="quiet">这一栏是空的。</p>
        ) : (
          <div>
            {groups.map((group) => (
              <section key={group.id} className={groups.length > 1 ? "mt-10 first:mt-0" : ""}>
                <header className="mb-4 flex items-baseline gap-2">
                  <h2 className="section-title is-quiet">{group.name}</h2>
                  {group.monthly ? (
                    <p className="money meta">{yuan(group.monthly)} / 月</p>
                  ) : null}
                </header>
                <SortableCards
                  categoryId={group.id === "uncat" ? "" : group.id}
                  items={group.items}
                  enabled={
                    !isVisitor()&&
                    filter !== "soon" &&
                    filter !== "paused" &&
                    filter !== "ended" &&
                    filter !== "overdue" &&
                    group.items.length > 1
                  }
                  onReorder={applyOrder}
                />
              </section>
            ))}
          </div>
        )}
      </FadeSwap>
    </div>
  );
}

function SortableCards({
  categoryId,
  items,
  enabled,
  onReorder,
}: {
  categoryId: string;
  items: Subscription[];
  enabled: boolean;
  onReorder: (categoryId: string, ids: string[]) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    return () => {
      window.removeEventListener("click", swallowClick, true);
    };
  }, []);

  function finishDrop(targetId: string) {
    const source = dragIdRef.current;
    if (!source || source === targetId) return;
    const ids = items.map((item) => item.id);
    const from = ids.indexOf(source);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, source);
    onReorder(categoryId, ids);
  }

  return (
    <ul className="sub-grid">
      {items.map((item) => (
        <SubRow
          key={item.id}
          item={item}
          draggable={enabled}
          dragging={dragId === item.id}
          dropReady={Boolean(dragId && overId === item.id && dragId !== item.id)}
          onDragStart={(event) => {
            if (!enabled) return;
            moved.current = false;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", item.id);
            dragIdRef.current = item.id;
            setDragId(item.id);
          }}
          onDragOver={(event) => {
            if (!enabled || !dragIdRef.current) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            moved.current = true;
            if (overId !== item.id) setOverId(item.id);
          }}
          onDrop={(event) => {
            event.preventDefault();
            finishDrop(item.id);
            dragIdRef.current = null;
            setDragId(null);
            setOverId(null);
          }}
          onDragEnd={() => {
            if (moved.current) {
              window.addEventListener("click", swallowClick, { capture: true, once: true });
              window.setTimeout(() => {
                window.removeEventListener("click", swallowClick, true);
              }, 400);
            }
            dragIdRef.current = null;
            setDragId(null);
            setOverId(null);
          }}
        />
      ))}
    </ul>
  );
}

function swallowClick(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  window.removeEventListener("click", swallowClick, true);
}

function EmptyState() {
  return (
    <section className="mt-16 max-w-[28rem]">
      <h1 className="page-title">还没有任何订阅。</h1>
      <p className="page-lead">
        写下网站、金额和下次扣款日。填对网站，已知服务会自动套商店方图。
      </p>
      <div className="mt-6">
        <Link to="/new" className="btn btn-zhu">
          添加订阅
        </Link>
      </div>
    </section>
  );
}
