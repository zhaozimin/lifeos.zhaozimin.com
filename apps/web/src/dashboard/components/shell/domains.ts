/**
 * [INPUT]: 依赖 lucide 图标及类型。
 * [OUTPUT]: 对外提供 DOMAINS（一级栏的领域清单）、SETTINGS_DOMAIN 与 domainForPath、titleForPath。
 * [POS]: 工作台导航的唯一真源；一级栏、二级栏、窄屏底栏与故障边界标题都从这里取，不各写一份路由表。
 *   各领域设置留在本领域路径；全局设置只服务 LifeOS。
 *   embedded 领域（订阅、健康）是 iframe 子系统，内容区铺满；订阅 ownSidebar 自带二级栏，
 *   健康由宿主画二级栏（导航与日历同其他领域一个组件），iframe 只显示内容。
 * domainForAccess返回访客导航投影，不改动原领域真源。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { LucideIcon } from "lucide-react";
import { Activity, ArrowLeftRight, CalendarDays, LayoutGrid, Leaf, NotebookPen, TrendingUp, ChartNoAxesCombined, HeartPulse, History, Inbox, Landmark, List, Repeat, Settings, SlidersHorizontal } from "lucide-react";

export type DomainId = "time" | "finance" | "subscriptions" | "health" | "records" | "settings";

export type NavItem = { to: string; label: string; icon: LucideIcon; matchPrefix?: string };

export interface Domain {
  id: DomainId;
  label: string;
  icon: LucideIcon;
  /** 一级栏点击后去的页面 */
  home: string;
  /** 路径前缀命中即属于本领域 */
  prefixes: string[];
  /** 二级栏导航；ownSidebar 领域为空 */
  nav: NavItem[];
  /** iframe 子系统：内容区铺满，不加宿主内边距 */
  embedded?: boolean;
  /** iframe 自带二级栏：宿主不画二级栏，也不显示收起键 */
  ownSidebar?: boolean;
}

export const DOMAINS: Domain[] = [
  {
    id: "time", label: "时间", icon: CalendarDays, home: "/time/day", prefixes: ["/time"],
    nav: [
      { to: "/time/day", label: "今天", icon: CalendarDays },
      { to: "/time/stats", label: "时间统计", icon: ChartNoAxesCombined },
      { to: "/time/settings/catalog", label: "时间设置", icon: SlidersHorizontal, matchPrefix: "/time/settings" },
    ],
  },
  {
    id: "finance", label: "财务", icon: Landmark, home: "/fin/status", prefixes: ["/fin"],
    nav: [
      { to: "/fin/status", label: "财务状况", icon: Landmark },
      { to: "/fin/ledger", label: "资金流水", icon: List },
      { to: "/fin/flow", label: "资金流量", icon: ArrowLeftRight },
      { to: "/fin/settings/accounts", label: "财务设置", icon: SlidersHorizontal, matchPrefix: "/fin/settings" },
    ],
  },
  { id: "subscriptions", label: "订阅", icon: Repeat, home: "/subscriptions", prefixes: ["/subscriptions"], nav: [], embedded: true, ownSidebar: true },
  {
    id: "health", label: "健康", icon: HeartPulse, home: "/health/overview", prefixes: ["/health"], embedded: true,
    nav: [
      { to: "/health/overview", label: "身体总览", icon: LayoutGrid },
      { to: "/health/trends", label: "趋势分析", icon: TrendingUp },
      { to: "/health/plans", label: "每日健康建议", icon: Leaf },
      { to: "/health/workouts", label: "训练记录", icon: Activity },
      { to: "/health/journal", label: "生活记录", icon: NotebookPen },
      { to: "/health/settings", label: "健康设置", icon: SlidersHorizontal },
    ],
  },
  {
    id: "records", label: "记录", icon: History, home: "/records", prefixes: ["/records", "/inbox"],
    nav: [
      { to: "/records", label: "历史记录", icon: History },
      { to: "/inbox", label: "原话收件箱", icon: Inbox },
      { to: "/records/settings/list", label: "记录设置", icon: SlidersHorizontal, matchPrefix: "/records/settings" },
    ],
  },
];

// LifeOS 设置独立于领域设置，二级栏清单由 SettingsHub 提供
export const SETTINGS_DOMAIN: Domain = {
  id: "settings", label: "LifeOS 设置", icon: Settings, home: "/settings", prefixes: ["/settings", "/security"], nav: [],
};

export function domainForPath(pathname: string): Domain {
  return [...DOMAINS, SETTINGS_DOMAIN].find((domain) => domain.prefixes.some((prefix) => pathname.startsWith(prefix))) ?? DOMAINS[0];
}

export function titleForPath(pathname: string): string {
  const domain = domainForPath(pathname);
  return domain.nav.find((item) => item.to === pathname)?.label ?? domain.label;
}
export function domainForAccess(domain:Domain,owner:boolean):Domain{
 if(owner)return domain;
 const nav=domain.nav.filter(n=>domain.id==='health'||!n.to.includes('/settings'));
 if(domain.id==='subscriptions')return domain;
 return {...domain,nav};
}
