/**
 * [INPUT]: 匿名 Supabase 客户端、查询参数（date/from/to/group/tag/q/format）与公开灵感投影 RPC。
 * [OUTPUT]: 对外提供公开可抓取的 JSON、Markdown 与零 JS 语义 HTML5 灵感订阅源。
 * [POS]: 公开灵感与 Agent 每日抓取边界；严格服从 visitor_settings.share_inspirations 开关，仅暴露公开字段，绝不继承本人 Cookie。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./auth";
import { today, validDay, daysBetween } from "../src/model";
import type { PublicInspirationsFeed } from "../src/inspiration-model";

const FEED_SECURITY: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "index, follow",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=60",
};

function resolveDayParam(raw: string | null): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (value.toLowerCase() === "today") return today();
  if (!validDay(value)) throw new HttpError(400, "日期格式须为 YYYY-MM-DD 或 today");
  return value;
}

export async function queryVisitorInspirations(
  client: SupabaseClient,
  url: URL,
): Promise<PublicInspirationsFeed> {
  const date = resolveDayParam(url.searchParams.get("date"));
  const from = resolveDayParam(url.searchParams.get("from"));
  const to = resolveDayParam(url.searchParams.get("to"));
  if (from && to && (to < from || daysBetween(from, to) > 367)) {
    throw new HttpError(400, "日期范围无效或超过一年");
  }
  const group = z
    .string()
    .max(40)
    .parse(url.searchParams.get("group") ?? "")
    .trim();
  const tag = z
    .string()
    .max(90)
    .parse(url.searchParams.get("tag") ?? "")
    .trim();
  const q = z
    .string()
    .max(120)
    .parse(url.searchParams.get("q") ?? "")
    .trim();
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .parse(url.searchParams.get("limit") ?? 100);
  const offset = z.coerce
    .number()
    .int()
    .min(0)
    .max(10000)
    .parse(url.searchParams.get("offset") ?? 0);

  const { data, error } = await client.rpc("visitor_inspirations", {
    p_date: date,
    p_from: from,
    p_to: to,
    p_group: group || null,
    p_tag: tag || null,
    p_q: q || null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) {
    throw new HttpError(
      error.code === "42501" ? 403 : 503,
      error.code === "42501" ? "灵感公开访问尚未开启。" : "灵感数据暂时不可用。",
    );
  }
  return data as PublicInspirationsFeed;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatShanghaiTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(ms))
    .replace(/\//g, "-");
}

// ============================================================
// Markdown 渲染（供 Agent 每日抓取与大模型直接总结）
// ============================================================
export function renderInspirationsMarkdown(
  feed: PublicInspirationsFeed,
  origin: string,
): string {
  const scopeLabel = feed.date
    ? feed.date
    : feed.from && feed.to
      ? `${feed.from} 至 ${feed.to}`
      : "全部日期";
  const lines: string[] = [
    "---",
    `title: LifeOS 公开灵感集`,
    `scope: "${scopeLabel}"`,
    `timezone: "${feed.timezone}"`,
    `total: ${feed.total}`,
    `source_url: "${origin}/inspirations/feed"`,
    `json_url: "${origin}/inspirations.json"`,
    "---",
    "",
    `# LifeOS 公开灵感集（${scopeLabel}）`,
    "",
    `共 ${feed.total} 条记录（时区：Asia/Shanghai）。`,
    "",
  ];

  if (feed.items.length === 0) {
    lines.push("当前筛选范围内暂无灵感记录。", "");
    return lines.join("\n");
  }

  for (const item of feed.items) {
    const heading = item.title || "未命名灵感";
    const tagList = item.tags.map((t) => `${t.group}/${t.name}`).join("、");
    lines.push(`## ${heading}`);
    lines.push("");
    lines.push(
      `- 时间：${formatShanghaiTime(item.captured_at)}（${item.date_shanghai}）`,
    );
    if (tagList) lines.push(`- 标签：${tagList}`);
    if (item.pinned) lines.push(`- 置顶：是`);
    lines.push(`- ID：${item.id}`);
    lines.push("");
    if (item.summary) {
      lines.push(`> 总结：${item.summary}`);
      lines.push("");
    }
    lines.push(item.content);
    lines.push("", "---", "");
  }
  return lines.join("\n");
}

// ============================================================
// 零 JS 语义 HTML5 渲染（供网页爬虫、其他页面与 Agent 直接解析）
// ============================================================
export function renderInspirationsHtml(
  feed: PublicInspirationsFeed,
  url: URL,
): string {
  const origin = url.origin;
  const search = url.search;
  const scopeLabel = feed.date
    ? feed.date
    : feed.from && feed.to
      ? `${feed.from} 至 ${feed.to}`
      : "全部日期";
  const safeJson = JSON.stringify(feed).replace(/<\/script/gi, "<\\/script");

  const articles =
    feed.items.length === 0
      ? `<p class="empty">当前筛选范围内暂无灵感记录。</p>`
      : feed.items
          .map((item) => {
            const title = escapeHtml(item.title || "未命名灵感");
            const summaryHtml = item.summary
              ? `<p class="summary" data-field="summary" itemprop="abstract">${escapeHtml(item.summary)}</p>`
              : "";
            const tagsHtml = item.tags.length
              ? `<ul class="tags" data-field="tags">${item.tags
                  .map(
                    (t) =>
                      `<li data-group="${escapeHtml(t.group)}" data-name="${escapeHtml(t.name)}" itemprop="keywords">${escapeHtml(t.group)} / ${escapeHtml(t.name)}</li>`,
                  )
                  .join("")}</ul>`
              : "";
            return `<article class="inspiration-item" data-inspiration-id="${escapeHtml(item.id)}" data-date="${escapeHtml(item.date_shanghai)}" data-captured-at="${escapeHtml(item.captured_at)}" data-pinned="${item.pinned ? "true" : "false"}" itemscope itemtype="https://schema.org/CreativeWork">
  <header class="item-head">
    <h2 data-field="title" itemprop="headline">${title}</h2>
    <time data-field="captured-at" datetime="${escapeHtml(item.captured_at)}" itemprop="dateCreated">${escapeHtml(formatShanghaiTime(item.captured_at))}</time>
  </header>
  ${summaryHtml}
  <div class="content" data-field="content" itemprop="text">${escapeHtml(item.content)}</div>
  ${tagsHtml}
</article>`;
          })
          .join("\n");

  const dateLinks = feed.available_dates
    .slice(0, 14)
    .map(
      (d) =>
        `<a href="${origin}/inspirations/feed?date=${encodeURIComponent(d)}"${feed.date === d ? ' aria-current="page"' : ""}>${escapeHtml(d)}</a>`,
    )
    .join(" ");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="index, follow" />
  <title>灵感记录（${escapeHtml(scopeLabel)}） · LifeOS</title>
  <link rel="alternate" type="application/json" title="JSON Feed" href="${escapeHtml(origin + "/inspirations.json" + search)}" />
  <link rel="alternate" type="text/markdown" title="Markdown Feed" href="${escapeHtml(origin + "/inspirations.md" + search)}" />
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", sans-serif; background: #FAF9F6; color: #1C1B18; line-height: 1.7; }
    main { max-width: 780px; margin: 0 auto; padding: 32px 20px 64px; }
    header.page-head { border-bottom: 1px solid rgba(28,27,24,.12); padding-bottom: 18px; margin-bottom: 24px; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    .meta { font-size: 13px; color: #6B6860; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
    .nav { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; font-size: 13px; }
    .nav a { color: #A6402F; text-decoration: none; border: 1px solid rgba(166,64,47,.25); padding: 2px 10px; border-radius: 999px; }
    .nav a[aria-current="page"] { background: #A6402F; color: #fff; }
    article.inspiration-item { background: #FFFFFF; border: 1px solid rgba(28,27,24,.10); border-radius: 12px; padding: 18px 20px; margin-bottom: 16px; }
    .item-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
    .item-head h2 { margin: 0; font-size: 17px; }
    .item-head time { font-size: 12px; color: #6B6860; font-variant-numeric: tabular-nums; }
    .summary { margin: 10px 0 12px; padding: 8px 12px; background: #F4F2EC; border-left: 3px solid #A6402F; font-size: 13.5px; color: #4A4842; border-radius: 0 6px 6px 0; }
    .content { white-space: pre-wrap; word-break: break-word; font-size: 15px; margin: 10px 0; }
    .tags { list-style: none; padding: 0; margin: 12px 0 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .tags li { font-size: 12px; background: #F4F2EC; color: #4A4842; padding: 2px 9px; border-radius: 6px; border: 1px solid rgba(28,27,24,.08); }
    .empty { color: #6B6860; padding: 32px 0; text-align: center; }
    @media (prefers-color-scheme: dark) {
      body { background: #161615; color: #E6E5DF; }
      article.inspiration-item { background: #1E1E1C; border-color: rgba(255,255,255,.10); }
      .summary, .tags li { background: #262624; color: #C8C7C1; }
      .meta, .item-head time { color: #9C9B95; }
    }
  </style>
</head>
<body>
  <main data-lifeos-feed="inspirations" data-scope="${escapeHtml(scopeLabel)}" data-timezone="Asia/Shanghai" data-total="${feed.total}">
    <header class="page-head">
      <h1>LifeOS 公开灵感集</h1>
      <div class="meta">
        <span>范围：${escapeHtml(scopeLabel)}</span>
        <span>共 ${feed.total} 条</span>
        <span>时区：Asia/Shanghai</span>
      </div>
      <nav class="nav" aria-label="抓取入口">
        <a href="${escapeHtml(origin)}/inspirations/feed?date=today"${feed.date === today() ? ' aria-current="page"' : ""}>今日灵感</a>
        <a href="${escapeHtml(origin)}/inspirations/feed"${!feed.date && !feed.from ? ' aria-current="page"' : ""}>全部灵感</a>
        <a href="${escapeHtml(origin + "/inspirations.md" + search)}">Markdown 版</a>
        <a href="${escapeHtml(origin + "/inspirations.json" + search)}">JSON 数据</a>
        <a href="${escapeHtml(origin)}/dashboard/inspirations">交互面板</a>
      </nav>
      ${dateLinks ? `<nav class="nav" aria-label="按日归档">${dateLinks}</nav>` : ""}
    </header>
    <section id="inspirations-list" aria-label="灵感列表">
      ${articles}
    </section>
  </main>
  <script type="application/json" id="lifeos-inspirations-data">${safeJson}</script>
</body>
</html>`;
}

export async function visitorInspirationsResponse(
  client: SupabaseClient,
  url: URL,
  request: Request,
  forcedFormat?: "html" | "md" | "json",
): Promise<Response> {
  const feed = await queryVisitorInspirations(client, url);
  const queryFormat = (url.searchParams.get("format") ?? "").toLowerCase();
  const accept = (request.headers.get("Accept") ?? "").toLowerCase();
  const format: "html" | "md" | "json" =
    forcedFormat ??
    (queryFormat === "json" || queryFormat === "md" || queryFormat === "markdown"
      ? queryFormat === "json"
        ? "json"
        : "md"
      : queryFormat === "html"
        ? "html"
        : accept.includes("text/markdown")
          ? "md"
          : accept.includes("application/json") && !accept.includes("text/html")
            ? "json"
            : "html");

  if (format === "json") {
    return new Response(JSON.stringify(feed), {
      status: 200,
      headers: {
        ...FEED_SECURITY,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  }
  if (format === "md") {
    return new Response(renderInspirationsMarkdown(feed, url.origin), {
      status: 200,
      headers: {
        ...FEED_SECURITY,
        "Content-Type": "text/markdown; charset=utf-8",
      },
    });
  }
  return new Response(renderInspirationsHtml(feed, url), {
    status: 200,
    headers: {
      ...FEED_SECURITY,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}

export function feedOptionsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Accept, Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
