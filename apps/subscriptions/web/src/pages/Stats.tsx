/**
 * [INPUT]: 依赖 api 的汇总与订阅列表，依赖 SpendChart、BrandMark
 * [OUTPUT]: 对外提供统计页。页标走 page-title。年化/预计一年、可悬停走势图、分类月费、各工具回推
 * [POS]: pages 的统计。主页不堆这些数
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useRefresh } from "../lib/refresh";
import { useAsyncScope } from "../lib/asyncScope";
import { api } from "../api";
import { BrandMark } from "../components/BrandMark";
import { SpendChart } from "../components/SpendChart";
import { cycleLabel, yuan } from "../lib/format";
import type { Subscription, Summary } from "../types";
import {isVisitor} from '../visitor';

export function StatsPage() {
  const [items, setItems] = useState<Subscription[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");

  const readScope = useAsyncScope();
  async function load() {
    const current = readScope.begin();
    try {
      const [list, nextSummary] = await Promise.all([api.listSubscriptions(), api.summary()]);
      if (!current()) return;
      setItems(list.items);
      setSummary(nextSummary);
      setError("");
    } catch (err) {
      if (!current()) return;
      setError(err instanceof Error ? err.message : "加载失败");
    }
  }

  useRefresh(load);

  const tools = useMemo(() => {
    if (!items) return [];
    return items
      .filter((item) => item.status === "active")
      .slice()
      .sort((a, b) => b.spent_fen - a.spent_fen || a.name.localeCompare(b.name, "zh"));
  }, [items]);

  if (error && !items) {
    return <p className="error-text">{error}</p>;
  }
  if (!items || !summary) {
    return <p className="quiet">正在读取订阅数据…</p>;
  }

  return (
    <div>
      <header>
        <h1 className="page-title">统计</h1>
        <p className="page-lead">
          本月账单日将扣 <span className="money">{yuan(summary.this_month_yuan)}</span> ·{" "}
          {summary.active_count} 条生效
        </p>
        <p className="page-note">
          年化是把每笔按周期折成一年。预计是按当前账单日往后走 12 个月的实扣，不是银行流水。
        </p>
      </header>

      <div className="stat-kpis mt-6">
        <article className="stat-kpi">
          <p className="meta">年化订阅</p>
          <p className="stat-kpi-value mt-2">{yuan(summary.yearly_yuan)}</p>
          <p className="page-note">一年里所有生效订阅折合总额</p>
        </article>
        <article className="stat-kpi">
          <p className="meta">预计一年</p>
          <p className="stat-kpi-value mt-2">{yuan(summary.projected_yuan)}</p>
          <p className="page-note">按当前扣款日往后走 12 个月</p>
        </article>
      </div>

      {summary.curve.length > 0 ? <SpendChart points={summary.curve} /> : null}

      {summary.by_category.length > 0 ? (
        <section className="mt-10">
          <h2 className="section-title">分类</h2>
          <ul className="mt-4 divide-y divide-[var(--hairline)]">
            {summary.by_category.map((row) => (
              <li key={row.id} className="flex items-baseline justify-between gap-4 py-2.5">
                <span>
                  {row.name}
                  <span className="caption ml-2">{row.active_count} 条</span>
                </span>
                <span className="money">
                  {yuan(row.monthly_yuan)} / 月
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-10">
        <h2 className="section-title">各工具近一年回推</h2>
        {tools.length === 0 ? (
          <p className="quiet mt-4">还没有生效的订阅。</p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--hairline)]">
            {tools.map((item) => (
              <li key={item.id}>
                <Link
                  to={`/s/${item.id}`}
                  className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 py-3"
                >
                  <BrandMark
                    name={item.name}
                    website={item.website}
                    logoSrc={item.logo_src}
                    size={36}
                  />
                  <div className="min-w-0">
                    <p className="card-title truncate">{item.name}</p>
                    <p className="caption mt-0.5 truncate">
                      {yuan(item.amount_yuan)} / {cycleLabel(item.cycle, item.cycle_days)}
                      {item.category_name ? ` · ${item.category_name}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="money">{yuan(item.spent_yuan)}</p>
                    <p className="caption mt-0.5">
                      {isVisitor()?"••••":item.spent_count} 次 · 未来一年{" "}
                      <span className="money">{yuan(item.upcoming_yuan)}</span>
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
