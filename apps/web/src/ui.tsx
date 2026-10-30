/**
 * [INPUT]: 依赖 lucide 的 Inbox 图标。
 * [OUTPUT]: 对外提供 Empty 空状态。
 * [POS]: 页面共享视觉原语；不加载远程字体或外部图片。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
export function Empty({
  title = "还没有记录",
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Inbox size={24} strokeWidth={1.5} />
      <strong>{title}</strong>
      <p>{children ?? "在微信中发送一句话，记录会在这里慢慢积累。"}</p>
    </div>
  );
}
