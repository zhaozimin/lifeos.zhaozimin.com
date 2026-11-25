/**
 * [INPUT]: 合成灵感样本、两层标签树及公开渲染器 renderInspirationsHtml/renderInspirationsMarkdown。
 * [OUTPUT]: 对外提供 demoInspirations()，在 UI 演示模式中支持灵感 CRUD、标签管理与公开抓取接口。
 * [POS]: preview/ 灵感演示适配器；仅在 Vite ui 模式运行，数据全部为内存合成样本。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { randomUUID } from "node:crypto";
import { today } from "../src/model";
import {
  shanghaiDayFromIso,
  type InspirationRow,
  type InspirationsPageData,
  type InspirationTag,
  type InspirationTagGroup,
  type PublicInspirationsFeed,
} from "../src/inspiration-model";
import {
  renderInspirationsHtml,
  renderInspirationsMarkdown,
} from "../worker/visitor-inspirations";

type DemoTag = {
  id: string;
  level: 1 | 2;
  parent_id: string | null;
  name: string;
  description: string | null;
  archived: boolean;
};

type DemoRecord = {
  id: string;
  source: "wechat" | "web";
  title: string | null;
  summary: string | null;
  content: string;
  pinned: boolean;
  captured_at: string;
  revision: number;
  deleted: boolean;
  tagIds: string[];
};

export function demoInspirations() {
  const day = today();
  const gProduct = "10000000-0000-4000-8000-000000000001";
  const gAi = "10000000-0000-4000-8000-000000000002";
  const tOpenFeed = "20000000-0000-4000-8000-000000000001";
  const tMemory = "20000000-0000-4000-8000-000000000002";

  const tags: DemoTag[] = [
    { id: gProduct, level: 1, parent_id: null, name: "产品", description: "产品架构与体验思考", archived: false },
    { id: gAi, level: 1, parent_id: null, name: "AI", description: "模型、记忆与 Agent 工程", archived: false },
    { id: tOpenFeed, level: 2, parent_id: gProduct, name: "公开灵感集", description: "可被其他页面抓取的灵感流", archived: false },
    { id: tMemory, level: 2, parent_id: gAi, name: "长期记忆", description: "对话记录与每日复盘", archived: false },
  ];

  const rows: DemoRecord[] = [
    {
      id: "30000000-0000-4000-8000-000000000001",
      source: "wechat",
      title: "公开灵感页与 Agent 每日抓取",
      summary: "将日常灵感以零 JS 语义 HTML、Markdown 和 JSON 三种格式暴露，方便自动化 Agent 每日汇总。",
      content: "可以把灵感记录做成一个独立且允许抓取的页面，每天让 Agent 自动读取当日内容并做一次复盘汇总，原文则一字不差地留在原地。",
      pinned: true,
      captured_at: `${day}T10:20:00+08:00`,
      revision: 1,
      deleted: false,
      tagIds: [tOpenFeed],
    },
    {
      id: "30000000-0000-4000-8000-000000000002",
      source: "web",
      title: "两层标签边界的稳定性",
      summary: "只保留概念大类与具体分类两层，既便于 AI 归类又避免标签树无限膨胀。",
      content: "标签体系如果允许无限嵌套很快就会失控，固定成第一层概念大类、第二层具体分类，反而让搜索和 Agent 归类都更稳。",
      pinned: false,
      captured_at: `${day}T09:05:00+08:00`,
      revision: 1,
      deleted: false,
      tagIds: [tMemory],
    },
  ];

  const buildTagTree = (): InspirationTagGroup[] => {
    const activeRows = rows.filter((r) => !r.deleted);
    const activeTags = tags.filter((t) => !t.archived);
    return activeTags
      .filter((t) => t.level === 1)
      .map((g) => {
        const children = activeTags
          .filter((c) => c.level === 2 && c.parent_id === g.id)
          .map((c) => ({
            id: c.id,
            parent_id: g.id,
            name: c.name,
            description: c.description,
            count: activeRows.filter((r) => r.tagIds.includes(c.id)).length,
          }));
        const childSet = new Set(children.map((c) => c.id));
        const count = activeRows.filter((r) =>
          r.tagIds.some((id) => childSet.has(id)),
        ).length;
        return { id: g.id, name: g.name, description: g.description, count, children };
      });
  };

  const resolveTags = (tagIds: string[]): InspirationTag[] =>
    tagIds
      .map((id) => tags.find((t) => t.id === id && !t.archived && t.level === 2))
      .filter((t): t is DemoTag => Boolean(t))
      .map((t) => {
        const parent = tags.find((g) => g.id === t.parent_id && !g.archived);
        return parent
          ? { id: t.id, group_id: parent.id, group: parent.name, name: t.name }
          : null;
      })
      .filter((t): t is InspirationTag => Boolean(t));

  const ensurePair = (groupName: string, childName: string): string => {
    let g = tags.find((t) => t.level === 1 && t.name === groupName && !t.archived);
    if (!g) {
      g = { id: randomUUID(), level: 1, parent_id: null, name: groupName, description: null, archived: false };
      tags.push(g);
    }
    let c = tags.find((t) => t.level === 2 && t.parent_id === g.id && t.name === childName && !t.archived);
    if (!c) {
      c = { id: randomUUID(), level: 2, parent_id: g.id, name: childName, description: null, archived: false };
      tags.push(c);
    }
    return c.id;
  };

  const queryRows = (url: URL) => {
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const dateRaw = (url.searchParams.get("date") ?? "").trim();
    const date = dateRaw.toLowerCase() === "today" ? today() : dateRaw;
    const groupId = url.searchParams.get("group_id") ?? "";
    const tagId = url.searchParams.get("tag_id") ?? "";
    const groupName = (url.searchParams.get("group") ?? "").trim();
    const tagParam = (url.searchParams.get("tag") ?? "").trim();
    const source = url.searchParams.get("source") ?? "";
    const pinnedOnly = url.searchParams.get("pinned") === "1";

    const active = rows.filter((r) => !r.deleted);
    const availableDates = [
      ...new Set(active.map((r) => shanghaiDayFromIso(r.captured_at)).filter(Boolean)),
    ].sort((a, b) => b.localeCompare(a));

    const filtered = active
      .filter((r) => {
        const rTags = resolveTags(r.tagIds);
        if (pinnedOnly && !r.pinned) return false;
        if (source && r.source !== source) return false;
        if (date && shanghaiDayFromIso(r.captured_at) !== date) return false;
        if (tagId && !r.tagIds.includes(tagId)) return false;
        if (groupId && !rTags.some((t) => t.group_id === groupId)) return false;
        if (groupName && !rTags.some((t) => t.group === groupName)) return false;
        if (tagParam) {
          const hit = tagParam.includes("/")
            ? rTags.some((t) => `${t.group}/${t.name}` === tagParam)
            : rTags.some((t) => t.name === tagParam);
          if (!hit) return false;
        }
        if (q) {
          const hay = `${r.title ?? ""}\n${r.summary ?? ""}\n${r.content}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.captured_at.localeCompare(a.captured_at));

    return { filtered, availableDates, date: date || null };
  };

  const list = (url: URL): InspirationsPageData => {
    const { filtered, availableDates } = queryRows(url);
    const converted: InspirationRow[] = filtered.map((r) => ({
      id: r.id,
      raw_input_id: null,
      source: r.source,
      title: r.title,
      summary: r.summary,
      content: r.content,
      pinned: r.pinned,
      captured_at: r.captured_at,
      date_shanghai: shanghaiDayFromIso(r.captured_at),
      revision: r.revision,
      created_at: r.captured_at,
      updated_at: r.captured_at,
      raw_text: null,
      tags: resolveTags(r.tagIds),
    }));
    return {
      rows: converted,
      total: converted.length,
      page: 0,
      pageSize: 30,
      tagTree: buildTagTree(),
      availableDates,
    };
  };

  const publicFeed = (url: URL): PublicInspirationsFeed => {
    const { filtered, availableDates, date } = queryRows(url);
    return {
      items: filtered.map((r) => ({
        id: r.id,
        title: r.title,
        summary: r.summary,
        content: r.content,
        pinned: r.pinned,
        captured_at: r.captured_at,
        date_shanghai: shanghaiDayFromIso(r.captured_at),
        tags: resolveTags(r.tagIds),
      })),
      total: filtered.length,
      limit: 100,
      offset: 0,
      timezone: "Asia/Shanghai",
      date,
      from: null,
      to: null,
      tags_tree: buildTagTree(),
      available_dates: availableDates,
    };
  };

  const create = (input: Record<string, unknown>) => {
    const pairs = Array.isArray(input.tags)
      ? (input.tags as Array<{ group: string; name: string }>)
      : [];
    const rec: DemoRecord = {
      id: randomUUID(),
      source: "web",
      title: typeof input.title === "string" && input.title.trim() ? input.title.trim() : null,
      summary: typeof input.summary === "string" && input.summary.trim() ? input.summary.trim() : null,
      content: String(input.content ?? ""),
      pinned: Boolean(input.pinned),
      captured_at: new Date().toISOString(),
      revision: 1,
      deleted: false,
      tagIds: pairs.map((p) => ensurePair(p.group, p.name)),
    };
    rows.unshift(rec);
    return { id: rec.id, revision: rec.revision };
  };

  const edit = (input: Record<string, unknown>) => {
    const rec = rows.find((r) => r.id === input.id && !r.deleted);
    if (!rec) throw Object.assign(new Error("灵感不存在"), { status: 404 });
    const patch = (input.patch ?? {}) as Record<string, unknown>;
    if ("title" in patch) rec.title = typeof patch.title === "string" && patch.title.trim() ? patch.title.trim() : null;
    if ("summary" in patch) rec.summary = typeof patch.summary === "string" && patch.summary.trim() ? patch.summary.trim() : null;
    if ("content" in patch && typeof patch.content === "string") rec.content = patch.content;
    if ("pinned" in patch) rec.pinned = Boolean(patch.pinned);
    if (Array.isArray(patch.tags)) {
      rec.tagIds = (patch.tags as Array<{ group: string; name: string }>).map((p) => ensurePair(p.group, p.name));
    }
    rec.revision += 1;
    return { id: rec.id, revision: rec.revision };
  };

  const remove = (input: Record<string, unknown>) => {
    const rec = rows.find((r) => r.id === input.id && !r.deleted);
    if (!rec) throw Object.assign(new Error("灵感不存在"), { status: 404 });
    rec.deleted = true;
    return { id: rec.id, deleted: true };
  };

  const manageTag = (input: Record<string, unknown>) => {
    const action = String(input.action ?? "");
    const payload = (input.payload ?? {}) as Record<string, unknown>;
    if (action === "create_group") {
      const id = randomUUID();
      tags.push({ id, level: 1, parent_id: null, name: String(payload.name), description: (payload.description as string) ?? null, archived: false });
      return { id };
    }
    if (action === "create_tag") {
      const id = randomUUID();
      tags.push({ id, level: 2, parent_id: String(payload.parent_id), name: String(payload.name), description: (payload.description as string) ?? null, archived: false });
      return { id };
    }
    if (action === "rename") {
      const t = tags.find((x) => x.id === payload.id);
      if (t) {
        t.name = String(payload.name);
        if ("description" in payload) t.description = (payload.description as string) ?? null;
      }
      return { ok: true };
    }
    if (action === "move") {
      const t = tags.find((x) => x.id === payload.id && x.level === 2);
      if (t) t.parent_id = String(payload.parent_id);
      return { ok: true };
    }
    if (action === "archive") {
      const t = tags.find((x) => x.id === payload.id);
      if (t) t.archived = true;
      return { ok: true };
    }
    return { ok: true };
  };

  return {
    list,
    publicFeed,
    renderHtml: (url: URL) => renderInspirationsHtml(publicFeed(url), url),
    renderMarkdown: (url: URL) => renderInspirationsMarkdown(publicFeed(url), url.origin),
    create,
    edit,
    remove,
    manageTag,
  };
}
