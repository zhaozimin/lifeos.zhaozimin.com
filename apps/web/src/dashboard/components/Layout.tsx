/**
 * [INPUT]: 依赖 Router Outlet、shell 的 Rail/TabBar/DomainSidebar/DomainTabs 与领域清单、shell store、渲染故障边界与 fin 域按需搜索入口。
 * [OUTPUT]: 提供 LifeOS 工作台三栏壳（一级栏 + 二级栏 + 内容区）、软刷新信号与 ⌘K 全局搜索。
 * [POS]: 统一面板的稳定外壳；任何时间/财务请求必须下沉到对应领域页面。
 *   一级栏切领域，二级栏切领域内页面；订阅、健康是 iframe 子系统，自带二级栏，内容区为它们铺满且不画宿主二级栏。
 *   全部领域内容自适应铺满，最宽 --lifeos-content-max（sidebar.css）后居中，左右边距 40；滚动条占位只留在真正滚动的一层（宿主 main 或 iframe 文档），右缘一致。
 *   ErrorBoundary 只包 <Outlet/> 而不包整个壳：页面 render 期抛错时两条栏必须活着，
 *   用户才能切到别的页面自救；pathname 作为复位键，切页即自动清除降级态。
 *   软刷新信号有两条出口：outlet context 供直接挂在本层 Outlet 下的时间三页，
 *   useRefreshSignal 供任意深度的页面——财务三页挂在 FinPageFrame 的二级 Outlet 下，
 *   那一层没有透传 context，取到的是 undefined，跨层信号只能走普通 React context。
 * 访问模式控制搜索挂载；访客外壳显示只读标识。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { createContext, useContext, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router";
import {useAccess} from '../../access';
import {domainForAccess} from './shell/domains';
import clsx from "clsx";
import { FinSearchPalette } from "../fin/components/FinSearchPalette";
import { useShellStore } from "../store/shell";
import { ErrorBoundary } from "./ErrorBoundary";
import { DomainSidebar, DomainTabs } from "./shell/DomainSidebar";
import { domainForPath, titleForPath } from "./shell/domains";
import { Rail, TabBar } from "./shell/Rail";

export type LayoutOutletContext = { refreshKey: number };

/**
 * 顶栏「刷新数据」的软刷新信号。
 *
 * outlet context 只到最近的一个 <Outlet>：财务三页挂在 FinPageFrame 的二级 Outlet 下，
 * 那层渲染的是不带 context 的 <Outlet/>，useOutletContext() 在页面里拿到的是 undefined。
 * 于是「刷新数据」曾只对时间三页有效，财务页的取数依赖恒定不重跑——按钮看着生效，
 * 金额、报销待回款、预算却纹丝不动。信号因此额外走一条与路由层级无关的普通 context。
 */
const RefreshSignalContext = createContext(0);

/** 页面把它放进取数依赖，顶栏刷新即重新取数；不在 Layout 下时恒为 0，取数照常只跑一次。 */
export function useRefreshSignal(): number {
  return useContext(RefreshSignalContext);
}

export function Layout() {
  const {owner}=useAccess();
  const [searchOpen, setSearchOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const { pathname } = useLocation();
  const domain = domainForAccess(domainForPath(pathname),owner);
  const title = titleForPath(pathname);
  const sidebarCollapsed = useShellStore((s) => s.sidebarCollapsed);
  const showSidebar = !domain.ownSidebar && !sidebarCollapsed;

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible" && !document.querySelector('[role="dialog"][aria-modal="true"]')) setRefreshKey(v => v + 1); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  // ⌘K / Ctrl+K 打开全局搜索
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if(!owner)return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [owner]);

  return <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground md:flex-row">
    <Rail current={domain} onSearch={() => setSearchOpen(true)} onRefresh={() => setRefreshKey((current) => current + 1)} />
    {showSidebar && <DomainSidebar domain={domain} />}
    {/* 滚动交给整宽内容区，滚动条贴窗口右缘；内容自适应铺满，最宽 --lifeos-content-max 后居中，左右边距 40（窄屏 16/24）。
        滚动条占位只留在真正滚动的那一层：宿主页留在 main，iframe 子系统留在自己的文档，右缘因此一致 */}
    <main className={clsx("min-h-0 min-w-0 flex-1 overflow-y-auto", !domain.embedded && "[scrollbar-gutter:stable]")}>
      {!owner&&<div className="border-b border-border bg-zzm-fill px-4 py-2 text-xs">访客模式 · 公开只读 · 敏感数据不加载</div>}
      <div className={clsx("flex h-full w-full flex-col", !domain.embedded && "mx-auto max-w-[calc(var(--lifeos-content-max)+80px)] px-4 pt-6 pb-4 sm:px-6 lg:px-10")}>
        {!domain.ownSidebar && <DomainTabs domain={domain} />}
        <ErrorBoundary label={title} resetKey={pathname}>
          <RefreshSignalContext.Provider value={refreshKey}>
            <Outlet context={{ refreshKey } satisfies LayoutOutletContext} />
          </RefreshSignalContext.Provider>
        </ErrorBoundary>
      </div>
    </main>
    <TabBar current={domain} />
    {owner&&<FinSearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />}
  </div>;
}
