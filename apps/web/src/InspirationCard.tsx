/**
 * [INPUT]: 单条灵感记录、本人/访客权限态、复制态与操作回调。
 * [OUTPUT]: 对外提供语义 HTML5 + Schema.org 原文灵感卡片组件 InspirationCard。
 * [POS]: InspirationsPage 的卡片展示单元；逐字保留正文，独立展示短标题、总结与两层标签，并附带 data-* 抓取属性。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {
  Bot,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  PenLine,
  Pin,
  Trash2,
} from "lucide-react";
import { Button } from "./dashboard/components/ui/Button";
import { Badge } from "./dashboard/components/ui/Badge";
import { datetime } from "./model";
import { shanghaiDayFromIso, type InspirationRow } from "./inspiration-model";

export interface InspirationCardProps {
  row: InspirationRow;
  owner: boolean;
  copied: boolean;
  onTogglePin: (row: InspirationRow) => void;
  onCopy: (row: InspirationRow) => void;
  onEdit: (row: InspirationRow) => void;
  onDelete: (row: InspirationRow) => void;
  onSelectTag: (
    groupId: string,
    groupName: string,
    tagId: string,
    tagName: string,
  ) => void;
}

export function InspirationCard({
  row,
  owner,
  copied,
  onTogglePin,
  onCopy,
  onEdit,
  onDelete,
  onSelectTag,
}: InspirationCardProps) {
  const dayStr = row.date_shanghai || shanghaiDayFromIso(row.captured_at);

  return (
    <article
      className="zzm-card grid gap-3 p-5"
      data-inspiration-id={row.id}
      data-date={dayStr}
      data-captured-at={row.captured_at}
      data-pinned={row.pinned ? "true" : "false"}
      itemScope
      itemType="https://schema.org/CreativeWork"
    >
      {/* 卡片头部：短标题 + 元信息 + 操作 */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-2">
            {row.pinned && (
              <Badge tone="primary">
                <Pin size={11} className="mr-1" />
                置顶
              </Badge>
            )}
            <h2
              data-field="title"
              itemProp="headline"
              className="text-[16px] font-bold leading-6 text-[var(--zzm-ink-strong)]"
            >
              {row.title ?? "无标题灵感"}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <time
              data-field="captured-at"
              dateTime={row.captured_at}
              itemProp="dateCreated"
              className="inline-flex items-center gap-1 font-mono"
            >
              <Clock3 size={12} strokeWidth={1.5} />
              {datetime(row.captured_at)}
            </time>
            {owner && (
              <span className="inline-flex items-center gap-1">
                {row.source === "wechat" ? (
                  <>
                    <Bot size={12} strokeWidth={1.5} />
                    微信 AI
                  </>
                ) : (
                  <>
                    <PenLine size={12} strokeWidth={1.5} />
                    网页记录
                  </>
                )}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {owner && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onTogglePin(row)}
              title={row.pinned ? "取消置顶" : "置顶"}
              aria-label={row.pinned ? "取消置顶" : "置顶"}
            >
              <Pin size={14} strokeWidth={1.5} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onCopy(row)}
            title="复制原文"
            aria-label="复制原文"
          >
            {copied ? (
              <Check size={14} strokeWidth={1.75} />
            ) : (
              <Copy size={14} strokeWidth={1.5} />
            )}
          </Button>
          {owner && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEdit(row)}
                title="编辑"
                aria-label="编辑"
              >
                <PenLine size={14} strokeWidth={1.5} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDelete(row)}
                title="删除"
                aria-label="删除"
              >
                <Trash2 size={14} strokeWidth={1.5} />
              </Button>
            </>
          )}
        </div>
      </header>

      {/* 独立总结区（与正文完全隔离） */}
      {row.summary && (
        <div
          data-field="summary"
          itemProp="abstract"
          className="rounded-md border-l-2 border-[var(--zzm-accent)] bg-zzm-fill px-3.5 py-2 text-[13px] leading-6 text-muted-foreground"
        >
          <span className="mr-1.5 font-semibold text-foreground">总结</span>
          {row.summary}
        </div>
      )}

      {/* 原话正文（逐字保留，不压缩） */}
      <div
        data-field="content"
        itemProp="text"
        className="whitespace-pre-wrap break-words text-[14.5px] leading-7 text-foreground"
      >
        {row.content}
      </div>

      {/* 底部：两层标签 + 本人可见的微信原始原话对照 */}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <div data-field="tags" className="flex flex-wrap items-center gap-1.5">
          {row.tags.length > 0 ? (
            row.tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                data-group={tag.group}
                data-name={tag.name}
                itemProp="keywords"
                onClick={() =>
                  onSelectTag(tag.group_id, tag.group, tag.id, tag.name)
                }
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs transition-colors hover:border-foreground/40"
              >
                <span className="text-muted-foreground">{tag.group}</span>
                <span className="text-zzm-muted">/</span>
                <span className="font-medium text-foreground">{tag.name}</span>
              </button>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">暂无标签</span>
          )}
        </div>

        {owner && row.raw_text && (
          <details className="text-xs text-muted-foreground">
            <summary className="inline-flex cursor-pointer items-center gap-1 select-none hover:text-foreground">
              微信原始消息
              <ChevronDown size={12} />
            </summary>
            <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-zzm-fill p-2.5 font-sans text-xs leading-5 text-foreground">
              {row.raw_text}
            </pre>
          </details>
        )}
      </footer>
    </article>
  );
}
