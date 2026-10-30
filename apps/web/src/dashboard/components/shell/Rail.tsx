/**
 * [INPUT]: 依赖 Router 的 Link、domains 领域清单、shell store 的二级栏收起状态、ThemeSwitcher、StatusIndicator 与 ProductLogo。
 * [OUTPUT]: 对外提供 Rail（桌面一级栏，56px 仅图标）与 TabBar（窄屏底部标签条）。
 * [POS]: 工作台的系统切换层；只切换领域与全局动作，不承载任何领域内导航。
 *   当前项按领域判定，进入资金流水等子页仍高亮所属领域。
 *   收起键固定在一级栏里：二级栏展开与收起时它的坐标不变（设计系统侧栏规范的零位移）。
 * 本人可退出；访客不显示登录入口，权限由服务端验证。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Link } from "react-router";
import { LogOut, PanelLeftClose, PanelLeftOpen, RefreshCw, Search } from "lucide-react";
import {useAccess} from '../../../access';
import { logout } from "../../api/core";
import { useShellStore } from "../../store/shell";
import { ProductLogo } from "../ProductLogo";
import { StatusIndicator } from "../StatusIndicator";
import { ThemeSwitcher } from "../ThemeSwitcher";
import { DOMAINS, SETTINGS_DOMAIN, type Domain } from "./domains";

const ICON = { size: 18, strokeWidth: 1.5 } as const;

function DomainLink({ domain, active }: { domain: Domain; active: boolean }) {
  return (
    <Link to={domain.home} className="rail-item" data-tip={domain.label} aria-label={domain.label} aria-current={active ? "page" : undefined}>
      <domain.icon {...ICON} />
    </Link>
  );
}

export function Rail({
  current,
  onSearch,
  onRefresh,
}: {
  current: Domain;
  onSearch: () => void;
  onRefresh: () => void;
}) {
  const {owner}=useAccess();
  const collapsed = useShellStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useShellStore((s) => s.toggleSidebar);
  // iframe 子系统自带二级栏，宿主的收起键对它无效，所以不显示
  const canToggle = !current.ownSidebar;

  return (
    <nav aria-label="系统" className="hidden w-14 flex-none flex-col items-center gap-1 border-r border-[var(--zzm-hairline)] bg-background py-3 md:flex">
      <div className="mb-3 grid h-10 place-items-center" title="LifeOS">
        <ProductLogo compact />
      </div>
      {owner&&<button type="button" className="rail-item" data-tip="搜索 ⌘K" aria-label="全局搜索" onClick={onSearch}>
        <Search {...ICON} />
      </button>}
      <div className="my-2 h-px w-6 bg-[var(--zzm-hairline-2)]" aria-hidden />
      {DOMAINS.map((domain) => <DomainLink key={domain.id} domain={domain} active={domain.id === current.id} />)}

      <div className="mt-auto flex flex-col items-center gap-1">
        {canToggle && (
          <button
            type="button"
            className="rail-item"
            data-tip={collapsed ? "展开侧栏" : "收起侧栏"}
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
            aria-pressed={collapsed}
            onClick={toggleSidebar}
          >
            {collapsed ? <PanelLeftOpen {...ICON} /> : <PanelLeftClose {...ICON} />}
          </button>
        )}
        <ThemeSwitcher compact />
        <button type="button" className="rail-item" data-tip="刷新数据" aria-label="刷新数据" onClick={onRefresh}>
          <RefreshCw {...ICON} />
        </button>
        <StatusIndicator compact />
        {owner&&<DomainLink domain={SETTINGS_DOMAIN} active={current.id === SETTINGS_DOMAIN.id} />}
        {owner&&<button type="button" className="rail-item" data-tip="退出登录" aria-label="退出登录" onClick={() => { void logout(); }}>
          <LogOut {...ICON} />
        </button>}
      </div>
    </nav>
  );
}

// 窄屏：领域与设置排成底部标签条，图标下常显名称；亮暗与退出在设置里
export function TabBar({ current }: { current: Domain }) {
  const {owner}=useAccess();
  return (
    <nav aria-label="系统" className="safe-bottom flex flex-none items-stretch justify-around border-t border-[var(--zzm-hairline)] bg-background md:hidden">
      {[...DOMAINS, ...(owner?[SETTINGS_DOMAIN]:[])].map((domain) => (
        <Link
          key={domain.id}
          to={domain.home}
          aria-current={domain.id === current.id ? "page" : undefined}
          className="flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px] leading-4 text-zzm-muted aria-[current=page]:font-semibold aria-[current=page]:text-foreground"
        >
          <domain.icon size={18} strokeWidth={1.5} />
          {domain.label}
        </Link>
      ))}
    </nav>
  );
}
