/**
 * [INPUT]: 依赖 useAccess() 访问态、本人 /api/inspirations* 或公开 /api/visitor/inspirations 接口、路由查询参数与 InspirationFilters/InspirationCard。
 * [OUTPUT]: 对外提供双模式「灵感记录」主页面：状态编排、JSON 数据岛与增删改弹层。
 * [POS]: 灵感领域主页面；本人可读写，访客与外部 Agent 可只读抓取（服从 share_inspirations 开关），原文逐字保留不压缩。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Lightbulb, Plus, Tags, X } from "lucide-react";
import { useAccess } from "./access";
import { PageHeader } from "./dashboard/components/ui/PageHeader";
import { Button } from "./dashboard/components/ui/Button";
import { AlertDialog } from "./dashboard/components/ui/AlertDialog";
import { useRefreshSignal } from "./dashboard/components/Layout";
import { today, validDay } from "./model";
import type { Api } from "./Auth";
import {
  shanghaiDayFromIso,
  type InspirationRow,
  type InspirationsPageData,
  type PublicInspirationsFeed,
} from "./inspiration-model";
import { InspirationCard } from "./InspirationCard";
import {
  InspirationFilterPanel,
  InspirationScrapeBar,
} from "./InspirationFilters";
import { InspirationEditorModal } from "./InspirationEditorModal";

const PAGE_SIZE = 30;

function normalizeDateParam(raw: string | null): string {
  const value = (raw ?? "").trim();
  if (!value) return "";
  if (value.toLowerCase() === "today") return today();
  return validDay(value) ? value : "";
}

function adaptPublicFeed(
  feed: PublicInspirationsFeed,
  page: number,
): InspirationsPageData {
  return {
    rows: feed.items.map((item) => ({
      id: item.id,
      raw_input_id: null,
      source: "wechat",
      title: item.title,
      summary: item.summary,
      content: item.content,
      pinned: item.pinned,
      captured_at: item.captured_at,
      date_shanghai: item.date_shanghai,
      revision: 0,
      created_at: item.captured_at,
      updated_at: item.captured_at,
      raw_text: null,
      tags: item.tags,
    })),
    total: feed.total,
    page,
    pageSize: feed.limit || PAGE_SIZE,
    tagTree: feed.tags_tree ?? [],
    availableDates: feed.available_dates ?? [],
    publicMode: true,
  };
}

export function InspirationsPage({ api }: { api: Api }) {
  const { owner } = useAccess();
  const [searchParams, setSearchParams] = useSearchParams();
  const refresh = useRefreshSignal();

  const [data, setData] = useState<InspirationsPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [publicDisabled, setPublicDisabled] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [revision, setRevision] = useState(0);

  const [queryInput, setQueryInput] = useState(searchParams.get("q") ?? "");
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [dateFilter, setDateFilter] = useState(
    normalizeDateParam(searchParams.get("date")),
  );
  const [groupId, setGroupId] = useState(searchParams.get("group_id") ?? "");
  const [tagId, setTagId] = useState(searchParams.get("tag_id") ?? "");
  const [groupName, setGroupName] = useState(searchParams.get("group") ?? "");
  const [tagPair, setTagPair] = useState(searchParams.get("tag") ?? "");
  const [source, setSource] = useState<"" | "wechat" | "web">("");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [page, setPage] = useState(0);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<InspirationRow | null>(null);
  const [deleting, setDeleting] = useState<InspirationRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // 支持从「标签管理」页或外部链接带参跳回
  useEffect(() => {
    const paramGroup = searchParams.get("group_id") ?? "";
    const paramTag = searchParams.get("tag_id") ?? "";
    const paramGroupName = searchParams.get("group") ?? "";
    const paramTagPair = searchParams.get("tag") ?? "";
    const paramDate = normalizeDateParam(searchParams.get("date"));
    if (paramGroup !== groupId) setGroupId(paramGroup);
    if (paramTag !== tagId) setTagId(paramTag);
    if (paramGroupName !== groupName) setGroupName(paramGroupName);
    if (paramTagPair !== tagPair) setTagPair(paramTagPair);
    if (paramDate !== dateFilter) setDateFilter(paramDate);
  }, [searchParams]);

  const syncUrlParams = useCallback(
    (next: {
      q?: string;
      date?: string;
      groupId?: string;
      tagId?: string;
      groupName?: string;
      tagPair?: string;
    }) => {
      const sp = new URLSearchParams();
      const nextQ = next.q ?? q;
      const nextDate = next.date ?? dateFilter;
      if (nextQ) sp.set("q", nextQ);
      if (nextDate) sp.set("date", nextDate);
      if (owner) {
        const g = next.groupId ?? groupId;
        const t = next.tagId ?? tagId;
        if (g) sp.set("group_id", g);
        if (t) sp.set("tag_id", t);
      } else {
        const gn = next.groupName ?? groupName;
        const tp = next.tagPair ?? tagPair;
        if (gn) sp.set("group", gn);
        if (tp) sp.set("tag", tp);
      }
      setSearchParams(sp, { replace: true });
    },
    [q, dateFilter, owner, groupId, tagId, groupName, tagPair, setSearchParams],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setPublicDisabled(false);

    if (owner) {
      const params = new URLSearchParams({ page: String(page) });
      if (q) params.set("q", q);
      if (dateFilter) params.set("date", dateFilter);
      if (groupId) params.set("group_id", groupId);
      if (tagId) params.set("tag_id", tagId);
      if (source) params.set("source", source);
      if (pinnedOnly) params.set("pinned", "1");
      void api<InspirationsPageData>(
        `/api/inspirations?${params.toString()}`,
        undefined,
        controller.signal,
      )
        .then((result) => {
          setData(result);
          setLoading(false);
        })
        .catch((caught) => {
          if (!controller.signal.aborted) {
            setError(caught instanceof Error ? caught.message : "读取灵感失败");
            setLoading(false);
          }
        });
    } else {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (q) params.set("q", q);
      if (dateFilter) params.set("date", dateFilter);
      if (tagPair) params.set("tag", tagPair);
      else if (groupName) params.set("group", groupName);
      void api<PublicInspirationsFeed>(
        `/api/visitor/inspirations?${params.toString()}`,
        undefined,
        controller.signal,
      )
        .then((feed) => {
          setData(adaptPublicFeed(feed, page));
          setLoading(false);
        })
        .catch((caught) => {
          if (!controller.signal.aborted) {
            const msg = caught instanceof Error ? caught.message : "读取灵感失败";
            if (msg.includes("尚未开启")) setPublicDisabled(true);
            else setError(msg);
            setLoading(false);
          }
        });
    }

    return () => controller.abort();
  }, [
    owner, api, page, q, dateFilter, groupId, tagId,
    groupName, tagPair, source, pinnedOnly, revision, refresh,
  ]);

  const activeGroup = useMemo(() => {
    if (!data) return null;
    if (owner) {
      if (groupId) return data.tagTree.find((g) => g.id === groupId) ?? null;
      if (tagId) return data.tagTree.find((g) => g.children.some((c) => c.id === tagId)) ?? null;
      return null;
    }
    if (groupName) return data.tagTree.find((g) => g.name === groupName) ?? null;
    if (tagPair) {
      const [gName] = tagPair.split("/");
      return data.tagTree.find((g) => g.name === gName) ?? null;
    }
    return null;
  }, [data, owner, groupId, tagId, groupName, tagPair]);

  const selectGroup = (id: string, name: string) => {
    setPage(0);
    setGroupId(id);
    setTagId("");
    setGroupName(name);
    setTagPair("");
    syncUrlParams({ groupId: id, tagId: "", groupName: name, tagPair: "" });
  };

  const selectTag = (
    parentId: string,
    parentName: string,
    childId: string,
    childName: string,
  ) => {
    const pair = `${parentName}/${childName}`;
    setPage(0);
    setGroupId(parentId);
    setTagId(childId);
    setGroupName(parentName);
    setTagPair(pair);
    syncUrlParams({ groupId: parentId, tagId: childId, groupName: parentName, tagPair: pair });
  };

  const selectDate = (nextDate: string) => {
    setPage(0);
    setDateFilter(nextDate);
    syncUrlParams({ date: nextDate });
  };

  const clearFilters = () => {
    setPage(0);
    setQueryInput("");
    setQ("");
    setDateFilter("");
    setGroupId("");
    setTagId("");
    setGroupName("");
    setTagPair("");
    setSource("");
    setPinnedOnly(false);
    setSearchParams({}, { replace: true });
  };

  const togglePin = async (row: InspirationRow) => {
    if (!owner) return;
    try {
      await api("/api/inspirations/edit", {
        id: row.id,
        revision: row.revision,
        patch: { pinned: !row.pinned },
      });
      setStatusMsg(row.pinned ? "已取消置顶" : "已置顶");
      setRevision((v) => v + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新置顶状态失败");
    }
  };

  const confirmDelete = async () => {
    if (!owner || !deleting) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await api("/api/inspirations/delete", {
        id: deleting.id,
        revision: deleting.revision,
      });
      setDeleting(null);
      setStatusMsg("已删除灵感记录");
      setRevision((v) => v + 1);
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : "删除失败，请重试");
    } finally {
      setDeleteBusy(false);
    }
  };

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1800);
    } catch {
      setError("无法访问剪贴板，请手动选中复制。");
    }
  };

  const todayDay = today();
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const hasActiveFilter = Boolean(
    q || dateFilter || groupId || tagId || groupName || tagPair || source || pinnedOnly,
  );

  // 构造零私密字段的 JSON 数据岛（供页面抓取器与 Agent 直接提取）
  const safeFeedJson = useMemo(() => {
    const payload = {
      timezone: "Asia/Shanghai",
      date: dateFilter || null,
      total: data?.total ?? 0,
      items: (data?.rows ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        summary: row.summary,
        content: row.content,
        pinned: row.pinned,
        captured_at: row.captured_at,
        date_shanghai: row.date_shanghai || shanghaiDayFromIso(row.captured_at),
        tags: row.tags.map((t) => ({ group: t.group, name: t.name })),
      })),
    };
    return JSON.stringify(payload).replace(/<\/script/gi, "<\\/script");
  }, [data, dateFilter]);

  return (
    <section
      className="grid gap-5 pb-10"
      data-lifeos-feed="inspirations"
      data-timezone="Asia/Shanghai"
      data-date={dateFilter || "all"}
      data-total={data?.total ?? 0}
    >
      <PageHeader
        label="Notes · Inspirations"
        title="灵感记录"
        note={
          owner
            ? "原文完整保留 · 自动生成短标题、总结与两层标签 · 支持公开抓取"
            : "公开灵感集 · 原文完整保留 · 开放给其他页面与 Agent 每日抓取总结"
        }
        actions={
          owner ? (
            <>
              <Link to="/inspirations/tags" className="zzm-btn zzm-btn--sm">
                <Tags size={14} strokeWidth={1.5} />
                标签管理
              </Link>
              <Button
                variant="primary"
                size="sm"
                leading={<Plus size={14} strokeWidth={1.75} />}
                onClick={() => {
                  setEditing(null);
                  setEditorOpen(true);
                }}
              >
                新建灵感
              </Button>
            </>
          ) : undefined
        }
      />

      {!publicDisabled && (
        <InspirationScrapeBar
          dateFilter={dateFilter}
          copiedKey={copiedKey}
          onCopy={(key, text) => void copyText(key, text)}
        />
      )}

      {statusMsg && (
        <div
          role="status"
          className="flex items-center justify-between rounded-lg border border-border bg-zzm-fill px-3.5 py-2 text-[13px] text-zzm-ok"
        >
          <span>{statusMsg}</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setStatusMsg("")}
            aria-label="关闭提示"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {publicDisabled ? (
        <div className="zzm-card grid place-items-center gap-2 py-14 text-center">
          <Lightbulb size={24} strokeWidth={1.5} className="text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">灵感记录暂未对外公开</p>
          <p className="max-w-md text-[13px] leading-5 text-muted-foreground">
            站点主人目前关闭了公开灵感展示与抓取接口；开启后即可直接浏览或供 Agent 按日抓取。
          </p>
        </div>
      ) : (
        <>
          <InspirationFilterPanel
            owner={owner}
            todayDay={todayDay}
            dateFilter={dateFilter}
            availableDates={data?.availableDates ?? []}
            tagTree={data?.tagTree ?? []}
            activeGroup={activeGroup}
            tagId={tagId}
            tagPair={tagPair}
            queryInput={queryInput}
            source={source}
            pinnedOnly={pinnedOnly}
            hasActiveFilter={hasActiveFilter}
            onSelectDate={selectDate}
            onSelectGroup={selectGroup}
            onSelectTag={selectTag}
            onQueryInputChange={setQueryInput}
            onSubmitSearch={() => {
              const nextQ = queryInput.trim();
              setPage(0);
              setQ(nextQ);
              syncUrlParams({ q: nextQ });
            }}
            onSelectSource={(val) => {
              setPage(0);
              setSource(val);
            }}
            onTogglePinnedOnly={() => {
              setPage(0);
              setPinnedOnly((v) => !v);
            }}
            onClearFilters={clearFilters}
          />

          {error && (
            <p role="alert" className="text-[13px] text-zzm-accent-ink">
              {error}
            </p>
          )}

          {loading && !data ? (
            <div className="grid gap-3">
              <div className="zzm-skel h-36 rounded-xl" />
              <div className="zzm-skel h-36 rounded-xl" />
            </div>
          ) : !data?.rows.length ? (
            <div className="zzm-card grid place-items-center gap-2 py-14 text-center">
              <Lightbulb size={24} strokeWidth={1.5} className="text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                {hasActiveFilter ? "当前筛选条件下没有灵感记录" : "还没有灵感记录"}
              </p>
              <p className="max-w-md text-[13px] leading-5 text-muted-foreground">
                {hasActiveFilter
                  ? "可以清空关键词、切换日期或其他概念大类试试。"
                  : owner
                    ? "直接给微信 Agent 发送成段文字、想法，或明确说「帮我记一下…」，都会自动保留原文并归档到这里。"
                    : "当前还没有公开发布的灵感记录。"}
              </p>
            </div>
          ) : (
            <div id="inspirations-list" className="grid gap-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  共 <strong className="font-mono text-foreground">{data.total}</strong> 条灵感记录
                </span>
                {totalPages > 1 && (
                  <span className="font-mono">
                    第 {page + 1} / {totalPages} 页
                  </span>
                )}
              </div>

              {data.rows.map((row) => (
                <InspirationCard
                  key={row.id}
                  row={row}
                  owner={owner}
                  copied={copiedKey === row.id}
                  onTogglePin={(target) => void togglePin(target)}
                  onCopy={(target) => void copyText(target.id, target.content)}
                  onEdit={(target) => {
                    setEditing(target);
                    setEditorOpen(true);
                  }}
                  onDelete={(target) => {
                    setDeleteError("");
                    setDeleting(target);
                  }}
                  onSelectTag={selectTag}
                />
              ))}

              {totalPages > 1 && (
                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    上一页
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page + 1 >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    下一页
                  </Button>
                </div>
              )}
            </div>
          )}

          <script
            type="application/json"
            id="lifeos-inspirations-data"
            dangerouslySetInnerHTML={{ __html: safeFeedJson }}
          />
        </>
      )}

      {owner && (
        <>
          <InspirationEditorModal
            open={editorOpen}
            target={editing}
            tagTree={data?.tagTree ?? []}
            api={api}
            onClose={() => setEditorOpen(false)}
            onSaved={(message) => {
              setEditorOpen(false);
              setEditing(null);
              setStatusMsg(message);
              setRevision((v) => v + 1);
            }}
          />

          <AlertDialog
            open={Boolean(deleting)}
            title="删除这条灵感记录？"
            description="将从灵感记录中软删除；如果来自微信，原始微信消息和修改历史仍会保留。"
            tone="destructive"
            confirmLabel="确认删除"
            busy={deleteBusy}
            error={deleteError}
            onCancel={() => setDeleting(null)}
            onConfirm={() => void confirmDelete()}
          />
        </>
      )}
    </section>
  );
}
