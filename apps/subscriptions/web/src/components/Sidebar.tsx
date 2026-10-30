/**
 * [INPUT]: 依赖 shell 的筛选汇总、Router、icons 与工作台共用 sidebar.css。
 * [OUTPUT]: 提供订阅侧栏：领域标题、图标导航、分类、到期状态与独立设置入口。
 * [POS]: 订阅域二级栏；与健康共用几何，不显示子系统品牌。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { yuan } from "../lib/format";
import { useShell, type CardFilter } from "../shell";
import {
  FilterIcon,
  IconCard,
  IconChart,
  IconHome,
  IconPlus,
  IconSliders,
} from "./icons";
import { VeilToggle } from "./Veil";
import {isVisitor} from '../visitor';

export function Sidebar() {
  const { filter, setFilter, categories, summary } = useShell();
  const location = useLocation();
  const navigate = useNavigate();
  const onBoard =
    location.pathname === "/" || location.pathname === "/new" || location.pathname.startsWith("/s/");

  function pickFilter(next: CardFilter) {
    setFilter(next);
    if (!onBoard) navigate("/");
  }

  const monthly = summary ? yuan(summary.monthly_yuan) : "—";

  return (
    <aside className="sidebar workspace-sidebar workspace-sidebar--embedded" aria-label="订阅导航">
      <h2 className="workspace-side-heading">订阅</h2>
      <nav className="sidebar-nav workspace-nav" aria-label="主要页面">
        <NavLink to="/" end className={navClass}>
          <IconHome className="sidebar-ico" />
          订阅总览
        </NavLink>
        <NavLink to="/stats" className={navClass}>
          <IconChart className="sidebar-ico" />
          订阅统计
        </NavLink>
        <NavLink to="/cards" className={navClass}>
          <IconCard className="sidebar-ico" />
          银行卡
        </NavLink>
        <NavLink to="/methods" className={navClass}>
          <IconSliders className="sidebar-ico" />
          订阅设置
        </NavLink>
      </nav>

      <div className="sidebar-content">
        <div className="sidebar-monthly">
          <p className="sidebar-monthly-label">折合每月</p>
          <p className="sidebar-monthly-value">{monthly}</p>
        </div>
        <div className="sidebar-block">
          <p className="sidebar-label">分类</p>
          <div className="sidebar-scroller">
            <div className="sidebar-tags" role="tablist" aria-label="筛选订阅">
              <Tag
                id="all"
                label="全部"
                count={summary?.active_count}
                current={filter}
                active={onBoard}
                onPick={pickFilter}
              />
              {categories.map((cat) => (
                <Tag
                  key={cat.id}
                  id={cat.id}
                  label={cat.name}
                  count={summary?.by_category.find((row) => row.id === cat.id)?.active_count}
                  current={filter}
                  active={onBoard}
                  onPick={pickFilter}
                />
              ))}
            </div>
            <div className="sidebar-tags sidebar-tags-status" role="tablist" aria-label="到期状态">
              <Tag
                id="soon"
                label="即将到期"
                count={summary?.soon_count}
                current={filter}
                active={onBoard}
                onPick={pickFilter}
              />
              <Tag
                id="paused"
                label="已暂停"
                count={summary?.paused_count}
                current={filter}
                active={onBoard}
                onPick={pickFilter}
              />
              <Tag
                id="ended"
                label="已取消 / 结束"
                count={summary?.ended_count}
                current={filter}
                active={onBoard}
                onPick={pickFilter}
              />
              <Tag
                id="overdue"
                label="已过期"
                count={summary?.overdue_count}
                current={filter}
                active={onBoard}
                onPick={pickFilter}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="sidebar-foot">
        <VeilToggle label="脱敏" />
        <NavLink to="/new" aria-disabled={isVisitor()} className="btn btn-zhu sidebar-new">
          <IconPlus className="sidebar-ico" />
          新订阅
        </NavLink>
      </div>
    </aside>
  );
}

function navClass({ isActive }: { isActive: boolean }): string {
  return ["workspace-link", isActive ? "is-current" : ""].filter(Boolean).join(" ");
}

function Tag({
  id,
  label,
  count,
  current,
  active,
  onPick,
}: {
  id: string;
  label: string;
  count?: number;
  current: string;
  active: boolean;
  onPick: (id: string) => void;
}) {
  const selected = active && current === id;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={selected ? "workspace-link sidebar-tag is-current" : "workspace-link sidebar-tag"}
      onClick={() => onPick(id)}
    >
      <FilterIcon id={id} name={label} className="sidebar-ico" />
      <span className="sidebar-tag-text">{label}</span>
      {typeof count === "number" ? <span className="sidebar-count">{count}</span> : null}
    </button>
  );
}
