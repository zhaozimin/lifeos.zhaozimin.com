/**
 * [INPUT]: 接收需要插入 HTML 文本或属性的值。
 * [OUTPUT]: 导出 escapeHtml；统一文本和属性的转义。
 * [POS]: public 的转义边界；图表与解读共用，不依赖 DOM。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
