/**
 * [INPUT]: 协议、解析器和数据库的失败结果。
 * [OUTPUT]: 安全错误码与可重试错误分类。
 * [POS]: relay 的错误边界；日志不输出原话、模型输出或凭据。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export class RelayError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'RelayError'; }
}
export function errorCode(error: unknown): string {
  return error instanceof RelayError ? error.code : 'UNEXPECTED_ERROR';
}
