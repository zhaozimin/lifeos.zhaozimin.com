/**
 * [INPUT]: 依赖 React 节点与 index.css 的 text-caption-uppercase / text-display-sm 字阶。
 * [OUTPUT]: 对外提供 PageHeader：mono 节标签 + 标题 + 行内注记 + 右侧工具条。
 * [POS]: components/ui 的页头原语；全部页面共用同一节标题骨架，板块之间的「联系感」由它保证。
 *   工具条只放 28 高的工具键；页面主操作（朱键）也放这里，一屏一个。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ReactNode } from "react";
import clsx from "clsx";

export function PageHeader({
  label,
  title,
  note,
  actions,
  className,
}: {
  label: string;
  title: ReactNode;
  note?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={clsx("flex flex-none flex-wrap items-end gap-x-4 gap-y-3", className)}>
      <div className="min-w-0">
        <p className="text-caption-uppercase">{label}</p>
        <h1 className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <span className="text-display-sm">{title}</span>
          {note && <span className="text-[13px] font-normal leading-5 text-muted-foreground tabular-nums">{note}</span>}
        </h1>
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{actions}</div>}
    </header>
  );
}
