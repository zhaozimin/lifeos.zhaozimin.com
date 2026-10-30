/**
 * [INPUT]: 依赖 Router 路径、领域清单、时间/财务设置页、记录偏好、记录时区 context、ThemeSwitcher 与 AboutPanel。
 * [OUTPUT]: 提供按领域归属的设置注册表、settingsNavFor 与旧设置深链跳转。
 * [POS]: 设置页面装配边界；领域设置留在本领域，LifeOS 设置只承载全局偏好。
 *   时间 section 与财务 panel 继续复用既有契约，不复制业务表单。
 *   设计系统真源在 ui.zhaozimin.com，本地不再维护展示页。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { lazy, Suspense } from "react";
import { Navigate, useLocation, useParams } from "react-router";
import { CalendarDays, ChartNoAxesCombined, CreditCard, Database, ExternalLink, FileInput, FolderKanban, Globe2, ListFilter, Monitor, ShieldCheck, Tags, Terminal, UserRound, Users, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { RECORD_KINDS, type RecordKind } from "../../record-model";
import { useRecordTimeZoneChange } from "../components/RecordTimeZoneProvider";
import { domainForPath, type DomainId, type NavItem } from "../components/shell/domains";
import { ThemeSwitcher } from "../components/ThemeSwitcher";
import { PageHeader } from "../components/ui/PageHeader";
import { Select } from "../components/ui/Select";
import { useRecordsPreferences } from "../store/records";
import type { TimeSettingsSection } from "../pages/SettingsPage";

const TimeSettings = lazy(async () => ({ default: (await import("../pages/SettingsPage")).SettingsPage }));
const AboutPanel = lazy(async () => ({ default: (await import("./AboutPanel")).AboutPanel }));
const FinSettings = lazy(async () => ({ default: (await import("../fin/pages/SettingsPage")).SettingsPage }));

type Panel = { id: string; domain: DomainId; to: string; label: string; icon: LucideIcon; element: () => React.ReactNode };
type FinancePanelId = "accounts" | "projects" | "sources" | "categories" | "counterparties" | "import" | "tax" | "dashboard";
const financePanel = (panel: FinancePanelId) => () => <FinSettings panel={panel} />;

// Route element 里的 SettingsHub 拿不到 App 的 setter，时区迁移结果只能经 context 回流；
// 这层薄包装存在的唯一理由，是让 hook 落在真正的组件里而不是 PANELS 的工厂函数中。
function TimeSettingsPanel({ section }: { section: TimeSettingsSection }) {
  const onRecordTimeZoneChange = useRecordTimeZoneChange();
  return <TimeSettings section={section} onRecordTimeZoneChange={onRecordTimeZoneChange} />;
}

// 通用面板共用的卡片骨架：标题 + 说明 + 内容
function PlainPanel({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="zzm-card p-6">
      <h2 className="text-display-sm">{title}</h2>
      <p className="mt-1 text-body-sm text-muted-foreground">{description}</p>
      <div className="mt-6">{children}</div>
    </section>
  );
}

const timePanel = (section: TimeSettingsSection) => () => <TimeSettingsPanel section={section} />;

function RecordsPreferencesPanel() {
  const defaultKind = useRecordsPreferences((s) => s.defaultKind);
  const setDefaultKind = useRecordsPreferences((s) => s.setDefaultKind);
  return (
    <PlainPanel title="列表偏好" description="偏好保存在这台设备，打开历史记录时自动采用。">
      <div className="max-w-xs">
        <Select label="默认记录类型" value={defaultKind} options={Object.entries(RECORD_KINDS).map(([value, label]) => ({ value, label }))} onChange={(event) => setDefaultKind(event.target.value as RecordKind)} />
        <p className="mt-3 text-body-sm text-muted-foreground">选择后自动保存；历史记录中的原话和修改版本保持完整。</p>
      </div>
    </PlainPanel>
  );
}

const PANELS: Panel[] = [
  {
    id: "appearance", domain: "settings", to: "/settings/appearance", label: "外观", icon: Monitor,
    element: () => <PlainPanel title="外观" description="纸墨朱一套视觉，浅色与深色两种模式；全部板块同步切换。"><ThemeSwitcher /></PlainPanel>,
  },
  {
    id: "developer", domain: "settings", to: "/settings/developer", label: "开发者模式", icon: Terminal,
    element: () => (
      <PlainPanel title="开发者模式" description="界面令牌、组件与规范的唯一真源是赵子民设计系统。本面板锁定使用 v0.7.0。">
        <a className="zzm-btn" href="https://ui.zhaozimin.com/" target="_blank" rel="noreferrer">
          打开设计系统 <ExternalLink size={14} strokeWidth={1.5} />
        </a>
      </PlainPanel>
    ),
  },
  { id: "about", domain: "settings", to: "/settings/about", label: "关于作者", icon: UserRound, element: () => <AboutPanel /> },
  { id: "time-catalog", domain: "time", to: "/time/settings/catalog", label: "分类与项目", icon: Database, element: timePanel("catalog") },
  { id: "time-week-start", domain: "time", to: "/time/settings/week-start", label: "周起点", icon: CalendarDays, element: timePanel("week-start") },
  { id: "time-timezone", domain: "time", to: "/time/settings/timezone", label: "记录时区", icon: Globe2, element: timePanel("timezone") },
  { id: "finance-accounts", domain: "finance", to: "/fin/settings/accounts", label: "账户", icon: CreditCard, element: financePanel("accounts") },
  { id: "finance-projects", domain: "finance", to: "/fin/settings/projects", label: "项目", icon: FolderKanban, element: financePanel("projects") },
  { id: "finance-sources", domain: "finance", to: "/fin/settings/sources", label: "资金来源", icon: Wallet, element: financePanel("sources") },
  { id: "finance-categories", domain: "finance", to: "/fin/settings/categories", label: "类别", icon: Tags, element: financePanel("categories") },
  { id: "finance-counterparties", domain: "finance", to: "/fin/settings/counterparties", label: "客户与合作方", icon: Users, element: financePanel("counterparties") },
  { id: "finance-import", domain: "finance", to: "/fin/settings/import", label: "账单导入", icon: FileInput, element: financePanel("import") },
  { id: "finance-tax", domain: "finance", to: "/fin/settings/tax", label: "税务", icon: ShieldCheck, element: financePanel("tax") },
  { id: "finance-dashboard", domain: "finance", to: "/fin/settings/dashboard", label: "仪表盘定制", icon: ChartNoAxesCombined, element: financePanel("dashboard") },
  { id: "records-list", domain: "records", to: "/records/settings/list", label: "列表偏好", icon: ListFilter, element: RecordsPreferencesPanel },
];

// 导航与渲染共用注册表；安全页只进入 LifeOS 设置。
export function settingsNavFor(domain: DomainId): NavItem[] {
  return [
    ...PANELS.filter((panel) => panel.domain === domain).map(({ to, label, icon }) => ({ to, label, icon })),
    ...(domain === "settings" ? [{ to: "/security", label: "安全", icon: ShieldCheck }] : []),
  ];
}

export function SettingsHub() {
  const { panelId } = useParams();
  const { pathname } = useLocation();
  const domain = domainForPath(pathname);
  const active = PANELS.find((panel) => panel.to === pathname)
    || (pathname.startsWith("/settings/") ? PANELS.find((panel) => panel.id === panelId) : undefined)
    || PANELS.find((panel) => panel.domain === domain.id)
    || PANELS[0];
  if (pathname !== active.to) return <Navigate to={active.to} replace />;
  const ActivePanel = active.element;
  return (
    <div className="pb-6">
      <PageHeader className="mb-6" label={`${domain.id === "settings" ? "System" : domain.id} · Settings`} title={domain.id === "settings" ? "LifeOS 设置" : `${domain.label}设置`} note={active.label} />
      <div>
        <Suspense fallback={<div className="zzm-skel h-64 rounded-xl" />}>
          <ActivePanel key={active.id} />
        </Suspense>
      </div>
    </div>
  );
}
