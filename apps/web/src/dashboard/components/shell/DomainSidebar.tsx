/**
 * [INPUT]: 依赖导航、领域设置清单、时间来源 store 与 SidebarSlot 的底部插槽标识。
 * [OUTPUT]: 对外提供 DomainSidebar（桌面二级栏，266px）与 DomainTabs（窄屏导航和时间来源筛选）。
 * [POS]: 工作台的领域内导航层；只服务宿主自绘的领域（时间、财务、记录、设置）。
 *   骨架恒定：标题、导航、底部日期插槽；有日期范围的页面经 SidebarSlot 把 RangePanel 投放到插槽，
 *   没有日期范围的页面（设置、收件箱）显示兜底今天月历；五个领域的导航起点与日历位置像素级一致。时间今天页在导航下方附来源筛选；
 *   窄屏保留来源筛选，导航不随页面内容压缩高度。
 *   主数据仅在财务设置内展开。
 *   领域设置在本领域展开；LifeOS 设置只显示全局选项。
 *   订阅与健康复用 sidebar.css，自绘导航内容。
 * 访客不展开领域设置，导航只来自公开视图清单。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useMemo } from "react";
import {useAccess} from '../../../access';
import { Link, useLocation } from "react-router";
import { Bot, Download, Layers, PenLine, Watch } from "lucide-react";
import { settingsNavFor } from "../../settings/SettingsHub";
import { useTimeViewStore, type TimeSourceFilter } from "../../store/timeView";
import { Select } from "../ui/Select";
import type { Domain, NavItem } from "./domains";
import { SIDEBAR_RANGE_SLOT_ID, SidebarRangeFallback } from "./SidebarSlot";

const SOURCES = [
  { value: "all", label: "全部来源", icon: Layers },
  { value: "agent", label: "微信 AI", icon: Bot },
  { value: "manual", label: "手动", icon: PenLine },
  { value: "import", label: "导入", icon: Download },
  { value: "device", label: "WHOOP", icon: Watch },
] satisfies Array<{ value: TimeSourceFilter; label: string; icon: NavItem["icon"] }>;

type NavGroup = { label?: string; items: NavItem[] };

function groupsFor(domain: Domain, pathname: string): NavGroup[] {
  const settings = settingsNavFor(domain.id);
  if (domain.id === "settings") return [{ items: settings }];
  if (settings.length > 1 && /\/(?:time|fin|records)\/settings(?:\/|$)/.test(pathname)) return [
    { items: domain.nav }, { label: "设置选项", items: settings },
  ];
  return [{ items: domain.nav }];
}

function Section({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-0.5">
      {label && <p className="side-label">{label}</p>}
      {children}
    </section>
  );
}

// 时间域今天页：来源筛选作用于时间轴；日期面板由页面投放到底部插槽
function TimeSources() {
  const source = useTimeViewStore((s) => s.source);
  const setSource = useTimeViewStore((s) => s.setSource);
  return (
    <Section label="来源">
      {SOURCES.map((item) => (
        <button key={item.value} type="button" className="workspace-link" aria-pressed={source === item.value} onClick={() => setSource(item.value)}>
          <item.icon size={16} aria-hidden />
          {item.label}
        </button>
      ))}
    </Section>
  );
}

function NavRows({ items, mobile = false }: { items: NavItem[]; mobile?: boolean }) {
  const { pathname } = useLocation();
  return items.map((item) => (
    <Link key={`${item.to}:${item.label}`} to={item.to} className={`workspace-link${mobile ? " shrink-0 whitespace-nowrap" : ""}`} aria-current={pathname === item.to || (item.matchPrefix && pathname.startsWith(item.matchPrefix)) ? "page" : undefined}>
      <item.icon size={16} aria-hidden />
      {item.label}
    </Link>
  ));
}

// 骨架恒定：56px 标题 → 导航（可滚动）→ 底部日期插槽。各领域导航从同一行起，日历贴底同一位置
export function DomainSidebar({ domain }: { domain: Domain }) {
  const {owner}=useAccess();
  const { pathname } = useLocation();
  const groups = useMemo(() => owner?groupsFor(domain, pathname):[{items:domain.nav}], [domain, pathname,owner]);
  return (
    <aside aria-label={`${domain.label}导航`} className="workspace-sidebar hidden flex-col md:flex">
      <h2 className="workspace-side-heading">{domain.label}</h2>
      <div className="grid min-h-0 flex-1 content-start gap-6 overflow-y-auto pb-6">
        {groups.map((group, index) => (
          <Section key={group.label ?? index} label={group.label}>
            <NavRows items={group.items} />
          </Section>
        ))}
        {pathname === "/time/day" && <TimeSources />}
      </div>
      <div id={SIDEBAR_RANGE_SLOT_ID} className="workspace-range-slot" />
      <SidebarRangeFallback />
    </aside>
  );
}

function TimeSourceSelect() {
  const source = useTimeViewStore((s) => s.source);
  const setSource = useTimeViewStore((s) => s.setSource);
  return (
    <Select
      aria-label="时间来源"
      size="sm"
      value={source}
      options={SOURCES}
      onChange={(event) => setSource(event.target.value as TimeSourceFilter)}
    />
  );
}

// 窄屏导航独占高度，长页面不能把它压没；时间来源与桌面共用状态和选项
export function DomainTabs({ domain }: { domain: Domain }) {
  const {owner}=useAccess();
  const { pathname } = useLocation();
  const groups = owner?groupsFor(domain, pathname):[{items:domain.nav}];
  if (!groups[0]?.items.length) return null;
  return (
    <div className="-mx-4 mb-4 flex flex-none flex-col gap-2 px-4 md:hidden">
      {groups.map((group, index) => <nav key={group.label ?? index} aria-label={`${domain.label}${group.label ?? "导航"}`} className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none]">
        <NavRows items={group.items} mobile />
      </nav>)}
      {pathname === "/time/day" && <div className="ml-auto w-28"><TimeSourceSelect /></div>}
    </div>
  );
}
