/**
 * [INPUT]: 不依赖外部 class 库
 * [OUTPUT]: 对外提供 cn，拼 className
 * [POS]: web/lib 的样式拼装，Sheet 与表单共用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
