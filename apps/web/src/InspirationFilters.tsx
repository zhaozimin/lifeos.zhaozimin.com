/**
 * [INPUT]: 当前日期、两层标签树、筛选状态及操作回调。
 * [OUTPUT]: 对外提供 InspirationScrapeBar（Agent 抓取入口条）与 InspirationFilterPanel（按日/两层标签/关键词/来源筛选面板）。
 * [POS]: InspirationsPage 的筛选与外部抓取工具条；仅负责呈现与回调，不直接访问 API。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {
  Calendar,
  Check,
  Copy,
  ExternalLink,
  Globe,
  Pin,
  Search,
} from "lucide-react";
import { Button } from "./dashboard/components/ui/Button";
import type { InspirationTagGroup } from "./inspiration-model";

export interface ScrapeBarProps {
  dateFilter: string;
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
}

export function InspirationScrapeBar({
  dateFilter,
  copiedKey,
  onCopy,
}: ScrapeBarProps) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const feedQuery = dateFilter
    ? `?date=${encodeURIComponent(dateFilter)}`
    : "?date=today";
  const endpoints = [
    { key: "md", label: "Markdown（Agent 推荐）", href: `/inspirations.md${feedQuery}` },
    { key: "html", label: "零 JS 语义 HTML", href: `/inspirations/feed${feedQuery}` },
    { key: "json", label: "JSON 数据源", href: `/inspirations.json${feedQuery}` },
  ];

  return (
    <div className="zzm-card flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs">
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
        <Globe size={14} strokeWidth={1.5} className="text-foreground" />
        <span className="font-medium text-foreground">Agent / 外部抓取入口</span>
        <span>
          {dateFilter
            ? `当前抓取 ${dateFilter}；去掉 ?date 参数抓全部`
            : "默认抓今日（?date=today）；支持 ?date=YYYY-MM-DD 或去掉参数抓全部"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {endpoints.map((ep) => {
          const fullUrl = origin ? `${origin}${ep.href}` : ep.href;
          return (
            <span
              key={ep.key}
              className="inline-flex items-center overflow-hidden rounded-md border border-border bg-background"
            >
              <a
                href={ep.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 text-foreground transition-colors hover:bg-zzm-fill"
              >
                {ep.label}
                <ExternalLink size={11} strokeWidth={1.5} />
              </a>
              <button
                type="button"
                onClick={() => onCopy(`ep:${ep.key}`, fullUrl)}
                className="border-l border-border px-2 py-1 text-muted-foreground transition-colors hover:bg-zzm-fill hover:text-foreground"
                title={`复制 ${fullUrl}`}
                aria-label={`复制 ${ep.label} 链接`}
              >
                {copiedKey === `ep:${ep.key}` ? (
                  <Check size={12} strokeWidth={1.75} />
                ) : (
                  <Copy size={12} strokeWidth={1.5} />
                )}
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export interface FilterPanelProps {
  owner: boolean;
  todayDay: string;
  dateFilter: string;
  availableDates: string[];
  tagTree: InspirationTagGroup[];
  activeGroup: InspirationTagGroup | null;
  tagId: string;
  tagPair: string;
  queryInput: string;
  source: "" | "wechat" | "web";
  pinnedOnly: boolean;
  hasActiveFilter: boolean;
  onSelectDate: (date: string) => void;
  onSelectGroup: (id: string, name: string) => void;
  onSelectTag: (
    parentId: string,
    parentName: string,
    childId: string,
    childName: string,
  ) => void;
  onQueryInputChange: (val: string) => void;
  onSubmitSearch: () => void;
  onSelectSource: (val: "" | "wechat" | "web") => void;
  onTogglePinnedOnly: () => void;
  onClearFilters: () => void;
}

export function InspirationFilterPanel({
  owner,
  todayDay,
  dateFilter,
  availableDates,
  tagTree,
  activeGroup,
  tagId,
  tagPair,
  queryInput,
  source,
  pinnedOnly,
  hasActiveFilter,
  onSelectDate,
  onSelectGroup,
  onSelectTag,
  onQueryInputChange,
  onSubmitSearch,
  onSelectSource,
  onTogglePinnedOnly,
  onClearFilters,
}: FilterPanelProps) {
  return (
    <div className="zzm-card grid gap-3 p-4">
      {/* 按日筛选（对齐 Agent 每日抓取） */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          <Calendar size={12} strokeWidth={1.5} />
          按日
        </span>
        <button
          type="button"
          className={`zzm-btn zzm-btn--sm ${!dateFilter ? "zzm-btn--accent" : ""}`}
          onClick={() => onSelectDate("")}
        >
          全部日期
        </button>
        <button
          type="button"
          className={`zzm-btn zzm-btn--sm ${dateFilter === todayDay ? "zzm-btn--accent" : ""}`}
          onClick={() => onSelectDate(todayDay)}
        >
          今天
        </button>
        {availableDates
          .filter((d) => d !== todayDay)
          .slice(0, 5)
          .map((d) => (
            <button
              key={d}
              type="button"
              className={`zzm-btn zzm-btn--sm font-mono ${dateFilter === d ? "zzm-btn--accent" : ""}`}
              onClick={() => onSelectDate(d)}
            >
              {d}
            </button>
          ))}
        <label className="field field--sm ml-auto w-auto">
          <input
            type="date"
            aria-label="选择日期"
            value={dateFilter}
            onChange={(e) => onSelectDate(e.target.value)}
          />
        </label>
      </div>

      {/* 一级大类 */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
        <span className="mr-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          一级大类
        </span>
        <button
          type="button"
          className={`zzm-btn zzm-btn--sm ${!activeGroup ? "zzm-btn--accent" : ""}`}
          onClick={() => onSelectGroup("", "")}
        >
          全部
        </button>
        {tagTree.map((group) => (
          <button
            key={group.id}
            type="button"
            className={`zzm-btn zzm-btn--sm ${activeGroup?.id === group.id ? "zzm-btn--accent" : ""}`}
            onClick={() => onSelectGroup(group.id, group.name)}
          >
            {group.name}
            <span className="ml-1 font-mono text-[11px] opacity-75">
              {group.count}
            </span>
          </button>
        ))}
      </div>

      {/* 二级分类 */}
      {activeGroup && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
          <span className="mr-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            二级分类
          </span>
          <button
            type="button"
            className={`zzm-btn zzm-btn--sm ${!(owner ? tagId : tagPair) ? "zzm-btn--accent" : ""}`}
            onClick={() => onSelectGroup(activeGroup.id, activeGroup.name)}
          >
            {activeGroup.name} · 全部
          </button>
          {activeGroup.children.map((child) => {
            const selected = owner
              ? tagId === child.id
              : tagPair === `${activeGroup.name}/${child.name}`;
            return (
              <button
                key={child.id}
                type="button"
                className={`zzm-btn zzm-btn--sm ${selected ? "zzm-btn--accent" : ""}`}
                onClick={() =>
                  onSelectTag(activeGroup.id, activeGroup.name, child.id, child.name)
                }
              >
                {child.name}
                <span className="ml-1 font-mono text-[11px] opacity-75">
                  {child.count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* 检索与来源筛选 */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <form
          className="flex min-w-[220px] flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmitSearch();
          }}
        >
          <label className="field field--sm flex-1">
            <Search size={14} className="shrink-0 text-zzm-muted" />
            <input
              type="search"
              value={queryInput}
              onChange={(e) => onQueryInputChange(e.target.value)}
              placeholder="搜索标题、总结或原话正文……"
            />
          </label>
          <Button type="submit" variant="secondary" size="sm">
            搜索
          </Button>
        </form>

        <div className="flex flex-wrap items-center gap-1.5">
          {owner && (
            <>
              {(
                [
                  ["", "全部来源"],
                  ["wechat", "微信 AI"],
                  ["web", "网页"],
                ] as const
              ).map(([val, label]) => (
                <button
                  key={label}
                  type="button"
                  className={`zzm-btn zzm-btn--sm ${source === val ? "zzm-btn--accent" : ""}`}
                  onClick={() => onSelectSource(val)}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                className={`zzm-btn zzm-btn--sm ${pinnedOnly ? "zzm-btn--accent" : ""}`}
                onClick={onTogglePinnedOnly}
              >
                <Pin size={13} strokeWidth={1.5} />
                仅置顶
              </button>
            </>
          )}
          {hasActiveFilter && (
            <Button variant="ghost" size="sm" onClick={onClearFilters}>
              重置筛选
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
